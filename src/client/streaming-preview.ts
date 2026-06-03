import type { HighlighterCore, LanguageRegistration, ThemedToken } from 'shiki/core';
import { renderMarkdown } from './markdown.js';
import { escapeHtml } from './utils.js';

type ShikiStreamModule = typeof import('@shikijs/stream');
type ShikiTokenizer = InstanceType<ShikiStreamModule['ShikiStreamTokenizer']>;

type ActiveFence = {
  start: number;
  codeStart: number;
  marker: '`' | '~';
  markerLength: number;
  language: string;
  code: string;
};

type ShikiSession = {
  key: string;
  language: string;
  code: string;
  tokenizer: ShikiTokenizer;
  stableTokens: ThemedToken[];
  unstableTokens: ThemedToken[];
};

const SHIKI_THEME = 'github-dark';
const SHIKI_LANGUAGES = [
  'bash',
  'c',
  'csharp',
  'css',
  'go',
  'html',
  'java',
  'javascript',
  'json',
  'markdown',
  'python',
  'rust',
  'sql',
  'text',
  'typescript',
  'xml',
  'yaml',
] as const;

type ShikiLanguage = (typeof SHIKI_LANGUAGES)[number];
type LoadedShikiLanguage = Exclude<ShikiLanguage, 'text'>;
type LanguageModule = { default: LanguageRegistration | LanguageRegistration[] };

const languageLoaders: Record<LoadedShikiLanguage, () => Promise<LanguageModule>> = {
  bash: () => import('shiki/langs/bash.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
};

const languageAliases: Record<string, string> = {
  cjs: 'javascript',
  cs: 'csharp',
  html: 'html',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  md: 'markdown',
  mermaid: 'text',
  ps1: 'bash',
  pwsh: 'bash',
  shell: 'bash',
  sh: 'bash',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'html',
  yml: 'yaml',
  zsh: 'bash',
};

let shikiPromise: Promise<{ highlighter: HighlighterCore; stream: ShikiStreamModule }> | null = null;
const sessions = new Map<string, ShikiSession>();
const loadedLanguages = new Set<ShikiLanguage>(['text']);
const loadingLanguages = new Map<LoadedShikiLanguage, Promise<void>>();

export async function renderStreamingMarkdownPreview(sessionKey: string, markdown: string): Promise<string | null> {
  const activeFence = findActiveTrailingFence(markdown);
  if (!activeFence) {
    clearStreamingPreview(sessionKey);
    return null;
  }

  const before = markdown.slice(0, activeFence.start);
  const beforeHtml = renderMarkdown(before);
  try {
    const codeHtml = await renderStreamingCode(sessionKey, activeFence.language, activeFence.code);
    return `${beforeHtml}${codeHtml}`;
  } catch (error) {
    console.warn('[StreamingPreview] Shiki stream preview failed:', error);
    clearStreamingPreview(sessionKey);
    return `${beforeHtml}${renderPlainCode(activeFence.language, activeFence.code)}`;
  }
}

export function clearStreamingPreview(sessionKey: string) {
  sessions.delete(sessionKey);
}

function findActiveTrailingFence(markdown: string): ActiveFence | null {
  const linePattern = /.*(?:\n|$)/g;
  let open: Omit<ActiveFence, 'code'> | null = null;
  let match: RegExpExecArray | null;

  while ((match = linePattern.exec(markdown))) {
    const line = match[0];
    if (!line) break;
    const lineStart = match.index;
    const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})([^\n]*)/);
    if (!fenceMatch) continue;

    const markerText = fenceMatch[1];
    const marker = markerText[0] as '`' | '~';
    const rest = fenceMatch[2] || '';

    if (!open) {
      open = {
        start: lineStart,
        codeStart: lineStart + line.length,
        marker,
        markerLength: markerText.length,
        language: normalizeFenceLanguage(rest),
      };
      continue;
    }

    if (marker === open.marker && markerText.length >= open.markerLength && rest.trim() === '') {
      open = null;
    }
  }

  if (!open) return null;
  return {
    ...open,
    code: markdown.slice(open.codeStart),
  };
}

