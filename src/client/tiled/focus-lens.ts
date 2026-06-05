import type { TiledRelationCandidate } from './relation-index.js';

export type TiledFocusRelationRole = 'annotation-jump' | 'active-path' | 'fanout-context' | 'background';

export type TiledFocusRelationPolicy = {
  role: TiledFocusRelationRole;
  participatesInLayout: boolean;
  active: boolean;
  layoutWeight: number;
  displacement: 'exact' | 'bounded' | 'none';
};

export function getTiledFocusRelationPolicy(
  candidate: TiledRelationCandidate,
  focusNodeId = '',
): TiledFocusRelationPolicy {
  if (!focusNodeId || candidate.sourceId !== focusNodeId) return backgroundPolicy(candidate);

  if (candidate.kind === 'annotation') {
    return {
      role: 'annotation-jump',
      participatesInLayout: true,
      active: true,
      layoutWeight: candidate.weight + 1480,
      displacement: 'exact',
    };
  }

  if (candidate.kind === 'structural' && candidate.structuralDirection === 'child-to-parent') {
    return {
      role: 'active-path',
      participatesInLayout: true,
      active: true,
      layoutWeight: candidate.weight + 1180,
      displacement: 'exact',
    };
  }

  if (candidate.kind === 'structural' || candidate.kind === 'sibling') {
    return {
      role: 'fanout-context',
      participatesInLayout: false,
      active: false,
      layoutWeight: candidate.kind === 'sibling' ? candidate.weight + 120 : candidate.weight,
      displacement: 'none',
    };
  }

  return backgroundPolicy(candidate);
}

function backgroundPolicy(candidate: TiledRelationCandidate): TiledFocusRelationPolicy {
  return {
    role: 'background',
    participatesInLayout: false,
    active: false,
    layoutWeight: candidate.weight,
    displacement: 'none',
  };
}
