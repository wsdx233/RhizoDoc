import { describe, expect, it } from 'vitest';
import { cleanGeneratedTitle, getFallbackGeneratedTitle, normalizeGeneratedNode } from './generated-node.js';

describe('generated node normalization', () => {
  it('splits the first line as title and the rest as markdown content', () => {
    const node = normalizeGeneratedNode('短标题\n\n## 正文\n内容', { userPrompt: 'fallback' });
    expect(node.title).toBe('短标题');
    expect(node.content).toBe('## 正文\n内容');
  });

  it('cleans markdown heading and title prefixes from generated titles', () => {
    expect(cleanGeneratedTitle('### 标题：研究路线')).toBe('研究路线');
    expect(cleanGeneratedTitle('标题: Study Plan')).toBe('Study Plan');
  });

  it('uses the first markdown heading as fallback title for empty first lines', () => {
    const title = getFallbackGeneratedTitle('\n## 章节标题\n正文', { userPrompt: '用户问题' });
    expect(title).toBe('章节标题');
  });

  it('falls back to the prompt when the model returns no text', () => {
    const node = normalizeGeneratedNode('', { userPrompt: '解释这篇论文的核心贡献' });
    expect(node.title).toBe('解释这篇论文的核心贡献');
    expect(node.content).toBe('（模型没有返回内容）');
  });

  it('clamps very long titles', () => {
    const node = normalizeGeneratedNode(`${'长'.repeat(100)}\n正文`, { userPrompt: 'fallback' });
    expect(node.title.length).toBeGreaterThan(80);
    expect(node.title).toContain('已截断');
  });
});
