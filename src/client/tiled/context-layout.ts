import type { RhizoAnnotation, RhizoEdge, RhizoNode, TiledColumn, TiledPageLayout } from '../../shared/types.js';
import type { TiledAnchorRegistry } from './anchors.js';
import { fitElasticStack } from './elastic-layout.js';
import { getTiledFocusRelationPolicy, type TiledFocusRelationPolicy } from './focus-lens.js';
import { buildTiledRelationIndex, getTiledRelationCandidates, type TiledRelationCandidate, type TiledRelationIndex } from './relation-index.js';

export const TILED_ELASTIC_PANEL_GAP = 14;

const TILED_ELASTIC_BASE_WEIGHT = 18;
const TILED_ELASTIC_FOCUS_WEIGHT = 90;
const TILED_ELASTIC_INTERACTIVE_PREVIOUS_WEIGHT = 24;
const TILED_ELASTIC_RELATION_TOP_K = 4;
const TILED_ELASTIC_RELATION_WEIGHT_CAP = 280;
const TILED_ELASTIC_ACTIVE_RELATION_WEIGHT_CAP = 1800;
const TILED_ELASTIC_OFFSCREEN_ANNOTATION_WEIGHT_MULTIPLIER = 0.34;
const TILED_ELASTIC_FALLBACK_ANNOTATION_WEIGHT_MULTIPLIER = 0.22;
const TILED_ELASTIC_OFFSCREEN_ANNOTATION_MAX_DISPLACEMENT = 520;
const TILED_ELASTIC_FALLBACK_ANNOTATION_MAX_DISPLACEMENT = 320;
const TILED_ELASTIC_PASSES = 2;

type DesiredTarget = {
  y: number;
  weight: number;
  kind: 'base' | 'focus' | 'previous' | 'relation';
};

type RelationDesiredTarget = DesiredTarget & {
  active: boolean;
};

type ResolvedEndpointAnchor = {
  center: number;
  mode: 'visible-span' | 'offscreen-cue' | 'offscreen-node' | 'node' | 'fallback';
  visibility?: 'visible' | 'above-viewport' | 'below-viewport';
  offscreenDistance?: number;
};

type RelationLayoutPolicy = Pick<TiledFocusRelationPolicy, 'active' | 'displacement'> & {
  layoutWeight: number;
  maxDisplacement?: number;
};

type AnnotationAnchorContext = {
  cueAnnotationIds: Set<string>;
};

export type ElasticTiledPageLayout = TiledPageLayout & {
  baseY: number;
  desiredY: number;
  computedGapBefore: number;
  extraGapBefore: number;
  relationPull: number;
};

export type TiledAnchorMap = Record<string, number> | Map<string, number>;

export type ComputeElasticTiledLayoutsInput = {
  columns: TiledColumn[];
  pageLayouts: Record<string, TiledPageLayout> | TiledPageLayout[];
  nodes?: RhizoNode[];
  edges?: RhizoEdge[];
  annotations?: RhizoAnnotation[];
  relationIndex?: TiledRelationIndex;
  focusNodeId?: string;
  viewportHeight?: number;
  anchors?: TiledAnchorRegistry;
  previousY?: TiledAnchorMap;
  mode?: 'canonical' | 'interactive';
  minGap?: number;
  passes?: number;
};

