import type {
  RhizoAnnotation,
  RhizoEdge,
  RhizoNode,
  RhizoWorkspace,
  TiledColumn,
  TiledFloatingPage,
  TiledFocus,
  TiledPageDisplay,
  TiledPageLayout,
  TiledPageState,
  TiledProjection,
} from './types.js';

export const DEFAULT_TILED_WORKSPACE_ID = 'workspace-default';
export const DEFAULT_TILED_COLUMN_WIDTH = 420;
export const MIN_TILED_COLUMN_WIDTH = 260;
export const MAX_TILED_COLUMN_WIDTH = 900;
export const DEFAULT_TILED_SECTION_HEIGHT = 360;
export const MIN_TILED_SECTION_HEIGHT = 64;
export const MAX_TILED_SECTION_HEIGHT = 2400;
export const DEFAULT_TILED_LANE_GAP = 14;
export const DEFAULT_TILED_FIELD_TOP = 56;
export const DEFAULT_TILED_COLUMN_HEADER_HEIGHT = 52;
export const TILED_TITLE_ONLY_HEIGHT = 56;

export type TiledProjectionResult = {
  rootId: string | null;
  depths: Record<string, number>;
  orphanNodeIds: string[];
  columns: TiledColumn[];
  pageLayouts: Record<string, TiledPageLayout>;
};

type WorkspaceContext = {
  nodes: RhizoNode[];
  edges: RhizoEdge[];
  annotations?: RhizoAnnotation[];
  activeWorkspaceId?: unknown;
};

type AnnotationOrderHint = {
  annotationId: string;
  sourceNodeId: string;
  start: number;
  length: number;
  annotationIndex: number;
};

type ReadingOrderContext = {
  nodeById: Map<string, RhizoNode>;
  nodeIndexById: Map<string, number>;
  annotationByTargetId: Map<string, AnnotationOrderHint>;
  keyCache: Map<string, number[]>;
};

export function createDefaultTiledWorkspace(nodes: RhizoNode[], edges: RhizoEdge[], now = new Date().toISOString(), annotations: RhizoAnnotation[] = []): RhizoWorkspace {
  const projection: TiledProjection = { mode: 'depth', includeOrphans: true };
  return {
    id: DEFAULT_TILED_WORKSPACE_ID,
    name: '默认平铺视图',
    kind: 'bottomless-tiled',
    createdAt: now,
    updatedAt: now,
    projection,
    columns: projectTiledColumns(nodes, edges, { projection }, annotations).columns,
    pages: {},
    floating: [],
    focus: null,
  };
}

export function normalizeTiledWorkspaces(rawWorkspaces: unknown, context: WorkspaceContext) {
  if (!Array.isArray(rawWorkspaces)) return { workspaces: [] as RhizoWorkspace[], activeWorkspaceId: undefined as string | undefined };

  const seenWorkspaceIds = new Set<string>();
  const workspaces = rawWorkspaces
    .map((workspace, index) => normalizeTiledWorkspace(workspace, context, index, seenWorkspaceIds))
    .filter((workspace): workspace is RhizoWorkspace => Boolean(workspace));

  const activeWorkspaceId = cleanString(context.activeWorkspaceId);
  return {
    workspaces,
    activeWorkspaceId: workspaces.some((workspace) => workspace.id === activeWorkspaceId)
      ? activeWorkspaceId
      : workspaces[0]?.id,
  };
}

