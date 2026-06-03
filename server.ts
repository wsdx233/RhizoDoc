import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { completeSimple } from '@earendil-works/pi-ai';
import { AuthStorage, getAgentDir, ModelRegistry, SettingsManager } from '@earendil-works/pi-coding-agent';
import { normalizeRhizoDocConfig } from './src/shared/config.js';
import { normalizeFlowName as normalizeSafeFlowName, validateFlow, validateLLMPayload } from './src/shared/schemas.js';
import { resolvePathInsideRoot } from './src/server/paths.js';
import type { LLMGeneratePayload, RhizoDocConfig } from './src/shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const cliOptions = parseCliOptions(process.argv.slice(2));
const APP_CONFIG_PATH = cliOptions.config ? path.resolve(cliOptions.config) : path.resolve(__dirname, 'rhizodoc.config.json');
const appConfig = await loadRhizoDocConfig(APP_CONFIG_PATH);
const PORT = cliOptions.port ?? parsePort(appConfig.server.port, 3000);
const HOST = cliOptions.host ?? appConfig.server.host ?? '127.0.0.1';
const DIST_DIR = path.join(__dirname, 'dist');
const HAS_CLIENT_BUILD = await directoryExists(DIST_DIR);
const FLOWS_DIR = resolveProjectPath(appConfig.storage.flowsDir);
const AGENT_DIR = getAgentDir();
const authStorage = AuthStorage.create(path.join(AGENT_DIR, 'auth.json'));
const modelRegistry = ModelRegistry.create(authStorage, path.join(AGENT_DIR, 'models.json'));
const settingsManager = SettingsManager.create(__dirname, AGENT_DIR);
const DEFAULT_MAX_TOKENS = appConfig.pi.maxTokens;

await fs.mkdir(FLOWS_DIR, { recursive: true });

app.disable('x-powered-by');
app.use(express.json({ limit: appConfig.server.jsonLimit }));
if (HAS_CLIENT_BUILD) {
  app.use(express.static(DIST_DIR));
} else {
  console.warn('未找到 dist/ 前端构建产物；API 仍会启动。请运行 pnpm build，或开发时访问 Vite 服务。');
}

app.get('/api/config', async (_req, res) => {
  const config = await getPiModelConfig();
  res.json({
    ok: true,
    provider: config.provider,
    model: config.model?.id || config.modelId || '',
    modelName: config.model?.name || config.model?.id || config.modelId || '',
    apiType: config.model?.api || 'pi',
    reasoningEffort: config.thinkingLevel || 'off',
    ready: config.ready,
    hasApiKey: config.ready,
    authStatus: config.authStatus,
    configSource: config.configSource,
    error: config.error || null,
  });
});

app.post('/api/llm/generate', async (req, res) => {
  try {
    const payload = normalizeLLMPayload(req.body || {});
    const llmResult = await requestLLMNode(payload);
    const generated = normalizeGeneratedNode(llmResult.outputText, payload);

    res.json({
      ok: true,
      title: generated.title,
      content: generated.content,
      raw: llmResult.outputText,
      usage: llmResult.usage || null,
      model: llmResult.model,
      apiType: llmResult.apiType,
      reasoningEffort: llmResult.reasoningEffort,
    });
  } catch (error) {
    console.error('[LLM Error]', error);
    res.status(error.status || 500).json({
      error: 'LLM 调用失败',
      detail: error.message || String(error),
      provider: error.provider,
      model: error.model,
      apiType: error.apiType,
      reasoningEffort: error.reasoningEffort,
    });
  }
});

app.get('/api/flows', async (_req, res) => {
  const files = await fs.readdir(FLOWS_DIR, { withFileTypes: true });
  const flows = [];
  for (const file of files) {
    if (!file.isFile() || !file.name.endsWith('.json')) continue;
    const fullPath = path.join(FLOWS_DIR, file.name);
    const stat = await fs.stat(fullPath);
    flows.push({
      name: path.basename(file.name, '.json'),
      fileName: file.name,
      size: stat.size,
      updatedAt: stat.mtime.toISOString(),
    });
  }
  flows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  res.json({ ok: true, flows });
});