export function computeElasticTiledLayouts(input: ComputeElasticTiledLayoutsInput): ElasticTiledPageLayout[] {
  const minGap = Math.max(0, finiteNumber(input.minGap, TILED_ELASTIC_PANEL_GAP));
  const columns = input.columns || [];
  const baseLayouts = createElasticBaseLayouts(normalizePageLayouts(input.pageLayouts), minGap);
  if (baseLayouts.length === 0 || columns.length === 0) return baseLayouts;

  const relationIndex = input.relationIndex || buildTiledRelationIndex(input.nodes || [], input.edges || [], input.annotations || []);
  const layoutsByNodeId = new Map(baseLayouts.map((layout) => [layout.nodeId, layout]));
  const layoutsByColumnId = new Map<string, ElasticTiledPageLayout[]>();
  for (const column of columns) {
    layoutsByColumnId.set(column.id, column.pageIds.map((nodeId) => layoutsByNodeId.get(nodeId)).filter(Boolean) as ElasticTiledPageLayout[]);
  }

  let solvedByNodeId = new Map(baseLayouts.map((layout) => [layout.nodeId, layout]));
  const passCount = Math.max(1, Math.floor(finiteNumber(input.passes, TILED_ELASTIC_PASSES)));
  for (let pass = 0; pass < passCount; pass += 1) {
    const snapshotByNodeId = solvedByNodeId;
    const nextByNodeId = new Map<string, ElasticTiledPageLayout>();
    for (const column of columns) {
      const layouts = layoutsByColumnId.get(column.id) || [];
      const solved = solveColumn(layouts, snapshotByNodeId, relationIndex, input, minGap);
      solved.forEach((layout) => nextByNodeId.set(layout.nodeId, layout));
    }
    solvedByNodeId = nextByNodeId;
  }

  return baseLayouts.map((layout) => solvedByNodeId.get(layout.nodeId) || layout);
}

function createElasticBaseLayouts(pageLayouts: TiledPageLayout[], minGap: number): ElasticTiledPageLayout[] {
  const orderByColumnId = new Map<string, number>();
  return pageLayouts
    .slice()
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
    .map((layout) => {
      const order = orderByColumnId.get(layout.columnId) || 0;
      orderByColumnId.set(layout.columnId, order + 1);
      const elasticBaseY = layout.y + order * minGap;
      return {
        ...layout,
        y: elasticBaseY,
        baseY: elasticBaseY,
        desiredY: elasticBaseY,
        columnOffsetY: 0,
        computedGapBefore: order === 0 ? 0 : minGap,
        extraGapBefore: 0,
        relationPull: 0,
      };
    });
}

function solveColumn(
  layouts: ElasticTiledPageLayout[],
  snapshotByNodeId: Map<string, ElasticTiledPageLayout>,
  relationIndex: TiledRelationIndex,
  input: ComputeElasticTiledLayoutsInput,
  minGap: number,
): ElasticTiledPageLayout[] {
  if (layouts.length === 0) return [];
  const items = layouts.map((layout) => {
    const desiredTargets = buildDesiredTargets(layout, snapshotByNodeId, relationIndex, input);
    const desiredY = weightedMean(desiredTargets);
    const totalWeight = desiredTargets.reduce((sum, target) => sum + target.weight, 0) || 1;
    return { id: layout.nodeId, height: layout.height, desiredY, weight: totalWeight };
  });

  const fitted = fitElasticStack(items, { minGap });
  const fittedByNodeId = new Map(fitted.map((item) => [item.id, item]));
  const desiredYByNodeId = new Map(items.map((item) => [item.id, item.desiredY]));
  return layouts.map((layout) => {
    const result = fittedByNodeId.get(layout.nodeId);
    if (!result) return layout;
    const desiredY = desiredYByNodeId.get(layout.nodeId) ?? layout.baseY;
    return {
      ...layout,
      y: result.y,
      desiredY,
      computedGapBefore: result.gapBefore,
      extraGapBefore: result.extraGapBefore,
      relationPull: desiredY - layout.baseY,
    };
  });
}

function buildDesiredTargets(
  layout: ElasticTiledPageLayout,
  snapshotByNodeId: Map<string, ElasticTiledPageLayout>,
  relationIndex: TiledRelationIndex,
  input: ComputeElasticTiledLayoutsInput,
): DesiredTarget[] {
  const focusNodeId = input.focusNodeId || '';
  const targets: DesiredTarget[] = [{ y: layout.baseY, weight: TILED_ELASTIC_BASE_WEIGHT, kind: 'base' }];
  if (layout.nodeId === focusNodeId) targets.push({ y: layout.baseY, weight: TILED_ELASTIC_FOCUS_WEIGHT, kind: 'focus' });

  if (input.mode === 'interactive') {
    const previousY = getAnchorValue(input.previousY, layout.nodeId);
    if (Number.isFinite(previousY)) {
      targets.push({ y: previousY, weight: TILED_ELASTIC_INTERACTIVE_PREVIOUS_WEIGHT, kind: 'previous' });
    }
  }

  const collectedRelationTargets = collectRelationDesiredTargets(layout, snapshotByNodeId, relationIndex, input);
  const activeRelationTargets = collectedRelationTargets.filter((target) => target.active);
  const relationTargets = (activeRelationTargets.length > 0 ? activeRelationTargets : collectedRelationTargets)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, activeRelationTargets.length > 0 ? activeRelationTargets.length : TILED_ELASTIC_RELATION_TOP_K);
  const relationWeight = relationTargets.reduce((sum, target) => sum + target.weight, 0);
  const weightCap = activeRelationTargets.length > 0 ? TILED_ELASTIC_ACTIVE_RELATION_WEIGHT_CAP : TILED_ELASTIC_RELATION_WEIGHT_CAP;
  const scale = relationWeight > weightCap ? weightCap / relationWeight : 1;
  for (const target of relationTargets) {
    targets.push({ y: target.y, weight: target.weight * scale, kind: 'relation' });
  }
  return targets;
}

