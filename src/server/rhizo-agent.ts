import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  type AgentSession,
  type AgentSessionEvent,
  type AuthStorage,
  type ModelRegistry,
  type SettingsManager,
  type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import type { RhizoDocConfig } from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_SEARCH_TOOL_NAMES = ['grok_search', 'kimi_search', 'gemini_search'] as const;
const DEFAULT_MAX_SEARCH_TOOL_CALLS = 8;

export type RhizoAgentConfig = Awaited<ReturnType<typeof createPiSearchAgentSession>>;

export type RhizoAgentEventHandlers = {
  onTextDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  onToolCall?: (event: { id: string; name: string; args: unknown }) => void;
  onToolUpdate?: (event: { id: string; name: string; summary: string }) => void;
  onToolResult?: (event: { id: string; name: string; ok: boolean; summary: string }) => void;
};

export type CreatePiSearchAgentOptions = {
  appConfig: RhizoDocConfig;
  agentDir: string;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  modelConfig: {
    model: any;
    thinkingLevel: string;
  };
  instructions: string;
  handlers?: RhizoAgentEventHandlers;
};

export function isPiSearchAgentEnabled(config: RhizoDocConfig): boolean {
  return config.tools?.search?.enabled === true;
}

export async function createPiSearchAgentSession(options: CreatePiSearchAgentOptions) {
  const searchConfig = options.appConfig.tools.search;
  const toolNames = normalizeSearchToolNames(searchConfig.allowedTools);
  const configuredExtensionPaths = resolveSearchExtensionPaths(searchConfig.extensionPaths);
  const discoverExtensions = configuredExtensionPaths.length === 0;
  const loader = new DefaultResourceLoader({
    cwd: PROJECT_ROOT,
    agentDir: options.agentDir,
    settingsManager: options.settingsManager,
    noExtensions: !discoverExtensions,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    additionalExtensionPaths: configuredExtensionPaths,
    extensionsOverride: (base) => filterExtensionsByAllowedTools(base, toolNames),
    extensionFactories: [createSearchToolSafetyGate(toolNames, normalizeMaxToolCalls(searchConfig.maxToolCalls))],
    appendSystemPrompt: [options.instructions],
  });
  await loader.reload();
  const loadedTools = new Set(loader.getExtensions().extensions.flatMap((extension) => Array.from(extension.tools.keys())));
  if (!toolNames.some((toolName) => loadedTools.has(toolName))) {
    const errors = loader.getExtensions().errors.map((error) => `${error.path}: ${error.error}`).join('\n');
    throw new Error(`RhizoDoc 已启用联网检索工具，但没有加载到允许的 Pi search tools：${toolNames.join(', ')}${errors ? `\n\n扩展加载错误：\n${errors}` : ''}`);
  }

  const { session, extensionsResult } = await createAgentSession({
    cwd: PROJECT_ROOT,
    agentDir: options.agentDir,
    authStorage: options.authStorage,
    modelRegistry: options.modelRegistry,
    settingsManager: options.settingsManager,
    model: options.modelConfig.model,
    thinkingLevel: options.modelConfig.thinkingLevel === 'off' ? undefined : (options.modelConfig.thinkingLevel as any),
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(PROJECT_ROOT),
    tools: toolNames,
  });

  bindRhizoAgentEvents(session, options.handlers || {});

  return { session, extensionsResult, toolNames };
}

export async function promptPiSearchAgent(session: AgentSession, input: string): Promise<string> {
  await session.prompt(input, { expandPromptTemplates: false, source: 'extension' as any });
  return extractLatestAssistantText(session.messages);
}

export async function createPiSearchAgentCompletion(options: CreatePiSearchAgentOptions & { input: string }) {
  const stream = await createPiSearchAgentStream(options);
  const finalEvent = await stream.events.result();
  return {
    outputText: finalEvent.outputText || '',
    usage: finalEvent.message?.usage || null,
    model: stream.model,
    apiType: stream.apiType,
    reasoningEffort: stream.reasoningEffort,
  };
}

export async function createPiSearchAgentStream(options: CreatePiSearchAgentOptions & { input: string; signal?: AbortSignal }) {
  const queue = createAsyncEventQueue<any>();
  const { session } = await createPiSearchAgentSession({
    ...options,
    handlers: {
      onTextDelta: (delta) => queue.push({ type: 'text_delta', delta }),
      onThinkingDelta: (delta) => queue.push({ type: 'thinking_delta', delta }),
      onToolCall: (event) => queue.push({ type: 'tool_call', ...event }),
      onToolUpdate: (event) => queue.push({ type: 'tool_update', ...event }),
      onToolResult: (event) => queue.push({ type: 'tool_result', ...event }),
    },
  });

  options.signal?.addEventListener('abort', () => {
    void session.abort();
    queue.push({ type: 'error', error: { errorMessage: '模型流式输出已取消。' } });
    queue.close();
  }, { once: true });

  const promptTask = promptPiSearchAgent(session, options.input)
    .then((outputText) => queue.push({ type: 'done', outputText, message: getLatestAssistantMessage(session.messages) }))
    .catch((error) => queue.push({ type: 'error', error: { errorMessage: error.message || String(error) } }))
    .finally(() => {
      session.dispose();
      queue.close();
    });

  const events = queue.iterable as AsyncIterable<any> & { result: () => Promise<any> };
  events.result = async () => {
    let finalEvent: any = null;
    for await (const event of events) {
      if (event.type === 'done') finalEvent = event;
      if (event.type === 'error') throw new Error(event.error?.errorMessage || '模型流式输出失败');
    }
    await promptTask;
    return finalEvent || { type: 'done', outputText: '', message: null };
  };

  return {
    events,
    provider: options.modelConfig.model.provider,
    model: `${options.modelConfig.model.provider}/${options.modelConfig.model.id}`,
    modelId: options.modelConfig.model.id,
    apiType: options.modelConfig.model.api || 'pi-agent',
    reasoningEffort: options.modelConfig.thinkingLevel || 'off',
  };
}