export function normalizeTiledWorkspace(
  rawWorkspace: unknown,
  context: Omit<WorkspaceContext, 'activeWorkspaceId'>,
  index = 0,
  seenWorkspaceIds = new Set<string>(),
): RhizoWorkspace | null {
  if (!isPlainObject(rawWorkspace)) return null;
  if (rawWorkspace.kind && rawWorkspace.kind !== 'tiled' && rawWorkspace.kind !== 'bottomless-tiled') return null;

  const fallbackId = index === 0 ? DEFAULT_TILED_WORKSPACE_ID : `${DEFAULT_TILED_WORKSPACE_ID}-${index + 1}`;
  const id = uniqueId(cleanString(rawWorkspace.id, fallbackId), fallbackId, seenWorkspaceIds);
  const now = new Date().toISOString();
  const projection = normalizeTiledProjection(rawWorkspace.projection);
  const pageOverrides = normalizeTiledPageStates(rawWorkspace.pages, context.nodes);
  const floating = normalizeTiledFloatingPages(rawWorkspace.floating, context.nodes);
  const projected = projectTiledColumns(context.nodes, context.edges, {
    projection,
    columns: Array.isArray(rawWorkspace.columns) ? rawWorkspace.columns : [],
    pages: pageOverrides,
  }, context.annotations || []);

  return {
    id,
    name: cleanString(rawWorkspace.name, index === 0 ? '默认平铺视图' : `平铺视图 ${index + 1}`).slice(0, 80),
    kind: 'bottomless-tiled',
    createdAt: cleanString(rawWorkspace.createdAt, now),
    updatedAt: cleanString(rawWorkspace.updatedAt, now),
    projection,
    columns: projected.columns,
    pages: pageOverrides,
    floating,
    focus: normalizeTiledFocus(rawWorkspace.focus, context.nodes, id),
  };
}

export function projectTiledColumns(
  nodes: RhizoNode[],
  edges: RhizoEdge[],
  workspace: Pick<RhizoWorkspace, 'projection'> & Partial<Pick<RhizoWorkspace, 'columns' | 'pages'>> = { projection: { mode: 'depth', includeOrphans: true } },
  annotations: RhizoAnnotation[] = [],
): TiledProjectionResult {
  const nodeIds = new Set(nodes.map((node) => node.id).filter(Boolean));
  if (nodeIds.size === 0) return { rootId: null, depths: {}, orphanNodeIds: [], columns: [], pageLayouts: {} };

  const projection = normalizeTiledProjection(workspace.projection);
  const readingOrder = buildReadingOrderContext(nodes, annotations);
  const rootId = selectProjectionRoot(nodes, nodeIds, projection.rootId);
  const childrenByNode = buildChildrenByNode(nodes, edges, nodeIds);
  const depths = rootId ? collectDepths(rootId, childrenByNode, projection.maxDepth) : {};
  const orphanNodeIds = nodes.map((node) => node.id).filter((id) => !Object.hasOwn(depths, id));

  if (projection.includeOrphans) {
    orphanNodeIds.forEach((id) => {
      depths[id] = 0;
    });
  }

  const pageIdsByDepth = new Map<number, string[]>();
  for (const node of nodes) {
    const depth = depths[node.id];
    if (!Number.isFinite(depth)) continue;
    const pageIds = pageIdsByDepth.get(depth) || [];
    pageIds.push(node.id);
    pageIdsByDepth.set(depth, pageIds);
  }

  pageIdsByDepth.forEach((pageIds) => pageIds.sort((a, b) => compareReadingOrder(a, b, readingOrder)));

  const visibleNodeIds = new Set([...pageIdsByDepth.values()].flat());
  const persistedColumnsByDepth = new Map<number, TiledColumn>();
  for (const column of workspace.columns || []) {
    const depth = finiteNumber((column as TiledColumn).depth, NaN);
    if (!Number.isFinite(depth)) continue;
    if (!persistedColumnsByDepth.has(depth)) persistedColumnsByDepth.set(depth, column as TiledColumn);
  }

  const persistedPageIdsByDepth = new Map<number, string[]>();
  const persistedPageIds = new Set<string>();
  [...persistedColumnsByDepth.entries()]
    .sort(([a], [b]) => a - b)
    .forEach(([depth, column]) => {
      for (const pageId of column.pageIds || []) {
        if (!visibleNodeIds.has(pageId) || persistedPageIds.has(pageId)) continue;
        if (depths[pageId] !== depth) continue;
        persistedPageIds.add(pageId);
        const columnPageIds = persistedPageIdsByDepth.get(depth) || [];
        columnPageIds.push(pageId);
        persistedPageIdsByDepth.set(depth, columnPageIds);
      }
    });

  const allDepths = new Set([...pageIdsByDepth.keys(), ...persistedColumnsByDepth.keys()]);
  const columns = [...allDepths]
    .sort((a, b) => a - b)
    .map((depth) => normalizeProjectedColumn(
      depth,
      pageIdsByDepth.get(depth) || [],
      persistedColumnsByDepth.get(depth),
      persistedPageIdsByDepth.get(depth) || [],
      persistedPageIds,
      readingOrder,
    ))
    .filter((column) => column.pageIds.length > 0);

  return { rootId, depths, orphanNodeIds, columns, pageLayouts: buildTiledPageLayouts(columns, workspace.pages || {}) };
}

