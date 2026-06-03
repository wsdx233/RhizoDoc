import type { ThemedToken } from 'shiki/core';
import { renderMarkdown } from './markdown.js';
import {
  ensureShikiLanguage,
  loadShikiHighlighter,
  normalizeShikiLanguage,
  renderShikiTokens,
  type ShikiLanguage,
} from './shiki-highlight.js';
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
  language: ShikiLanguage;
  code: string;
  tokenizer: ShikiTokenizer;
  stableTokens: ThemedToken[];
  unstableTokens: ThemedToken[];
};

let streamPromise: Promise<ShikiStreamModule> | null = null;
const sessions = new Map<string, ShikiSession>();

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
  return `<pre class="code-block shiki shiki-stream"><code class="language-${escapeHtml(language)}" data-language="${escapeHtml(language)}">${renderShikiTokens([...session.stableTokens, ...session.unstableTokens])}</code></pre>`;
}

async function getSession(sessionKey: string, language: ShikiLanguage, code: string): Promise<ShikiSession> {
  const existing = sessions.get(sessionKey);
  if (existing && existing.language === language && code.startsWith(existing.code)) {
    await appendCode(existing, code.slice(existing.code.length));
    return existing;
  }

  const [{ highlighter, theme }, stream] = await Promise.all([loadShikiHighlighter(), loadShikiStream()]);
  await ensureShikiLanguage(highlighter, language);
  const tokenizer = new stream.ShikiStreamTokenizer({ highlighter, lang: language, theme });
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

async function loadShikiStream(): Promise<ShikiStreamModule> {
  streamPromise ||= import('@shikijs/stream');
  return streamPromise;
}

function renderPlainCode(rawLanguage: string, code: string): string {
  const language = normalizeShikiLanguage(rawLanguage);
  return `<pre class="code-block shiki-stream-fallback"><code class="language-${escapeHtml(language)}" data-language="${escapeHtml(language)}">${escapeHtml(code)}</code></pre>`;
}

function normalizeFenceLanguage(infoString: string): string {
  return String(infoString || '').trim().match(/^\S+/)?.[0] || 'text';
}