app.post('/api/flows', async (req, res) => {
  try {
    const flow = validateFlow(req.body?.flow);
    const name = normalizeFlowName(req.body?.name || flow.name || `flow-${new Date().toISOString().slice(0, 19)}`);
    const filePath = resolveFlowPath(name);
    const savedFlow = {
      ...flow,
      name,
      savedAt: new Date().toISOString(),
    };

    await fs.writeFile(filePath, `${JSON.stringify(savedFlow, null, 2)}\n`, 'utf8');
    res.json({ ok: true, name, fileName: `${name}.json` });
  } catch (error) {
    res.status(400).json({ error: '流程图数据格式不正确', detail: error.message || String(error) });
  }
});

app.get('/api/flows/:name', async (req, res) => {
  try {
    const name = normalizeFlowName(req.params.name);
    const filePath = resolveFlowPath(name);
    const text = await fs.readFile(filePath, 'utf8');
    res.type('application/json').send(text);
  } catch (error) {
    res.status(404).json({ error: '找不到该流程图', detail: error.message });
  }
});

app.delete('/api/flows/:name', async (req, res) => {
  try {
    const name = normalizeFlowName(req.params.name);
    const filePath = resolveFlowPath(name);
    await fs.unlink(filePath);
    res.json({ ok: true });
  } catch (error) {
    res.status(404).json({ error: '删除失败或文件不存在', detail: error.message });
  }
});

app.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html')) {
    if (HAS_CLIENT_BUILD) {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
      return;
    }
    res.status(503).send('RhizoDoc 前端尚未构建。请运行 pnpm build，或开发时访问 Vite 服务（通常是 http://localhost:5173）。');
    return;
  }
  next();
});

app.listen(PORT, HOST, async () => {
  console.log(`RhizoDoc 已启动: http://${HOST}:${PORT}`);
  console.log(`RhizoDoc config: ${appConfig.loaded ? APP_CONFIG_PATH : 'defaults (rhizodoc.config.json not found)'}`);
  console.log(`Pi agent dir: ${AGENT_DIR}`);
  const config = await getPiModelConfig();
  console.log(`Pi model: ${config.provider}/${config.modelId}, thinking: ${config.thinkingLevel || 'off'}`);
  if (!config.ready) console.warn(`警告: Pi 模型不可用：${config.error || '未配置模型凭据'}`);
});

function normalizeLLMPayload(raw: unknown): LLMGeneratePayload {
  return validateLLMPayload(raw);
}

function buildInstructions() {
  return [
    '你是一个严谨的中文知识图谱/文档研究助手。',
    '你的任务是为无限画布 DAG 生成一个新的节点（也可以是第一张根文档节点）。',
    '输出格式必须是纯文本，不要输出 JSON、XML、YAML、代码围栏或额外说明。',
    '第一行必须是节点纯文本短标题，尽量不超过 18 个汉字；不要加“标题：”前缀，也不要使用 Markdown 标题符号。',
    '从第二行开始是节点 Markdown 正文；服务端会按第一个换行把第一行拆为 title，其余内容拆为 content。',
    '正文必须是高质量 Markdown，可使用二级/三级标题、要点列表、引用、表格、代码块和 LaTeX 公式。'
  ].join('\n');
}