function normalizeProjectedColumn(
  depth: number,
  derivedPageIds: string[],
  persistedColumn: TiledColumn | undefined,
  persistedPageIdsForColumn: string[],
  persistedPageIds: Set<string>,
  readingOrder: ReadingOrderContext,
): TiledColumn {
  const orderedPageIds: string[] = [];
  const seenPageIds = new Set<string>();

  for (const pageId of persistedPageIdsForColumn) {
    if (seenPageIds.has(pageId)) continue;
    seenPageIds.add(pageId);
    orderedPageIds.push(pageId);
  }
  for (const pageId of derivedPageIds) {
    if (persistedPageIds.has(pageId) || seenPageIds.has(pageId)) continue;
    seenPageIds.add(pageId);
    orderedPageIds.push(pageId);
  }

  return {
    id: cleanString(persistedColumn?.id, `depth-${depth}`),
    depth,
    width: clampNumber(persistedColumn?.width, MIN_TILED_COLUMN_WIDTH, MAX_TILED_COLUMN_WIDTH, DEFAULT_TILED_COLUMN_WIDTH),
    pageIds: normalizeAnnotationSiblingOrder(orderedPageIds, readingOrder),
    collapsed: Boolean(persistedColumn?.collapsed),
  };
}

function buildReadingOrderContext(nodes: RhizoNode[], annotations: RhizoAnnotation[]): ReadingOrderContext {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIndexById = new Map(nodes.map((node, index) => [node.id, index]));
  const annotationByTargetId = new Map<string, AnnotationOrderHint>();

  annotations.forEach((annotation, annotationIndex) => {
    if (!annotation.id || !nodeById.has(annotation.sourceNodeId) || !nodeById.has(annotation.targetNodeId)) return;
    const candidate = {
      annotationId: annotation.id,
      sourceNodeId: annotation.sourceNodeId,
      start: Math.max(0, finiteNumber(annotation.start, Number.MAX_SAFE_INTEGER)),
      length: Math.max(0, finiteNumber(annotation.length, 0)),
      annotationIndex,
    };
    const existing = annotationByTargetId.get(annotation.targetNodeId);
    if (!existing || compareAnnotationOrderHint(candidate, existing) < 0) annotationByTargetId.set(annotation.targetNodeId, candidate);
  });

  return { nodeById, nodeIndexById, annotationByTargetId, keyCache: new Map() };
}

function compareAnnotationOrderHint(a: AnnotationOrderHint, b: AnnotationOrderHint) {
  return a.start - b.start
    || a.length - b.length
    || a.annotationIndex - b.annotationIndex
    || a.annotationId.localeCompare(b.annotationId);
}

function normalizeAnnotationSiblingOrder(pageIds: string[], readingOrder: ReadingOrderContext): string[] {
  const normalized = [...pageIds];
  const groups = new Map<string, number[]>();

  normalized.forEach((nodeId, index) => {
    const groupKey = getAnnotationSiblingGroupKey(nodeId, readingOrder);
    if (!groupKey) return;
    const indexes = groups.get(groupKey) || [];
    indexes.push(index);
    groups.set(groupKey, indexes);
  });

  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const sortedIds = indexes.map((index) => normalized[index]).sort((a, b) => compareReadingOrder(a, b, readingOrder));
    indexes.forEach((pageIndex, sortedIndex) => {
      normalized[pageIndex] = sortedIds[sortedIndex];
    });
  }

  return normalized;
}

function getAnnotationSiblingGroupKey(nodeId: string, readingOrder: ReadingOrderContext): string {
  const hint = readingOrder.annotationByTargetId.get(nodeId);
  if (!hint) return '';
  const node = readingOrder.nodeById.get(nodeId);
  const parentId = node?.parentId || '';
  if (parentId && parentId !== hint.sourceNodeId) return '';
  return hint.sourceNodeId;
}

