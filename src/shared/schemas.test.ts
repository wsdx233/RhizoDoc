import { describe, expect, it } from 'vitest';
import { isFlowObject, normalizeFlowName, validateFlow, validateLLMPayload } from './schemas.js';

describe('shared schemas', () => {
  it('normalizes unsafe flow names', () => {
    expect(normalizeFlowName(' hello/world?.json ')).toBe('hello_world_');
    expect(normalizeFlowName('', 'fallback')).toBe('fallback');
  });

  it('validates and normalizes flow objects', () => {
    const flow = validateFlow({
      name: 'demo',
      nodes: [{ id: 'root', title: 'Root', content: '# Hello', width: 9999 }],
      edges: [{ sourceId: 'root', targetId: 'child' }],
    });
    expect(flow.name).toBe('demo');
    expect(flow.nodes[0].width).toBe(820);
    expect(flow.edges[0].sourceId).toBe('root');
    expect(flow.annotations).toEqual([]);
    expect(isFlowObject(flow)).toBe(true);
  });

  it('rejects invalid flow objects', () => {
    expect(() => validateFlow({ nodes: [] })).toThrow(/edges/);
  });

  it('normalizes LLM payloads', () => {
    const payload = validateLLMPayload({ mode: 'unknown', prompt: 'x', selectedText: 42 });
    expect(payload.mode).toBe('selection');
    expect(payload.userPrompt).toBe('x');
    expect(payload.selectedText).toBe('42');
  });
});
