import type { TiledRelationCandidate } from './relation-index.js';

export type TiledFocusRelationRole = 'annotation-jump' | 'active-path' | 'fanout-context' | 'ambient-annotation' | 'ambient-structure' | 'background';

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
  if (!focusNodeId || candidate.sourceId !== focusNodeId) return ambientPolicy(candidate);

  if (candidate.kind === 'annotation') {
    const participates = candidate.annotationDirection !== 'target-to-source';
    if (candidate.annotationAnchorKind === 'title') {
      return {
        role: 'annotation-jump',
        participatesInLayout: participates,
        active: false,
        layoutWeight: candidate.weight + 320,
        displacement: participates ? 'bounded' : 'none',
      };
    }
    return {
      role: 'annotation-jump',
      participatesInLayout: participates,
      active: participates,
      layoutWeight: candidate.weight + 1480,
      displacement: participates ? 'exact' : 'none',
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

function ambientPolicy(candidate: TiledRelationCandidate): TiledFocusRelationPolicy {
  if (candidate.kind === 'annotation' && candidate.annotationDirection !== 'target-to-source') {
    return {
      role: 'ambient-annotation',
      participatesInLayout: true,
      active: false,
      layoutWeight: candidate.weight * 0.46,
      displacement: 'bounded',
    };
  }

  if (candidate.kind === 'structural' && candidate.structuralDirection === 'child-to-parent') {
    return {
      role: 'ambient-structure',
      participatesInLayout: true,
      active: false,
      layoutWeight: candidate.weight * 0.18,
      displacement: 'bounded',
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
