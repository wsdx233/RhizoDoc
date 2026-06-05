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
const TILED_ELASTIC_PASSES = 2;

type DesiredTarget = {
  y: number;
  weight: number;
  kind: 'base' | 'focus' | 'previous' | 'relation';
};

type RelationDesiredTarget = DesiredTarget & {
  active: boolean;
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
  const targets: RelationDesiredTarget[] = [];

  for (const candidate of candidates) {
    const source = snapshotByNodeId.get(candidate.sourceId);
    if (!source || source.columnId === layout.columnId) continue;
    const policy = getTiledFocusRelationPolicy(candidate, focusNodeId);
    if (!policy.participatesInLayout) continue;
    if (candidate.kind === 'annotation' && !hasVisibleAnnotationLayoutAnchor(source, layout, candidate, input.anchors)) continue;
    const sourceAnchor = getSourceAnchor(source, candidate, input.anchors);
    const targetAnchor = getTargetAnchor(layout, candidate, input.anchors);
    const desiredY = source.y + sourceAnchor - targetAnchor;
    const clampedY = clampDesiredY(desiredY, layout.baseY, candidate, policy, viewportHeight);
    targets.push({ y: clampedY, weight: policy.layoutWeight, kind: 'relation', active: policy.active });
  }

  return targets;
}

function clampDesiredY(
  desiredY: number,
  baseY: number,
  candidate: TiledRelationCandidate,
  policy: TiledFocusRelationPolicy,
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
  const maxDisplacement = Math.max(240, viewportHeight * kindMultiplier * activeMultiplier);
  return Math.min(Math.max(desiredY, baseY - maxDisplacement), baseY + maxDisplacement);
}

function getSourceAnchor(layout: ElasticTiledPageLayout, candidate: TiledRelationCandidate, anchors: TiledAnchorRegistry | undefined): number {
  const annotationAnchor = getEndpointAnnotationAnchor(layout, candidate, anchors);
  const nodeAnchor = anchors?.nodeAnchors[layout.nodeId];
  return clampAnchor(annotationAnchor?.center ?? nodeAnchor?.center, layout.height);
}

function getTargetAnchor(layout: ElasticTiledPageLayout, candidate: TiledRelationCandidate, anchors: TiledAnchorRegistry | undefined): number {
  const annotationAnchor = getEndpointAnnotationAnchor(layout, candidate, anchors);
  const nodeAnchor = anchors?.nodeAnchors[layout.nodeId];
  return clampAnchor(annotationAnchor?.center ?? nodeAnchor?.center, layout.height);
}

function hasVisibleAnnotationLayoutAnchor(
  source: ElasticTiledPageLayout,
  target: ElasticTiledPageLayout,
  candidate: TiledRelationCandidate,
  anchors: TiledAnchorRegistry | undefined,
) {
  const sourceAnchor = getEndpointAnnotationAnchor(source, candidate, anchors);
  const targetAnchor = getEndpointAnnotationAnchor(target, candidate, anchors);
  return sourceAnchor?.visibility === 'visible' || targetAnchor?.visibility === 'visible';
}

function getEndpointAnnotationAnchor(
  layout: ElasticTiledPageLayout,
  candidate: TiledRelationCandidate,
  anchors: TiledAnchorRegistry | undefined,
) {
  if (candidate.kind !== 'annotation' || !candidate.annotationId) return undefined;
  const anchor = anchors?.annotationAnchors[candidate.annotationId];
  return anchor?.nodeId === layout.nodeId ? anchor : undefined;
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
