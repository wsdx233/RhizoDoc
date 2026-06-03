import type { LLMGeneratePayload } from './types.js';

export type GeneratedNodeContent = {
  title: string;
  content: string;
};

export function normalizeGeneratedNode(outputText: unknown, payload: Pick<LLMGeneratePayload, 'userPrompt'>): GeneratedNodeContent {
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

export function getFallbackGeneratedTitle(text: string, payload: Pick<LLMGeneratePayload, 'userPrompt'>): string {
  const firstHeading = text.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
  return firstHeading || (payload.userPrompt ? payload.userPrompt.slice(0, 24) : 'AI 生成节点');
}

export function cleanGeneratedTitle(value: unknown): string {
  return String(value || '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^标题[:：]\s*/i, '')
    .trim();
}

export function clampText(value: unknown, max: number): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n……（已截断 ${text.length - max} 字）`;
}
