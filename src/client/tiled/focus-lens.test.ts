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

  it('treats focused title-anchor annotations as bounded context instead of exact jumps', () => {
    const policy = getTiledFocusRelationPolicy(candidate({ kind: 'annotation', annotationId: 'title-anchor:focus:target', annotationAnchorKind: 'title', weight: 118 }), 'focus');

    expect(policy.role).toBe('annotation-jump');
    expect(policy.participatesInLayout).toBe(true);
    expect(policy.active).toBe(false);
    expect(policy.displacement).toBe('bounded');
    expect(policy.layoutWeight).toBeGreaterThan(400);
  });

  it('keeps reverse annotation relations out of layout', () => {
    const policy = getTiledFocusRelationPolicy(candidate({ kind: 'annotation', annotationId: 'note', annotationDirection: 'target-to-source', weight: 150 }), 'focus');

    expect(policy.role).toBe('annotation-jump');
    expect(policy.participatesInLayout).toBe(false);
    expect(policy.active).toBe(false);
    expect(policy.displacement).toBe('none');
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

  it('lets non-focused forward annotations participate as ambient relation-field forces', () => {
    const policy = getTiledFocusRelationPolicy(candidate({ sourceId: 'other', kind: 'annotation', annotationDirection: 'source-to-target', weight: 160 }), 'focus');

    expect(policy.role).toBe('ambient-annotation');
    expect(policy.participatesInLayout).toBe(true);
    expect(policy.active).toBe(false);
    expect(policy.displacement).toBe('bounded');
  });

  it('keeps non-focused reverse annotations out of layout', () => {
    const policy = getTiledFocusRelationPolicy(candidate({ sourceId: 'other', kind: 'annotation', annotationDirection: 'target-to-source', weight: 150 }), 'focus');

    expect(policy.role).toBe('background');
    expect(policy.participatesInLayout).toBe(false);
  });

  it('keeps ambient parent fanout out of layout while allowing child-to-parent structure', () => {
    const fanout = getTiledFocusRelationPolicy(candidate({ sourceId: 'parent', structuralDirection: 'parent-to-child' }), 'focus');
    const parentPath = getTiledFocusRelationPolicy(candidate({ sourceId: 'child', structuralDirection: 'child-to-parent' }), 'focus');

    expect(fanout.role).toBe('background');
    expect(fanout.participatesInLayout).toBe(false);
    expect(parentPath.role).toBe('ambient-structure');
    expect(parentPath.participatesInLayout).toBe(true);
  });
});
