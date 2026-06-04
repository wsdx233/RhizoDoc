import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { completeSimple, streamSimple } from '@earendil-works/pi-ai';
import { AuthStorage, getAgentDir, ModelRegistry, SettingsManager } from '@earendil-works/pi-coding-agent';
import { normalizeRhizoDocConfig } from './src/shared/config.js';
import { normalizeGeneratedNode } from './src/shared/generated-node.js';
import { normalizeFlowName as normalizeSafeFlowName, validateFlow, validateLLMPayload } from './src/shared/schemas.js';
import { buildInstructions, buildLLMInput } from './src/server/llm-prompt.js';
import { resolvePathInsideRoot } from './src/server/paths.js';
import { createPiSearchAgentCompletion, createPiSearchAgentStream, isPiSearchAgentEnabled } from './src/server/rhizo-agent.js';
import type { LLMGeneratePayload, RhizoDocConfig } from './src/shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const cliOptions = parseCliOptions(process.argv.slice(2));
const APP_CONFIG_PATH = cliOptions.config ? path.resolve(cliOptions.config) : path.resolve(__dirname, 'rhizodoc.config.json');
const appConfig = await loadRhizoDocConfig(APP_CONFIG_PATH);
const PORT = cliOptions.port ?? parsePort(appConfig.server.port, 3000);
const HOST = cliOptions.host ?? appConfig.server.host ?? '127.0.0.1';
const IS_DEV_SERVER = isDevServer();
const VITE_DEV_URL = process.env.RHIZODOC_VITE_URL || 'http://localhost:5173';
const DIST_DIR = path.join(__dirname, 'dist');
const HAS_CLIENT_BUILD = await directoryExists(DIST_DIR);
const SERVE_BUILT_CLIENT = !IS_DEV_SERVER && HAS_CLIENT_BUILD;
const FLOWS_DIR = resolveProjectPath(appConfig.storage.flowsDir);
const AGENT_DIR = getAgentDir();
const authStorage = AuthStorage.create(path.join(AGENT_DIR, 'auth.json'));
const modelRegistry = ModelRegistry.create(authStorage, path.join(AGENT_DIR, 'models.json'));
const settingsManager = SettingsManager.create(__dirname, AGENT_DIR);
const DEFAULT_MAX_TOKENS = appConfig.pi.maxTokens;

await fs.mkdir(FLOWS_DIR, { recursive: true });

app.disable('x-powered-by');
app.use(express.json({ limit: appConfig.server.jsonLimit }));
if (SERVE_BUILT_CLIENT) {
  app.use(express.static(DIST_DIR));
} else if (IS_DEV_SERVER) {
  console.log('RhizoDoc dev: API-only server; Vite serves the browser client.');
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

app.post('/api/llm/stream', async (req, res) => {
  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abortController.abort();
  });

  try {
    const payload = normalizeLLMPayload(req.body || {});
    const stream = await requestLLMNodeStream(payload, { signal: abortController.signal });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    });
    res.flushHeaders?.();

    writeSse(res, 'ready', {
      model: stream.model,
      apiType: stream.apiType,
      reasoningEffort: stream.reasoningEffort,
    });

    for await (const event of stream.events) {
      if (event.type === 'text_delta') {
        writeSse(res, 'delta', { delta: event.delta });
      } else if (event.type === 'thinking_delta') {
        writeSse(res, 'thinking_delta', { delta: event.delta });
      } else if (event.type === 'tool_call') {
        writeSse(res, 'tool_call', { id: event.id, name: event.name, args: event.args });
      } else if (event.type === 'tool_update') {
        writeSse(res, 'tool_update', { id: event.id, name: event.name, summary: event.summary });
      } else if (event.type === 'tool_result') {
        writeSse(res, 'tool_result', { id: event.id, name: event.name, ok: event.ok, summary: event.summary });
      } else if (event.type === 'done') {
        const outputText = event.outputText || extractPiText(event.message);
        const generated = normalizeGeneratedNode(outputText, payload);
        writeSse(res, 'done', {
          title: generated.title,
          content: generated.content,
          raw: outputText,
          usage: event.message?.usage || null,
          model: event.message ? `${stream.provider}/${event.message.responseModel || event.message.model || stream.modelId}` : stream.model,
          apiType: event.message?.api || stream.apiType,
          reasoningEffort: stream.reasoningEffort,
        });
      } else if (event.type === 'error') {
        writeSse(res, 'error', {
          error: 'LLM 调用失败',
          detail: event.error.errorMessage || '模型流式输出失败',
          model: stream.model,
          apiType: stream.apiType,
          reasoningEffort: stream.reasoningEffort,
        });
      }
    }

    res.end();
  } catch (error) {
    console.error('[LLM Stream Error]', error);
    if (!res.headersSent) {
      res.status(error.status || 500).json({
        error: 'LLM 流式调用失败',
        detail: error.message || String(error),
        provider: error.provider,
        model: error.model,
        apiType: error.apiType,
        reasoningEffort: error.reasoningEffort,
      });
      return;
    }
    writeSse(res, 'error', {
      error: 'LLM 流式调用失败',
      detail: error.message || String(error),
      provider: error.provider,
      model: error.model,
      apiType: error.apiType,
      reasoningEffort: error.reasoningEffort,
    });
    res.end();
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
    if (SERVE_BUILT_CLIENT) {
      res.sendFile(path.join(DIST_DIR, 'index.html'));
      return;
    }
    res.status(IS_DEV_SERVER ? 200 : 503).type('text/plain').send(clientUnavailableMessage());
    return;
  }
  next();
});

