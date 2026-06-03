import 'dotenv/config';

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import OpenAI from 'openai';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const FLOWS_DIR = path.join(__dirname, 'data', 'flows');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || process.env.API_KEY || process.env.APIKEY || process.env.apikey || process.env.apiKey || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1';
const OPENAI_API_TYPE = normalizeOpenAIApiType(process.env.OPENAI_API_TYPE || process.env.OPENAI_REQUEST_TYPE || process.env.API_TYPE || 'responses');
const OPENAI_REASONING_EFFORT = process.env.OPENAI_REASONING_EFFORT || '';

const openai = OPENAI_API_KEY
  ? new OpenAI({ apiKey: OPENAI_API_KEY, baseURL: OPENAI_BASE_URL })
  : null;

await fs.mkdir(FLOWS_DIR, { recursive: true });

app.disable('x-powered-by');
app.use(express.json({ limit: '20mb' }));
app.use(express.static(PUBLIC_DIR));

// 前端直接使用 node_modules 中的 ESM 版本，避免引入构建工具。
// 使用 sendFile 的 root + 相对路径形式，避免 pnpm 的 node_modules/.pnpm 真实路径被当作 dotfile 拒绝。
const MARKED_ROOT = path.dirname(require.resolve('marked/package.json'));
const DOMPURIFY_DIST_DIR = path.dirname(require.resolve('dompurify'));

app.get('/vendor/marked.esm.js', (_req, res) => {
  res.sendFile('lib/marked.esm.js', { root: MARKED_ROOT });
});

app.get('/vendor/purify.es.mjs', (_req, res) => {
  res.sendFile('purify.es.mjs', { root: DOMPURIFY_DIST_DIR });
});

app.use('/vendor/highlight', express.static(path.dirname(require.resolve('@highlightjs/cdn-assets/package.json'))));
app.use('/vendor/katex', express.static(path.dirname(require.resolve('katex/package.json'))));

app.get('/api/config', (_req, res) => {
  res.json({
    ok: true,
    hasApiKey: Boolean(OPENAI_API_KEY),
    baseURL: OPENAI_BASE_URL,
    model: OPENAI_MODEL,
    apiType: OPENAI_API_TYPE,
    reasoningEffort: OPENAI_REASONING_EFFORT,
  });
});

app.post('/api/llm/generate', async (req, res) => {
  if (!openai) {
    res.status(400).json({
      error: '缺少 OPENAI_API_KEY',
      detail: '请在 .env 中设置 OPENAI_API_KEY 后重启服务。',
    });
    return;
  }

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
      model: llmResult.model || OPENAI_MODEL,
      apiType: llmResult.apiType || OPENAI_API_TYPE,
      reasoningEffort: OPENAI_REASONING_EFFORT,
    });
  } catch (error) {
    console.error('[LLM Error]', error);
    res.status(error.status || 500).json({
      error: 'LLM 调用失败',
      detail: error.message || String(error),
      baseURL: OPENAI_BASE_URL,
      model: OPENAI_MODEL,
      apiType: OPENAI_API_TYPE,
      reasoningEffort: OPENAI_REASONING_EFFORT,
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
  const flow = req.body?.flow;
  const name = normalizeFlowName(req.body?.name || flow?.name || `flow-${new Date().toISOString().slice(0, 19)}`);

  if (!flow || typeof flow !== 'object' || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)) {
    res.status(400).json({ error: '流程图数据格式不正确，需要包含 nodes 和 edges 数组。' });
    return;
  }

  const filePath = resolveFlowPath(name);
  const savedFlow = {
    ...flow,
    name,
    savedAt: new Date().toISOString(),
  };

  await fs.writeFile(filePath, `${JSON.stringify(savedFlow, null, 2)}\n`, 'utf8');
  res.json({ ok: true, name, fileName: `${name}.json` });
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
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
    return;
  }
  next();
});

app.listen(PORT, () => {
  console.log(`RhizoDoc 已启动: http://localhost:${PORT}`);
  console.log(`OpenAI API baseURL: ${OPENAI_BASE_URL}`);
  console.log(`API type: ${OPENAI_API_TYPE}, model: ${OPENAI_MODEL}, reasoning effort: ${OPENAI_REASONING_EFFORT}`);
  if (!OPENAI_API_KEY) console.warn('警告: 未设置 OPENAI_API_KEY，LLM 功能将不可用。');
});

