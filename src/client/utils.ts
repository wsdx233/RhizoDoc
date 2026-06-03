export function closestElement<T extends Element = Element>(node: Node | null | undefined, selector: string): T | null {
  const element = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement;
  return (element?.closest?.(selector) as T | null) || null;
}

export function genId(prefix: string): string {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char] || char);
}

export function cssAttr(value: unknown): string {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function safeFileName(value: unknown): string {
  return String(value || 'flow').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_').slice(0, 90) || 'flow';
}

export function plainExcerpt(markdown: unknown, maxLength: number): string {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' 代码块 ')
    .replace(/[#>*_`\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

export function codeFenceText(value: unknown): string {
  return String(value || '').replace(/```/g, '`\u200b``');
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