app.listen(PORT, HOST, async () => {
  console.log(`RhizoDoc API 已启动: http://${HOST}:${PORT}`);
  if (IS_DEV_SERVER) {
    console.log(`RhizoDoc Web 开发入口: ${VITE_DEV_URL}`);
  } else if (SERVE_BUILT_CLIENT) {
    console.log(`RhizoDoc Web 已启动: http://${HOST}:${PORT}`);
  } else {
    console.warn('RhizoDoc Web 未启动: dist/ 不存在，请先运行 pnpm build。');
  }
  console.log(`RhizoDoc config: ${appConfig.loaded ? APP_CONFIG_PATH : 'defaults (rhizodoc.config.json not found)'}`);
  console.log(`Pi agent dir: ${AGENT_DIR}`);
  const config = await getPiModelConfig();
  console.log(`Pi model: ${config.provider}/${config.modelId}, thinking: ${config.thinkingLevel || 'off'}`);
  if (!config.ready) console.warn(`警告: Pi 模型不可用：${config.error || '未配置模型凭据'}`);
});

function isDevServer(): boolean {
  return process.env.RHIZODOC_DEV === '1' || process.env.NODE_ENV === 'development';
}

function clientUnavailableMessage(): string {
  if (IS_DEV_SERVER) {
    return `RhizoDoc API development server.\nThis process does not serve dist/. Open Vite instead: ${VITE_DEV_URL}\n`;
  }
  return 'RhizoDoc client is not built. Run pnpm build, then pnpm start.\n';
}

function normalizeLLMPayload(raw: unknown): LLMGeneratePayload {
  return validateLLMPayload(raw);
}

async function requestLLMNode(payload: LLMGeneratePayload) {
  const instructions = buildInstructions({ searchToolsEnabled: isPiSearchAgentEnabled(appConfig) });
  const input = buildLLMInput(payload);
  return isPiSearchAgentEnabled(appConfig)
    ? createPiSearchNode({ instructions, input })
    : createPiNode({ instructions, input });
}

async function requestLLMNodeStream(payload: LLMGeneratePayload, { signal }: { signal?: AbortSignal } = {}) {
  const instructions = buildInstructions({ searchToolsEnabled: isPiSearchAgentEnabled(appConfig) });
  const input = buildLLMInput(payload);
  return isPiSearchAgentEnabled(appConfig)
    ? createPiSearchNodeStream({ instructions, input, signal })
    : createPiNodeStream({ instructions, input, signal });
}

async function createPiSearchNode({ instructions, input }: { instructions: string; input: string }) {
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

  return createPiSearchAgentCompletion({
    appConfig,
    agentDir: AGENT_DIR,
    authStorage,
    modelRegistry,
    settingsManager,
    modelConfig: { model: config.model, thinkingLevel: config.thinkingLevel || 'off' },
    instructions,
    input,
  });
}

async function createPiSearchNodeStream({ instructions, input, signal }: { instructions: string; input: string; signal?: AbortSignal }) {
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

  return createPiSearchAgentStream({
    appConfig,
    agentDir: AGENT_DIR,
    authStorage,
    modelRegistry,
    settingsManager,
    modelConfig: { model: config.model, thinkingLevel: config.thinkingLevel || 'off' },
    instructions,
    input,
    signal,
  });
}

async function createPiNode({ instructions, input }: { instructions: string; input: string }) {
  const stream = await createPiNodeStream({ instructions, input });
  const response = await stream.events.result();

  return {
    outputText: extractPiText(response),
    usage: response.usage || null,
    model: `${stream.provider}/${response.responseModel || response.model || stream.modelId}`,
    apiType: response.api || stream.apiType,
    reasoningEffort: stream.reasoningEffort,
  };
}

async function createPiNodeStream({ instructions, input, signal }: { instructions: string; input: string; signal?: AbortSignal }) {
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
  const events = streamSimple(config.model, {
    systemPrompt: instructions,
    messages: [{ role: 'user', content: input, timestamp: Date.now() }],
  }, {
    apiKey: config.apiKey,
    headers: config.headers,
    signal,
    reasoning: config.thinkingLevel === 'off' ? undefined : (config.thinkingLevel as any),
    maxTokens: Math.min(DEFAULT_MAX_TOKENS, config.model.maxTokens || DEFAULT_MAX_TOKENS),
    timeoutMs: retrySettings.timeoutMs,
    maxRetries: retrySettings.maxRetries,
    maxRetryDelayMs: retrySettings.maxRetryDelayMs,
  });

  return {
    events,
    provider: config.model.provider,
    model: `${config.model.provider}/${config.model.id}`,
    modelId: config.model.id,
    apiType: config.model.api || 'pi',
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

function writeSse(res: express.Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
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
