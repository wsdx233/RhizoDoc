import type { LLMGeneratePayload, LLMMode, RhizoAnnotation, RhizoCanvas, RhizoEdge, RhizoFlow, RhizoNode } from './types.js';

/**
 * Runtime schemas for RhizoDoc data exchanged between browser and server.
 * These helpers intentionally stay lightweight so they can be shared by
 * Node and the browser before/after bundling.
 */

export const FLOW_SCHEMA_VERSION = 1;
export const RHIZODOC_APP_ID = 'rhizodoc';

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampNumber(value: unknown, min: number, max: number, fallback = min): number {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)));
}

export function cleanString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return fallback;
  return String(value);
}

export function normalizeFlowName(rawName: unknown, fallback = 'untitled'): string {
  const base = cleanString(rawName, fallback)
    .trim()
    .replace(/\.json$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 90);
  return base || fallback;
}

export function validateLLMPayload(raw: unknown): LLMGeneratePayload {
  if (!isPlainObject(raw)) throw new Error('LLM 请求体必须是对象。');
  const allowedModes = new Set<LLMMode>(['selection', 'node', 'canvas', 'initial', 'regenerate']);
  const mode = cleanString(raw.mode || 'selection').slice(0, 40) as LLMMode;
  return {
    mode: allowedModes.has(mode) ? mode : 'selection',
    userPrompt: cleanString(raw.userPrompt || raw.prompt || '请详细解释并扩展成一个可读的知识节点。').slice(0, 4000),
    selectedText: cleanString(raw.selectedText).slice(0, 12000),
    parentTitle: cleanString(raw.parentTitle).slice(0, 200),
    parentContent: cleanString(raw.parentContent).slice(0, 18000),
    rootTitle: cleanString(raw.rootTitle).slice(0, 200),
    graphSummary: cleanString(raw.graphSummary).slice(0, 8000),
    apiType: '',
  };
}

export function validateFlow(flow: unknown, { requireEdges = true }: { requireEdges?: boolean } = {}): RhizoFlow {
  if (!isPlainObject(flow)) throw new Error('流程图数据必须是对象。');
  if (!Array.isArray(flow.nodes)) throw new Error('流程图数据格式不正确：nodes 必须是数组。');
  if (requireEdges && !Array.isArray(flow.edges)) throw new Error('流程图数据格式不正确：edges 必须是数组。');

  const nodeIds = new Set<string>();
  const nodes = flow.nodes.map((node, index) => validateNode(node, index, nodeIds));
  const edges = (Array.isArray(flow.edges) ? flow.edges : []).map(validateEdge).filter((edge) => edge.sourceId && edge.targetId);
  const annotations = (Array.isArray(flow.annotations) ? flow.annotations : [])
    .map(validateAnnotation)
    .filter((annotation) => annotation.sourceNodeId && annotation.targetNodeId);

  return {
    ...flow,
    version: finiteNumber(flow.version, FLOW_SCHEMA_VERSION),
    app: cleanString(flow.app || RHIZODOC_APP_ID),
    name: cleanString(flow.name || flow.rootTitle || '未命名流程图'),
    savedAt: cleanString(flow.savedAt || new Date().toISOString()),
    canvas: validateCanvas(flow.canvas),
    colorIndex: finiteNumber(flow.colorIndex, 0),
    nodes,
    edges,
    annotations,
  } as RhizoFlow;
}

export function validateNode(raw: unknown, index = 0, seenIds = new Set<string>()): RhizoNode {
  if (!isPlainObject(raw)) throw new Error(`节点 ${index + 1} 不是对象。`);
  const fallbackId = `node-${Date.now()}-${index}`;
  let id = cleanString(raw.id || fallbackId).trim() || fallbackId;
  if (seenIds.has(id)) id = `${id}-${index}`;
  seenIds.add(id);
  const width = clampNumber(raw.width, 280, 820, 340);
  return {
    ...raw,
    id,
    parentId: raw.parentId ? cleanString(raw.parentId) : null,
    title: cleanString(raw.title || '未命名节点'),
    content: cleanString(raw.content),
    x: finiteNumber(raw.x, 0),
    y: finiteNumber(raw.y, 0),
    width,
    height: finiteNumber(raw.height, 0),
    collapsed: Boolean(raw.collapsed),
    generated: Boolean(raw.generated),
    loading: false,
    direction: raw.direction === 'left' ? 'left' : 'right',
    createdAt: cleanString(raw.createdAt || new Date().toISOString()),
  } as RhizoNode;
}

export function validateEdge(raw: unknown): RhizoEdge {
  if (!isPlainObject(raw)) return { id: '', sourceId: '', targetId: '' };
  return {
    ...raw,
    id: cleanString(raw.id || `edge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    sourceId: cleanString(raw.sourceId),
    targetId: cleanString(raw.targetId),
  } as RhizoEdge;
}

export function validateAnnotation(raw: unknown): RhizoAnnotation {
  if (!isPlainObject(raw)) {
    return { id: '', sourceNodeId: '', targetNodeId: '', start: 0, length: 0, text: '', colorIndex: 0 };
  }
  return {
    ...raw,
    id: cleanString(raw.id || `ann-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    sourceNodeId: cleanString(raw.sourceNodeId),
    targetNodeId: cleanString(raw.targetNodeId),
    start: Math.max(0, finiteNumber(raw.start, 0)),
    length: Math.max(0, finiteNumber(raw.length, 0)),
    text: cleanString(raw.text),
    colorIndex: finiteNumber(raw.colorIndex, 0),
  } as RhizoAnnotation;
}

export function validateCanvas(canvas: unknown): RhizoCanvas {
  const raw = isPlainObject(canvas) ? canvas : {};
  return {
    x: finiteNumber(raw.x, 0),
    y: finiteNumber(raw.y, 150),
    scale: clampNumber(raw.scale, 0.18, 3, 1),
  };
}

export function isFlowObject(value: unknown): value is RhizoFlow {
  return isPlainObject(value) && Array.isArray(value.nodes) && Array.isArray(value.edges);
}