function collectRelationDesiredTargets(
  layout: ElasticTiledPageLayout,
  snapshotByNodeId: Map<string, ElasticTiledPageLayout>,
  relationIndex: TiledRelationIndex,
  input: ComputeElasticTiledLayoutsInput,
): RelationDesiredTarget[] {
  const focusNodeId = input.focusNodeId || '';
  if (layout.nodeId === focusNodeId) return [];
  const viewportHeight = Math.max(1, finiteNumber(input.viewportHeight, 720));
  const candidates = getTiledRelationCandidates(relationIndex, layout.nodeId, focusNodeId);
  const annotationContext = getAnnotationAnchorContext(input.anchors);
  const targets: RelationDesiredTarget[] = [];

  for (const candidate of candidates) {
    const source = snapshotByNodeId.get(candidate.sourceId);
    if (!source || source.columnId === layout.columnId) continue;
    const policy = getTiledFocusRelationPolicy(candidate, focusNodeId);
    if (!policy.participatesInLayout) continue;
    const sourceAnchor = resolveEndpointAnchor(source, candidate, input.anchors, annotationContext);
    const targetAnchor = resolveEndpointAnchor(layout, candidate, input.anchors, annotationContext);
    const layoutPolicy = resolveRelationLayoutPolicy(policy, candidate, sourceAnchor, targetAnchor);
    const desiredY = source.y + sourceAnchor.center - targetAnchor.center;
    const clampedY = clampDesiredY(desiredY, layout.baseY, candidate, layoutPolicy, viewportHeight);
    targets.push({ y: clampedY, weight: layoutPolicy.layoutWeight, kind: 'relation', active: layoutPolicy.active });
  }

  return targets;
}

function clampDesiredY(
  desiredY: number,
  baseY: number,
  candidate: TiledRelationCandidate,
  policy: RelationLayoutPolicy,
  viewportHeight: number,
): number {
  if (policy.displacement === 'exact') return desiredY;
  if (policy.displacement === 'none') return baseY;
  const kindMultiplier = candidate.kind === 'annotation'
    ? 0.9
    : candidate.kind === 'structural'
      ? 0.65
      : 0.35;
  const activeMultiplier = policy.active ? 1.15 : 1;
  const maxDisplacement = policy.maxDisplacement ?? Math.max(240, viewportHeight * kindMultiplier * activeMultiplier);
  return Math.min(Math.max(desiredY, baseY - maxDisplacement), baseY + maxDisplacement);
}

function getAnnotationAnchorContext(anchors: TiledAnchorRegistry | undefined): AnnotationAnchorContext {
  const annotationAnchors = Object.values(anchors?.annotationAnchors || {});
  const cueAnnotationIds = new Set<string>();

  for (const visibility of ['above-viewport', 'below-viewport'] as const) {
    const nearest = annotationAnchors
      .filter((anchor) => anchor.visibility === visibility && anchor.annotationId)
      .sort((a, b) => finiteNumber(a.offscreenDistance, Number.MAX_SAFE_INTEGER) - finiteNumber(b.offscreenDistance, Number.MAX_SAFE_INTEGER))[0];
    if (nearest?.annotationId) cueAnnotationIds.add(nearest.annotationId);
  }

  return { cueAnnotationIds };
}