function bindRhizoAgentEvents(session: AgentSession, handlers: RhizoAgentEventHandlers) {
  session.subscribe((event: AgentSessionEvent) => {
    if (event.type === 'message_update') {
      const update = event.assistantMessageEvent;
      if (update.type === 'text_delta') handlers.onTextDelta?.(update.delta);
      if (update.type === 'thinking_delta') handlers.onThinkingDelta?.(update.delta);
      return;
    }

    if (event.type === 'tool_execution_start') {
      handlers.onToolCall?.({ id: event.toolCallId, name: event.toolName, args: event.args });
      return;
    }

    if (event.type === 'tool_execution_update') {
      handlers.onToolUpdate?.({ id: event.toolCallId, name: event.toolName, summary: summarizeToolResult(event.partialResult) });
      return;
    }

    if (event.type === 'tool_execution_end') {
      handlers.onToolResult?.({
        id: event.toolCallId,
        name: event.toolName,
        ok: !event.isError,
        summary: summarizeToolResult(event.result),
      });
    }
  });
}

function createSearchToolSafetyGate(allowedToolNames: string[], maxToolCalls: number): ExtensionFactory {
  const allowed = new Set(allowedToolNames);
  return (pi) => {
    let toolCallCount = 0;

    pi.on('agent_start', () => {
      toolCallCount = 0;
    });

    pi.on('tool_call', (event) => {
      if (!allowed.has(event.toolName)) {
        return { block: true, reason: `RhizoDoc 不允许调用工具：${event.toolName}` };
      }
      toolCallCount += 1;
      if (toolCallCount > maxToolCalls) {
        return { block: true, reason: `RhizoDoc 联网检索工具调用次数超过上限：${maxToolCalls}` };
      }
      return undefined;
    });
  };
}

function resolveSearchExtensionPaths(configuredPaths: string[] | undefined): string[] {
  const paths = configuredPaths?.map((entry) => String(entry || '').trim()).filter(Boolean) || [];
  return paths.map((entry) => path.isAbsolute(entry) ? entry : path.resolve(PROJECT_ROOT, entry));
}

function filterExtensionsByAllowedTools(base: { extensions: any[]; errors: Array<{ path: string; error: string }>; runtime: any }, allowedToolNames: string[]) {
  const allowed = new Set(allowedToolNames);
  const extensions = base.extensions.filter((extension) => Array.from(extension.tools.keys()).some((toolName) => allowed.has(String(toolName))));
  return { ...base, extensions };
}

function normalizeSearchToolNames(configuredToolNames: string[] | undefined): string[] {
  const names = configuredToolNames?.map((name) => String(name || '').trim()).filter(Boolean) || [];
  return names.length > 0 ? names : [...DEFAULT_SEARCH_TOOL_NAMES];
}

function normalizeMaxToolCalls(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MAX_SEARCH_TOOL_CALLS;
}

function getLatestAssistantMessage(messages: any[]): any | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'assistant') return messages[index];
  }
  return null;
}

function createAsyncEventQueue<T>() {
  const values: T[] = [];
  const waiters: Array<(result: IteratorResult<T>) => void> = [];
  let closed = false;

  const next = (): Promise<IteratorResult<T>> => {
    if (values.length > 0) return Promise.resolve({ value: values.shift()!, done: false });
    if (closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => waiters.push(resolve));
  };

  return {
    push(value: T) {
      if (closed) return;
      const waiter = waiters.shift();
      if (waiter) waiter({ value, done: false });
      else values.push(value);
    },
    close() {
      if (closed) return;
      closed = true;
      while (waiters.length > 0) waiters.shift()?.({ value: undefined, done: true });
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return { next };
      },
    } as AsyncIterable<T>,
  };
}

function extractLatestAssistantText(messages: any[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== 'assistant') continue;
    const text = extractMessageText(message);
    if (text.trim()) return text.trim();
  }
  return '';
}

function extractMessageText(message: any): string {
  return (message?.content || [])
    .filter((part: any) => part?.type === 'text' && typeof part.text === 'string')
    .map((part: any) => part.text)
    .join('\n')
    .trim();
}

function summarizeToolResult(result: unknown): string {
  const text = extractToolResultText(result) || safeJsonPreview(result);
  return text.trim().replace(/\s+/g, ' ').slice(0, 500);
}

function extractToolResultText(result: any): string {
  const content = result?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n');
}

function safeJsonPreview(value: unknown): string {
  try {
    return JSON.stringify(value)?.slice(0, 500) || '';
  } catch {
    return String(value || '').slice(0, 500);
  }
}