function compareReadingOrder(a: string, b: string, readingOrder: ReadingOrderContext) {
  const aKey = getReadingOrderKey(a, readingOrder);
  const bKey = getReadingOrderKey(b, readingOrder);
  const length = Math.max(aKey.length, bKey.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (aKey[index] ?? 0) - (bKey[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return a.localeCompare(b);
}

function getReadingOrderKey(nodeId: string, readingOrder: ReadingOrderContext, seen = new Set<string>()): number[] {
  const cached = readingOrder.keyCache.get(nodeId);
  if (cached) return cached;

  const node = readingOrder.nodeById.get(nodeId);
  const nodeIndex = readingOrder.nodeIndexById.get(nodeId) ?? Number.MAX_SAFE_INTEGER;
  if (!node || seen.has(nodeId)) return [1, nodeIndex];

  seen.add(nodeId);
  const parentId = node.parentId && readingOrder.nodeById.has(node.parentId) ? node.parentId : '';
  const parentKey = parentId ? getReadingOrderKey(parentId, readingOrder, seen) : [];
  const hint = readingOrder.annotationByTargetId.get(nodeId);
  const localKey = hint && (!parentId || hint.sourceNodeId === parentId)
    ? [0, hint.start, hint.length, hint.annotationIndex, nodeIndex]
    : [1, nodeIndex];
  const key = [...parentKey, ...localKey];
  readingOrder.keyCache.set(nodeId, key);
  return key;
}

function buildTiledPageLayouts(columns: TiledColumn[], pages: Record<string, TiledPageState>): Record<string, TiledPageLayout> {
  const baseLayouts: Record<string, TiledPageLayout> = {};
  let x = 0;

  for (const column of columns) {
    let yCursor = DEFAULT_TILED_COLUMN_HEADER_HEIGHT;
    column.pageIds.forEach((nodeId, order) => {
      const page = pages[nodeId];
      const display = page?.display || 'normal';
      const height = display === 'title'
        ? TILED_TITLE_ONLY_HEIGHT
        : clampNumber(page?.height, MIN_TILED_SECTION_HEIGHT, MAX_TILED_SECTION_HEIGHT, DEFAULT_TILED_SECTION_HEIGHT);
      baseLayouts[nodeId] = {
        nodeId,
        columnId: column.id,
        depth: column.depth,
        order,
        x,
        y: yCursor,
        width: column.width,
        height,
        display,
        columnOffsetY: 0,
      };
      yCursor += height;
    });
    x += column.width + DEFAULT_TILED_LANE_GAP;
  }

  return baseLayouts;
}

function normalizeTiledProjection(rawProjection: unknown): TiledProjection {
  const raw = isPlainObject(rawProjection) ? rawProjection : {};
  return {
    mode: 'depth',
    rootId: cleanString(raw.rootId) || undefined,
    maxDepth: raw.maxDepth === undefined ? undefined : Math.max(0, Math.floor(clampNumber(raw.maxDepth, 0, 80, 80))),
    includeOrphans: raw.includeOrphans !== false,
  };
}

function normalizeTiledPageStates(rawPages: unknown, nodes: RhizoNode[]): Record<string, TiledPageState> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const pages: Record<string, TiledPageState> = {};
  if (!isPlainObject(rawPages)) return pages;

  for (const [nodeId, rawPage] of Object.entries(rawPages)) {
    if (!nodeIds.has(nodeId) || !isPlainObject(rawPage)) continue;
    const display = normalizePageDisplay(rawPage.display, 'normal');
    pages[nodeId] = {
      nodeId,
      display,
      height: clampNumber(rawPage.height, MIN_TILED_SECTION_HEIGHT, MAX_TILED_SECTION_HEIGHT, DEFAULT_TILED_SECTION_HEIGHT),
      scrollTop: Math.max(0, finiteNumber(rawPage.scrollTop, 0)),
      pinned: Boolean(rawPage.pinned),
    };

  }
  return pages;
}

function normalizeTiledFloatingPages(rawFloating: unknown, nodes: RhizoNode[]): TiledFloatingPage[] {
  if (!Array.isArray(rawFloating)) return [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seenNodeIds = new Set<string>();
  const result: TiledFloatingPage[] = [];

  for (const rawItem of rawFloating) {
    if (!isPlainObject(rawItem)) continue;
    const nodeId = cleanString(rawItem.nodeId);
    if (!nodeIds.has(nodeId) || seenNodeIds.has(nodeId)) continue;
    seenNodeIds.add(nodeId);
    result.push({
      nodeId,
      width: clampNumber(rawItem.width, MIN_TILED_COLUMN_WIDTH, MAX_TILED_COLUMN_WIDTH, DEFAULT_TILED_COLUMN_WIDTH),
      height: clampNumber(rawItem.height, MIN_TILED_SECTION_HEIGHT, MAX_TILED_SECTION_HEIGHT, DEFAULT_TILED_SECTION_HEIGHT),
      x: rawItem.x === undefined ? undefined : finiteNumber(rawItem.x, 0),
      y: rawItem.y === undefined ? undefined : finiteNumber(rawItem.y, 0),
      zIndex: Math.max(0, Math.floor(finiteNumber(rawItem.zIndex, result.length))),
      display: normalizeFloatingDisplay(rawItem.display),
    });
  }
  return result;
}

function normalizeTiledFocus(rawFocus: unknown, nodes: RhizoNode[], workspaceId: string): TiledFocus | null {
  if (!isPlainObject(rawFocus)) return null;
  const nodeIds = new Set(nodes.map((node) => node.id));
  const region = rawFocus.region === 'floating' || rawFocus.region === 'search' ? rawFocus.region : 'columns';
  const nodeId = cleanString(rawFocus.nodeId) || undefined;
  if (nodeId && !nodeIds.has(nodeId)) return null;
  return {
    workspaceId,
    region,
    columnId: cleanString(rawFocus.columnId) || undefined,
    nodeId,
  };
}

function normalizePageDisplay(rawDisplay: unknown, fallback: TiledPageDisplay): TiledPageDisplay {
  return rawDisplay === 'title' || rawDisplay === 'compact' || rawDisplay === 'normal' || rawDisplay === 'expanded'
    ? rawDisplay
    : fallback;
}

function normalizeFloatingDisplay(rawDisplay: unknown): Exclude<TiledPageDisplay, 'title'> {
  return rawDisplay === 'compact' || rawDisplay === 'expanded' ? rawDisplay : 'normal';
}

function selectProjectionRoot(nodes: RhizoNode[], nodeIds: Set<string>, requestedRootId: string | undefined) {
  if (requestedRootId && nodeIds.has(requestedRootId)) return requestedRootId;
  const explicitRoot = nodes.find((node) => node.id === 'node-root');
  if (explicitRoot) return explicitRoot.id;
  const parentless = nodes.find((node) => !node.parentId || !nodeIds.has(node.parentId));
  return parentless?.id || nodes[0]?.id || null;
}

function buildChildrenByNode(nodes: RhizoNode[], edges: RhizoEdge[], nodeIds: Set<string>) {
  const childrenByNode = new Map<string, string[]>();
  const seenRelations = new Set<string>();
  nodeIds.forEach((id) => childrenByNode.set(id, []));

  const addRelation = (sourceId: unknown, targetId: unknown) => {
    const source = cleanString(sourceId);
    const target = cleanString(targetId);
    if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) return;
    const key = `${source}\u0000${target}`;
    if (seenRelations.has(key)) return;
    seenRelations.add(key);
    childrenByNode.get(source)?.push(target);
  };

  edges.forEach((edge) => addRelation(edge.sourceId, edge.targetId));
  nodes.forEach((node) => addRelation(node.parentId, node.id));
  return childrenByNode;
}

function collectDepths(rootId: string, childrenByNode: Map<string, string[]>, maxDepth: number | undefined) {
  const depths: Record<string, number> = { [rootId]: 0 };
  const queue = [rootId];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const sourceId = queue[cursor];
    const sourceDepth = depths[sourceId] || 0;
    if (maxDepth !== undefined && sourceDepth >= maxDepth) continue;

    for (const targetId of childrenByNode.get(sourceId) || []) {
      const nextDepth = sourceDepth + 1;
      if (Object.hasOwn(depths, targetId) && depths[targetId] <= nextDepth) continue;
      depths[targetId] = nextDepth;
      queue.push(targetId);
    }
  }

  return depths;
}

function uniqueId(rawId: string, fallbackId: string, seenIds: Set<string>) {
  const baseId = rawId.trim() || fallbackId;
  let id = baseId;
  let suffix = 2;
  while (seenIds.has(id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }
  seenIds.add(id);
  return id;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback = min): number {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)));
}