function resolveEndpointAnchor(
  layout: ElasticTiledPageLayout,
  candidate: TiledRelationCandidate,
  anchors: TiledAnchorRegistry | undefined,
  annotationContext: AnnotationAnchorContext,
): ResolvedEndpointAnchor {
  if (candidate.kind === 'annotation' && candidate.annotationId) {
    const annotationAnchor = anchors?.annotationAnchors[candidate.annotationId];
    if (annotationAnchor?.nodeId === layout.nodeId) {
      if (annotationAnchor.visibility === 'visible') {
        return {
          center: clampAnchor(annotationAnchor.center, layout.height),
          mode: 'visible-span',
          visibility: annotationAnchor.visibility,
        };
      }
      const offscreenDistance = finiteNumber(annotationAnchor.offscreenDistance, 0);
      if (annotationContext.cueAnnotationIds.has(candidate.annotationId)) {
        return {
          center: clampAnchor(annotationAnchor.center, layout.height),
          mode: 'offscreen-cue',
          visibility: annotationAnchor.visibility,
          offscreenDistance,
        };
      }
      const nodeAnchor = anchors?.nodeAnchors[layout.nodeId];
      return {
        center: clampAnchor(nodeAnchor?.center, layout.height),
        mode: 'offscreen-node',
        visibility: annotationAnchor.visibility,
        offscreenDistance,
      };
    }
  }

  const nodeAnchor = anchors?.nodeAnchors[layout.nodeId];
  if (nodeAnchor) {
    return {
      center: clampAnchor(nodeAnchor.center, layout.height),
      mode: 'node',
      visibility: nodeAnchor.visibility,
    };
  }

  return { center: clampAnchor(undefined, layout.height), mode: 'fallback' };
}

function resolveRelationLayoutPolicy(
  policy: TiledFocusRelationPolicy,
  candidate: TiledRelationCandidate,
  sourceAnchor: ResolvedEndpointAnchor,
  targetAnchor: ResolvedEndpointAnchor,
): RelationLayoutPolicy {
  if (candidate.kind !== 'annotation') return policy;
  const modes = [sourceAnchor.mode, targetAnchor.mode];
  if (modes.includes('visible-span')) return policy;

  if (modes.includes('offscreen-cue')) {
    const offscreenDistance = Math.max(sourceAnchor.offscreenDistance || 0, targetAnchor.offscreenDistance || 0);
    const distanceBoost = Math.min(160, offscreenDistance * 0.2);
    return {
      active: false,
      displacement: 'bounded',
      layoutWeight: policy.layoutWeight * TILED_ELASTIC_OFFSCREEN_ANNOTATION_WEIGHT_MULTIPLIER,
      maxDisplacement: TILED_ELASTIC_OFFSCREEN_ANNOTATION_MAX_DISPLACEMENT + distanceBoost,
    };
  }

  return {
    active: false,
    displacement: 'bounded',
    layoutWeight: policy.layoutWeight * TILED_ELASTIC_FALLBACK_ANNOTATION_WEIGHT_MULTIPLIER,
    maxDisplacement: TILED_ELASTIC_FALLBACK_ANNOTATION_MAX_DISPLACEMENT,
  };
}

function clampAnchor(value: unknown, height: number): number {
  const fallback = height / 2;
  const anchor = finiteNumber(value, fallback);
  return Math.min(Math.max(anchor, 0), height);
}

function weightedMean(targets: DesiredTarget[]): number {
  const totalWeight = targets.reduce((sum, target) => sum + target.weight, 0) || 1;
  return targets.reduce((sum, target) => sum + target.y * target.weight, 0) / totalWeight;
}

function getAnchorValue(anchors: TiledAnchorMap | undefined, nodeId: string): number {
  if (!anchors) return NaN;
  const value = anchors instanceof Map ? anchors.get(nodeId) : anchors[nodeId];
  return finiteNumber(value, NaN);
}

function normalizePageLayouts(pageLayouts: Record<string, TiledPageLayout> | TiledPageLayout[]): TiledPageLayout[] {
  return Array.isArray(pageLayouts) ? pageLayouts : Object.values(pageLayouts || {});
}

function finiteNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}