function normalizeOpenAIApiType(value) {
  const normalized = String(value || 'responses')
    .trim()
    .toLowerCase()
    .replace(/[.\s-]+/g, '_');

  if (['response', 'responses', 'responses_api'].includes(normalized)) return 'responses';
  if (['chat', 'chat_completion', 'chat_completions', 'chatcompletion', 'chatcompletions', 'chat_competition', 'chat_competitions', 'completion', 'completions'].includes(normalized)) {
    return 'chat_completions';
  }
  if (normalized === 'auto') return 'auto';
  return 'responses';
}

function normalizeLLMPayload(raw) {
  return {
    mode: clampText(raw.mode || 'selection', 40),
    userPrompt: clampText(raw.userPrompt || raw.prompt || '请详细解释并扩展成一个可读的知识节点。', 4000),
    selectedText: clampText(raw.selectedText || '', 12000),
    parentTitle: clampText(raw.parentTitle || '', 200),
    parentContent: clampText(raw.parentContent || '', 18000),
    rootTitle: clampText(raw.rootTitle || '', 200),
    graphSummary: clampText(raw.graphSummary || '', 8000),
    apiType: raw.apiType ? normalizeOpenAIApiType(raw.apiType) : '',
  };
}

function buildInstructions() {
  return [
    '你是一个严谨的中文知识图谱/文档研究助手。',
    '你的任务是为无限画布 DAG 生成一个新的节点（也可以是第一张根文档节点）。',
    '输出格式必须是纯文本，不要输出 JSON、XML、YAML、代码围栏或额外说明。',
    '第一行必须是节点短标题，尽量不超过 18 个汉字；不要加“标题：”前缀，也不要使用 Markdown 标题符号。',
    '从第二行开始是节点 Markdown 正文；服务端会按第一个换行把第一行拆为 title，其余内容拆为 content。',
    '正文必须是高质量 Markdown，可使用二级/三级标题、要点列表、引用、表格、代码块和 LaTeX 公式。',
    '除非用户明确要求，不要大段复述原文；应基于原文进行解释、扩展、拆解、追问或生成下一步。',
    '如果上下文不足，请明确说明你的假设，并给出可执行的下一步。',
  ].join('\n');
}

function buildLLMInput(payload) {
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
    '\n请返回适合直接渲染为一个画布节点的纯文本：第一行是短标题，第二行起是中文 Markdown 正文。不要返回 JSON。',
  ].filter(Boolean).join('\n');
}

async function requestLLMNode(payload) {
  const instructions = buildInstructions();
  const input = buildLLMInput(payload);
  const apiType = payload.apiType || OPENAI_API_TYPE;

  if (apiType === 'chat_completions') {
    return createChatCompletionNode({ instructions, input });
  }

  if (apiType === 'auto') {
    try {
      return await createResponsesNode({ instructions, input });
    } catch (error) {
      if (!isProbablyResponsesApiUnsupportedError(error)) throw error;
      console.warn('[LLM] Responses API 不可用，自动切换到 Chat Completions:', error.message || String(error));
      return createChatCompletionNode({ instructions, input });
    }
  }

  return createResponsesNode({ instructions, input });
}

async function createResponsesNode({ instructions, input }) {
  const baseRequest = {
    model: OPENAI_MODEL,
    instructions,
    input,
  };
  if (OPENAI_REASONING_EFFORT) baseRequest.reasoning = { effort: OPENAI_REASONING_EFFORT };

  const response = await callResponsesWithFallback(baseRequest);
  return {
    outputText: extractResponseText(response),
    usage: response.usage || null,
    model: response.model || OPENAI_MODEL,
    apiType: 'responses',
  };
}