function buildLLMInput(payload: LLMGeneratePayload) {
  const modeText = {
    selection: '基于用户选中的文本生成子节点。',
    node: '基于右键节点的完整内容生成一个新的子节点。',
    canvas: '在画布空白处生成一个独立新节点。',
    initial: '根据用户 Prompt 生成一个全新的根文档节点。',
    regenerate: '重新生成当前 AI 节点内容。',
  }[payload.mode] || payload.mode;

  return [
    `生成模式：${modeText}`,
    `用户指令：${payload.userPrompt}`,
    payload.rootTitle ? `根文档标题：${payload.rootTitle}` : '',
    payload.parentTitle ? `来源节点标题：${payload.parentTitle}` : '',
    payload.selectedText ? `\n【选中文本】\n${payload.selectedText}` : '',
    payload.parentContent ? `\n【来源节点 Markdown 内容】\n${payload.parentContent}` : '',
    payload.graphSummary ? `\n【当前流程图摘要】\n${payload.graphSummary}` : '',
    '\n请返回适合直接渲染为一个画布节点的纯文本：第一行是纯文本短标题，第二行起是中文 Markdown 正文。不要返回 JSON。',
  ].filter(Boolean).join('\n');
}

async function requestLLMNode(payload: LLMGeneratePayload) {
  const instructions = buildInstructions();
  const input = buildLLMInput(payload);
  return createPiNode({ instructions, input });
}

async function createPiNode({ instructions, input }: { instructions: string; input: string }) {
  const config = await getPiModelConfig();
  if (!config.ready) {
    const error = new Error(config.error || 'Pi 模型未配置或缺少凭据。请使用 pi /model 或 pi-ai login 配置模型。') as Error & Record<string, unknown>;
    error.status = 400;
    error.provider = config.provider;
    error.model = config.modelId;
    error.apiType = 'pi';
    error.reasoningEffort = config.thinkingLevel || 'off';
    throw error;
  }

  const retrySettings = settingsManager.getProviderRetrySettings();
  const response = await completeSimple(config.model, {
    systemPrompt: instructions,
    messages: [{ role: 'user', content: input, timestamp: Date.now() }],
  }, {
    apiKey: config.apiKey,
    headers: config.headers,
    reasoning: config.thinkingLevel === 'off' ? undefined : (config.thinkingLevel as any),
    maxTokens: Math.min(DEFAULT_MAX_TOKENS, config.model.maxTokens || DEFAULT_MAX_TOKENS),
    timeoutMs: retrySettings.timeoutMs,
    maxRetries: retrySettings.maxRetries,
    maxRetryDelayMs: retrySettings.maxRetryDelayMs,
  });

  return {
    outputText: extractPiText(response),
    usage: response.usage || null,
    model: `${config.model.provider}/${response.responseModel || response.model || config.model.id}`,
    apiType: response.api || config.model.api || 'pi',
    reasoningEffort: config.thinkingLevel || 'off',
  };
}

async function getPiModelConfig() {
  await settingsManager.reload();
  authStorage.reload();
  modelRegistry.refresh();

  const provider = appConfig.pi.provider || settingsManager.getDefaultProvider();
  const modelId = appConfig.pi.model || settingsManager.getDefaultModel();
  const thinkingLevel = appConfig.pi.thinkingLevel || settingsManager.getDefaultThinkingLevel() || 'off';

  if (!provider || !modelId) {
    return {
      ready: false,
      provider: provider || '',
      modelId: modelId || '',
      thinkingLevel,
      authStatus: { configured: false },
      configSource: appConfig.loaded ? 'rhizodoc.config.json + pi' : 'pi',
      error: `未设置 Pi 默认模型。请运行 pi 后通过 /model 选择模型，或编辑 ${path.join(AGENT_DIR, 'settings.json')}。`,
    };
  }

  const model = modelRegistry.find(provider, modelId);
  const authStatus = modelRegistry.getProviderAuthStatus(provider);
  if (!model) {
    return {
      ready: false,
      provider,
      modelId,
      thinkingLevel,
      authStatus,
      configSource: appConfig.loaded ? 'rhizodoc.config.json + pi' : 'pi',
      error: `Pi 模型不存在：${provider}/${modelId}。请检查 ${path.join(AGENT_DIR, 'models.json')} 或 /model 配置。`,
    };
  }

  const resolvedAuth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!resolvedAuth.ok) {
    return {
      ready: false,
      provider,
      modelId,
      model,
      thinkingLevel,
      authStatus,
      configSource: appConfig.loaded ? 'rhizodoc.config.json + pi' : 'pi',
      error: 'error' in resolvedAuth ? resolvedAuth.error : '模型凭据解析失败',
    };
  }

  return {
    ready: true,
    provider,
    modelId,
    model,
    thinkingLevel,
    authStatus,
    configSource: appConfig.loaded ? 'rhizodoc.config.json + pi' : 'pi',
    apiKey: resolvedAuth.apiKey,
    headers: resolvedAuth.headers,
  };
}

