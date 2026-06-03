import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from '@highlightjs/cdn-assets/es/highlight.min.js';
import katex from 'katex';

const markdownRenderer = new marked.Renderer();
markdownRenderer.code = (code, infostring) => renderHighlightedCode(code, infostring);
marked.use({ renderer: markdownRenderer, extensions: createMathExtensions() });
marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(markdown: unknown): string {
  try {
    const html = marked.parse(String(markdown || '')) as string;
    return DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'rel', 'data-language', 'data-math-source', 'data-math-display'],
    });
  } catch {
    return `<pre class="code-block"><code>${escapeHtml(markdown || '')}</code></pre>`;
  }
}

export function postProcessNodeContent(contentEl: HTMLElement) {
  contentEl.querySelectorAll('a[href]').forEach((link) => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
  contentEl.querySelectorAll('pre code.hljs').forEach((code) => {
    code.closest('pre')?.classList.add('code-block');
  });
}

function renderHighlightedCode(code: unknown, infostring = '') {
  const source = String(code ?? '').replace(/\n$/, '');
  const language = normalizeHighlightLanguage(infostring);
  let highlighted = '';
  let detectedLanguage = language;

  try {
    if (language) {
      highlighted = hljs.highlight(source, { language, ignoreIllegals: true }).value;
    } else if (source.trim() && source.length <= 20000) {
      const result = hljs.highlightAuto(source);
      highlighted = result.value;
      detectedLanguage = result.language || '';
    }
  } catch (error) {
    console.warn('[Markdown] 代码高亮失败:', error);
  }

  if (!highlighted) highlighted = escapeHtml(source);
  const languageClass = detectedLanguage ? ` language-${cssClassIdent(detectedLanguage)}` : '';
  const languageAttr = detectedLanguage ? ` data-language="${escapeHtml(detectedLanguage)}"` : '';
  return `<pre class="code-block"><code class="hljs${languageClass}"${languageAttr}>${highlighted}\n</code></pre>\n`;
}

function normalizeHighlightLanguage(infostring = '') {
  const raw = String(infostring || '').trim().match(/^\S+/)?.[0] || '';
  const value = raw.toLowerCase().replace(/^language-/, '');
  if (!value) return '';

  const aliases: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    rb: 'ruby',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    ps1: 'powershell',
    pwsh: 'powershell',
    yml: 'yaml',
    md: 'markdown',
    'c++': 'cpp',
    'c#': 'csharp',
    cs: 'csharp',
    'objective-c': 'objectivec',
    objc: 'objectivec',
    html: 'xml',
    svg: 'xml',
    vue: 'xml',
  };

  const candidates = [aliases[value] || value, value.replace(/[^a-z0-9_+#-]/g, '')];
  for (const candidate of candidates) {
    if (candidate && hljs.getLanguage(candidate)) return candidate;
  }
  return '';
}

function createMathExtensions() {
  return [
    {
      name: 'mathBlock',
      level: 'block',
      start(src) {
        const match = src.match(/(?:^|\n) {0,3}(?:\$\$|\\\[)/);
        if (!match) return undefined;
        return match.index + (match[0].startsWith('\n') ? 1 : 0);
      },
      tokenizer: tokenizeMathBlock,
      renderer(token) {
        return renderKatex(token.text, true);
      },
    },
    {
      name: 'mathInline',
      level: 'inline',
      start(src) {
        const dollar = src.indexOf('$');
        const paren = src.indexOf('\\(');
        if (dollar < 0) return paren >= 0 ? paren : undefined;
        if (paren < 0) return dollar;
        return Math.min(dollar, paren);
      },
      tokenizer: tokenizeMathInline,
      renderer(token) {
        return renderKatex(token.text, false);
      },
    },
  ];
}

function tokenizeMathBlock(src: string) {
  return tokenizeDelimitedMathBlock(src, '$$', '$$') || tokenizeDelimitedMathBlock(src, '\\[', '\\]');
}

function tokenizeDelimitedMathBlock(src: string, openDelimiter: string, closeDelimiter: string) {
  const openPattern = openDelimiter === '$$' ? /^ {0,3}\$\$/ : /^ {0,3}\\\[/;
  const openMatch = openPattern.exec(src);
  if (!openMatch) return undefined;

  const bodyStart = openMatch[0].length;
  let searchFrom = bodyStart;

  while (searchFrom < src.length) {
    const closeIndex = src.indexOf(closeDelimiter, searchFrom);
    if (closeIndex < 0) return undefined;

    const afterClose = src.slice(closeIndex + closeDelimiter.length);
    const trailingMatch = /^[ \t]*(?:\n+|$)/.exec(afterClose);
    if (trailingMatch) {
      const rawEnd = closeIndex + closeDelimiter.length + trailingMatch[0].length;
      return {
        type: 'mathBlock',
        raw: src.slice(0, rawEnd),
        text: src.slice(bodyStart, closeIndex).trim(),
      };
    }

    searchFrom = closeIndex + closeDelimiter.length;
  }

  return undefined;
}

function tokenizeMathInline(src: string) {
  const parenMatch = /^\\\(([\s\S]+?)\\\)/.exec(src);
  if (parenMatch && isValidInlineMath(parenMatch[1])) {
    return {
      type: 'mathInline',
      raw: parenMatch[0],
      text: parenMatch[1].trim(),
    };
  }

  const dollarMatch = /^\$(?!\$)((?:\\[\s\S]|[^\n\\$])+?)\$(?!\$)/.exec(src);
  if (dollarMatch && isValidInlineMath(dollarMatch[1], { strictSpacing: true })) {
    return {
      type: 'mathInline',
      raw: dollarMatch[0],
      text: dollarMatch[1].trim(),
    };
  }
  return undefined;
}

function isValidInlineMath(text: string, { strictSpacing = false } = {}) {
  const value = String(text || '');
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !strictSpacing || trimmed === value;
}

function normalizeLatexSource(source: unknown, { displayMode = false } = {}) {
  let text = String(source || '').trim();
  if (displayMode) {
    // 容错处理常见的 LLM / Markdown 输出：多行公式中行尾单个反斜杠通常表示 LaTeX 换行 \\。
    text = text.replace(/(^|[^\\])\\[ \t]*(?=\n)/gm, (_match, prefix) => `${prefix}\\\\`);
  }
  return text;
}

function renderKatex(source: unknown, displayMode: boolean) {
  const text = normalizeLatexSource(source, { displayMode });
  if (!text) return '';

  const tag = displayMode ? 'div' : 'span';
  const className = displayMode ? 'math-node math-block' : 'math-node math-inline';
  const sourceAttr = escapeHtml(text);

  try {
    const html = katex.renderToString(text, {
      displayMode,
      output: 'html',
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    });
    return `<${tag} class="${className}" data-math-source="${sourceAttr}" data-math-display="${displayMode ? 'true' : 'false'}">${html}</${tag}>`;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'LaTeX 渲染失败';
    return `<${tag} class="${className} math-error" data-math-source="${sourceAttr}" data-math-display="${displayMode ? 'true' : 'false'}" title="${escapeHtml(message)}">${escapeHtml(text)}</${tag}>`;
  }
}

function escapeHtml(value: unknown) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] || char);
}

function cssClassIdent(value: unknown) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '-');
}