async function createChatCompletionNode({ instructions, input }) {
  const baseRequest = {
    model: OPENAI_MODEL,
    messages: [
      { role: 'system', content: instructions },
      { role: 'user', content: input },
    ],
  };
  if (OPENAI_REASONING_EFFORT) baseRequest.reasoning_effort = OPENAI_REASONING_EFFORT;

  const response = await callChatCompletionsWithFallback(baseRequest);
  return {
    outputText: extractChatCompletionText(response),
    usage: response.usage || null,
    model: response.model || OPENAI_MODEL,
    apiType: 'chat_completions',
  };
}

async function callResponsesWithFallback(baseRequest) {
  const variants = [baseRequest];

  if (baseRequest.reasoning) {
    const noReasoningRequest = { ...baseRequest };
    delete noReasoningRequest.reasoning;
    variants.push(noReasoningRequest);
  }

  return tryRequestVariants(variants, (request) => openai.responses.create(request));
}

async function callChatCompletionsWithFallback(baseRequest) {
  const variants = [baseRequest];

  if (baseRequest.reasoning_effort) {
    const noReasoningRequest = { ...baseRequest };
    delete noReasoningRequest.reasoning_effort;
    variants.push(noReasoningRequest);
  }

  return tryRequestVariants(variants, (request) => openai.chat.completions.create(request));
}

async function tryRequestVariants(variants, requester) {
  let lastError;
  for (const request of variants) {
    try {
      return await requester(request);
    } catch (error) {
      lastError = error;
      if (!isRetryableGenerationRequestError(error)) throw error;
    }
  }
  throw lastError;
}

function extractResponseText(response) {
  if (!response) return '';
  if (typeof response.output_text === 'string' && response.output_text.trim()) return response.output_text;

  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === 'string') chunks.push(content.text);
      if (typeof content.output_text === 'string') chunks.push(content.output_text);
      if (content.type === 'output_text' && typeof content.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

function extractChatCompletionText(response) {
  const message = response?.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content === 'string') return content.trim();

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      if (typeof part?.content === 'string') return part.content;
      return '';
    }).filter(Boolean).join('\n').trim();
  }

  return '';
}

function normalizeGeneratedNode(outputText, payload) {
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

function getFallbackGeneratedTitle(text, payload) {
  const firstHeading = text.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  return firstHeading || (payload.userPrompt ? payload.userPrompt.slice(0, 24) : 'AI 生成节点');
}

function cleanGeneratedTitle(value) {
  return String(value || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^标题[:：]\s*/i, '')
    .trim();
}

function isRetryableGenerationRequestError(error) {
  return isProbablyReasoningEffortError(error);
}

function isProbablyReasoningEffortError(error) {
  const message = errorMessage(error).toLowerCase();
  return [400, 422].includes(Number(error?.status)) && (
    message.includes('reasoning.effort') ||
    message.includes('reasoning_effort') ||
    message.includes('reasoning') ||
    message.includes('xhigh')
  );
}

function isProbablyResponsesApiUnsupportedError(error) {
  const status = Number(error?.status);
  const message = errorMessage(error).toLowerCase();
  if ([404, 405].includes(status)) return true;
  return status === 400 && (
    message.includes('/responses') ||
    message.includes('responses api') ||
    message.includes('responses') ||
    message.includes('not found') ||
    message.includes('unsupported endpoint') ||
    message.includes('unknown endpoint') ||
    message.includes('method not allowed')
  );
}

function errorMessage(error) {
  return [
    error?.message,
    error?.error?.message,
    error?.param,
    error?.code,
    error?.error?.param,
    error?.error?.code,
    error?.response?.data?.error?.message,
    error?.response?.data?.error?.param,
    error?.response?.data?.error?.code,
    error?.response?.data?.message,
  ].filter(Boolean).join(' ');
}

function clampText(value, max) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n……（已截断 ${text.length - max} 字）`;
}

function normalizeFlowName(rawName) {
  const base = String(rawName || 'untitled')
    .trim()
    .replace(/\.json$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 90);
  return base || `flow-${Date.now()}`;
}

function resolveFlowPath(name) {
  const normalized = normalizeFlowName(name);
  const filePath = path.resolve(FLOWS_DIR, `${normalized}.json`);
  const flowsRoot = path.resolve(FLOWS_DIR);
  if (!filePath.startsWith(flowsRoot)) throw new Error('非法流程图文件名');
  return filePath;
}
