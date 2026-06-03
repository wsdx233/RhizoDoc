import type { HighlighterCore, LanguageRegistration, ThemedToken } from 'shiki/core';
import { escapeHtml } from './utils.js';

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

type LanguageModule = { default: LanguageRegistration | LanguageRegistration[] };

export type ShikiLanguage = (typeof SHIKI_LANGUAGES)[number];
type LoadedShikiLanguage = Exclude<ShikiLanguage, 'text'>;

type ShikiHighlightContext = {
  highlighter: HighlighterCore;
  theme: typeof SHIKI_THEME;
};

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

let shikiPromise: Promise<ShikiHighlightContext> | null = null;
const loadedLanguages = new Set<ShikiLanguage>(['text']);
const loadingLanguages = new Map<LoadedShikiLanguage, Promise<void>>();

export async function loadShikiHighlighter(): Promise<ShikiHighlightContext> {
  shikiPromise ||= (async () => {
    const [core, engine, theme] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/themes/github-dark.mjs'),
    ]);
    const highlighter = await core.createHighlighterCore({
      langs: [],
      themes: [theme.default],
      engine: engine.createJavaScriptRegexEngine(),
    });
    return { highlighter, theme: SHIKI_THEME };
  })();
  return shikiPromise;
}

export async function ensureShikiLanguage(highlighter: HighlighterCore, language: ShikiLanguage): Promise<void> {
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

export function renderShikiTokens(tokens: ThemedToken[]): string {
  return tokens.map((token) => {
    const style = styleObjectToCss(token.htmlStyle || tokenToFallbackStyle(token));
    return `<span${style ? ` style="${escapeHtml(style)}"` : ''}>${escapeHtml(token.content)}</span>`;
  }).join('');
}

export function normalizeShikiLanguage(language: string): ShikiLanguage {
  const value = String(language || 'text').toLowerCase().replace(/^language-/, '').replace(/[^a-z0-9_+#-]/g, '');
  const normalized = languageAliases[value] || value || 'text';
  return isShikiLanguage(normalized) ? normalized : 'text';
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

function isShikiLanguage(language: string): language is ShikiLanguage {
  return SHIKI_LANGUAGES.includes(language as ShikiLanguage);
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