function extractPiText(response: any): string {
  return (response?.content || [])
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function normalizeGeneratedNode(outputText: unknown, payload: LLMGeneratePayload) {
  const text = String(outputText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  const fallbackTitle = getFallbackGeneratedTitle(text, payload);

  if (!text) {
    return {
      title: clampText(fallbackTitle, 80),
      content: '（模型没有返回内容）',
    };
  }

  const firstNewlineIndex = text.indexOf('\n');
  if (firstNewlineIndex >= 0) {
    const rawTitle = text.slice(0, firstNewlineIndex).trim();
    const content = text.slice(firstNewlineIndex + 1).trim();
    return {
      title: clampText(cleanGeneratedTitle(rawTitle) || fallbackTitle, 80),
      content: content || '（模型没有返回正文）',
    };
  }

  return {
    title: clampText(cleanGeneratedTitle(text) || fallbackTitle, 80),
    content: text,
  };
}

function getFallbackGeneratedTitle(text: string, payload: LLMGeneratePayload): string {
  const firstHeading = text.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  return firstHeading || (payload.userPrompt ? payload.userPrompt.slice(0, 24) : 'AI 生成节点');
}

function cleanGeneratedTitle(value: unknown): string {
  return String(value || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^标题[:：]\s*/i, '')
    .trim();
}


function parseCliOptions(args: string[]) {
  const { values } = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      help: { type: 'boolean', short: 'h' },
      port: { type: 'string', short: 'p' },
      config: { type: 'string' },
      host: { type: 'string' },
    },
  });

  if (values.help) {
    console.log('用法：pnpm start -- [--host 127.0.0.1] [--port 3003] [--config rhizodoc.config.json]');
    process.exit(0);
  }

  return {
    port: values.port === undefined ? undefined : parsePort(values.port),
    host: values.host,
    config: values.config,
  };
}

function parsePort(value: unknown, fallback?: number): number {
  if (value === undefined || value === null || value === '') {
    if (fallback !== undefined) return fallback;
    throw new Error('缺少端口号');
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`端口号无效：${value}`);
  }
  return port;
}

function clampText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n……（已截断 ${text.length - max} 字）`;
}

function normalizeFlowName(rawName: unknown): string {
  return normalizeSafeFlowName(rawName, `flow-${Date.now()}`);
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    const stat = await fs.stat(directory);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function loadRhizoDocConfig(configPath: string): Promise<RhizoDocConfig> {
  try {
    const text = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(text);
    return { ...normalizeRhizoDocConfig(parsed), loaded: true };
  } catch (error: any) {
    if (error?.code === 'ENOENT') return { ...normalizeRhizoDocConfig({}), loaded: false };
    if (error instanceof SyntaxError) {
      throw new Error(`RhizoDoc 配置文件不是有效 JSON：${configPath}\n${error.message}`);
    }
    throw error;
  }
}

function resolveProjectPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(__dirname, value);
}

function resolveFlowPath(name: unknown): string {
  const normalized = normalizeFlowName(name);
  try {
    return resolvePathInsideRoot(FLOWS_DIR, `${normalized}.json`);
  } catch {
    throw new Error('非法流程图文件名');
  }
}
