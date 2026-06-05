import { describe, expect, it } from 'vitest';
import { getTiledFocusRelationPolicy } from './focus-lens.js';
import type { TiledRelationCandidate } from './relation-index.js';

function candidate(overrides: Partial<TiledRelationCandidate>): TiledRelationCandidate {
  return {
    sourceId: 'focus',
    targetId: 'target',
    kind: 'structural',
    weight: 120,
    ...overrides,
  };
}

describe('getTiledFocusRelationPolicy', () => {
  it('classifies focused annotations as exact annotation jumps', () => {
    const policy = getTiledFocusRelationPolicy(candidate({ kind: 'annotation', annotationId: 'note', weight: 160 }), 'focus');

    expect(policy.role).toBe('annotation-jump');
    expect(policy.participatesInLayout).toBe(true);
    expect(policy.active).toBe(true);
    expect(policy.displacement).toBe('exact');
    expect(policy.layoutWeight).toBeGreaterThan(1000);
  });

  it('classifies focused child-to-parent structural links as active paths', () => {
    const policy = getTiledFocusRelationPolicy(candidate({ structuralDirection: 'child-to-parent' }), 'focus');

    expect(policy.role).toBe('active-path');
    expect(policy.participatesInLayout).toBe(true);
    expect(policy.displacement).toBe('exact');
  });

  it('keeps focused parent fanout structural links out of layout by default', () => {
    const policy = getTiledFocusRelationPolicy(candidate({ structuralDirection: 'parent-to-child' }), 'focus');

    expect(policy.role).toBe('fanout-context');
    expect(policy.participatesInLayout).toBe(false);
  });

  it('treats non-focused candidates as background', () => {
    const policy = getTiledFocusRelationPolicy(candidate({ sourceId: 'other' }), 'focus');

    expect(policy.role).toBe('background');
    expect(policy.participatesInLayout).toBe(false);
  });
});