async function renderStreamingCode(sessionKey: string, rawLanguage: string, code: string): Promise<string> {
  const language = normalizeShikiLanguage(rawLanguage);
  const session = await getSession(sessionKey, language, code);
  return `<pre class="code-block shiki shiki-stream"><code class="language-${escapeHtml(language)}" data-language="${escapeHtml(language)}">${renderTokens([...session.stableTokens, ...session.unstableTokens])}</code></pre>`;
}

async function getSession(sessionKey: string, language: ShikiLanguage, code: string): Promise<ShikiSession> {
  const existing = sessions.get(sessionKey);
  if (existing && existing.language === language && code.startsWith(existing.code)) {
    await appendCode(existing, code.slice(existing.code.length));
    return existing;
  }

  const { highlighter, stream } = await loadShiki();
  await ensureLanguage(highlighter, language);
  const tokenizer = new stream.ShikiStreamTokenizer({ highlighter, lang: language, theme: SHIKI_THEME });
  const session: ShikiSession = { key: sessionKey, language, code: '', tokenizer, stableTokens: [], unstableTokens: [] };
  sessions.set(sessionKey, session);
  await appendCode(session, code);
  return session;
}

async function appendCode(session: ShikiSession, delta: string) {
  if (!delta) return;
  const result = await session.tokenizer.enqueue(delta);
  session.code += delta;
  session.stableTokens.push(...result.stable);
  session.unstableTokens = result.unstable;
}

async function loadShiki(): Promise<{ highlighter: HighlighterCore; stream: ShikiStreamModule }> {
  shikiPromise ||= (async () => {
    const [core, engine, stream, theme] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('@shikijs/stream'),
      import('shiki/themes/github-dark.mjs'),
    ]);
    const highlighter = await core.createHighlighterCore({
      langs: [],
      themes: [theme.default],
      engine: engine.createJavaScriptRegexEngine(),
    });
    return { highlighter, stream };
  })();
  return shikiPromise;
}

async function ensureLanguage(highlighter: HighlighterCore, language: ShikiLanguage): Promise<void> {
  if (loadedLanguages.has(language)) return;
  const loadedLanguage = language as LoadedShikiLanguage;
  const loader = languageLoaders[loadedLanguage];
  if (!loader) return;

  let promise = loadingLanguages.get(loadedLanguage);
  if (!promise) {
    promise = (async () => {
      const languageModule = await loader();
      await highlighter.loadLanguage(...toArray(languageModule.default));
      loadedLanguages.add(language);
      loadingLanguages.delete(loadedLanguage);
    })().catch((error) => {
      loadingLanguages.delete(loadedLanguage);
      throw error;
    });
    loadingLanguages.set(loadedLanguage, promise);
  }
  await promise;
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function renderTokens(tokens: ThemedToken[]): string {
  return tokens.map((token) => {
    const style = styleObjectToCss(token.htmlStyle || tokenToFallbackStyle(token));
    return `<span${style ? ` style="${escapeHtml(style)}"` : ''}>${escapeHtml(token.content)}</span>`;
  }).join('');
}

function renderPlainCode(rawLanguage: string, code: string): string {
  const language = normalizeShikiLanguage(rawLanguage);
  return `<pre class="code-block shiki-stream-fallback"><code class="language-${escapeHtml(language)}" data-language="${escapeHtml(language)}">${escapeHtml(code)}</code></pre>`;
}

function tokenToFallbackStyle(token: ThemedToken): Record<string, string> {
  const style: Record<string, string> = {};
  if (token.color) style.color = token.color;
  return style;
}

function styleObjectToCss(style: Record<string, string> | undefined): string {
  if (!style) return '';
  return Object.entries(style)
    .map(([key, value]) => `${cssPropertyName(key)}: ${value}`)
    .join('; ');
}

function cssPropertyName(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function normalizeFenceLanguage(infoString: string): string {
  return String(infoString || '').trim().match(/^\S+/)?.[0] || 'text';
}

function normalizeShikiLanguage(language: string): ShikiLanguage {
  const value = String(language || 'text').toLowerCase().replace(/^language-/, '').replace(/[^a-z0-9_+#-]/g, '');
  const normalized = languageAliases[value] || value || 'text';
  return isShikiLanguage(normalized) ? normalized : 'text';
}

function isShikiLanguage(language: string): language is ShikiLanguage {
  return SHIKI_LANGUAGES.includes(language as ShikiLanguage);
}
