import { unwrapMarksForTarget } from '../annotations.js';
import type { RhizoDomRefs } from '../dom.js';
import { clamp, genId, plainExcerpt, safeFileName } from '../utils.js';
import { NODE_MAX_WIDTH, NODE_MIN_WIDTH, NODE_WIDTH } from '../canvas/constants.js';
import { validateFlow } from '../../shared/schemas.js';

type GraphControllerOptions = {
  dom: RhizoDomRefs;
  state: any;
  hideMenus: () => void;
  hideWelcomeModal: () => void;
  closeServerFlowsModal: () => void;
  closeFullscreen: () => void;
  showToast: (message: string) => void;
};

export function createGraphController(options: GraphControllerOptions) {
  const { dom, state, hideMenus, hideWelcomeModal, closeServerFlowsModal, closeFullscreen, showToast } = options;
  let canvasWorkspace: any = null;
  let canvasNodes: any = null;
  let tiledWorkspace: any = null;
  let selectionController: any = null;

  function attachControllers(controllers: {
    canvasWorkspace?: any;
    canvasNodes?: any;
    tiledWorkspace?: any;
    selectionController?: any;
  }) {
    if (controllers.canvasWorkspace) canvasWorkspace = controllers.canvasWorkspace;
    if (controllers.canvasNodes) canvasNodes = controllers.canvasNodes;
    if (controllers.tiledWorkspace) tiledWorkspace = controllers.tiledWorkspace;
    if (controllers.selectionController) selectionController = controllers.selectionController;
  }

  function createDocument(title: string, content: string, { force = false }: any = {}) {
    if (!force && !confirmReplaceGraph()) return;
    resetGraph();
    state.flowName = title || '核心文档';
    state.canvas = { x: window.innerWidth / 2 - NODE_WIDTH / 2, y: 150, scale: 1 };
    const now = new Date().toISOString();
    const root = normalizeNode({
      id: 'node-root',
      title: title || '核心文档',
      content: content || '# 空文档\n\n在这里开始你的分析。',
      x: 0,
      y: 0,
      parentId: null,
      colorIndex: -1,
      kind: 'root',
      createdAt: now,
      updatedAt: now,
    });
    state.nodes.push(root);
    renderAll();
    canvasWorkspace?.updateTransform();
    hideWelcomeModal();
    showToast('初始文档已创建');
  }

  function resetGraph() {
    state.nodes = [];
    state.edges = [];
    state.annotations = [];
    state.colorIndex = 0;
    state.currentSelection = { text: '', parentNodeId: null, start: 0, length: 0, source: 'node' };
    state.contextNodeId = null;
    state.contextNodeIds = [];
    state.contextMenuSource = 'canvas';
    clearNodeSelection();
    state.fullscreenNodeId = null;
    state.workspaces = [];
    state.activeWorkspaceId = null;
    dom.fullscreenOverlay.classList.add('hidden');
    dom.selectionBox.style.display = 'none';
    dom.nodesLayer.innerHTML = '';
    dom.edgesLayer.innerHTML = '';
  }

  function renderAll() {
    canvasNodes?.renderAll();
    canvasWorkspace?.drawEdges();
    canvasWorkspace?.updateMinimap();
    updateFlowName();
    if (state.activeView === 'tiled') tiledWorkspace?.render();
  }

  function setActiveView(view: string) {
    state.activeView = view === 'tiled' ? 'tiled' : 'canvas';
    const isTiled = state.activeView === 'tiled';
    dom.viewport.classList.toggle('hidden', isTiled);
    dom.tiledWorkspace.classList.toggle('hidden', !isTiled);
    dom.viewCanvasButton.className = isTiled ? 'md-btn ghost' : 'md-btn filled tonal';
    dom.viewTiledButton.className = isTiled ? 'md-btn filled tonal' : 'md-btn ghost';
    dom.viewCanvasButton.setAttribute('aria-pressed', String(!isTiled));
    dom.viewTiledButton.setAttribute('aria-pressed', String(isTiled));
    document.body.classList.toggle('tiled-view', isTiled);
    selectionController?.hideTooltip();
    hideMenus();
    if (isTiled) tiledWorkspace?.render();
    else {
      canvasWorkspace?.drawEdges();
      canvasWorkspace?.updateMinimap();
    }
  }

  function normalizeNode(raw: any) {
    const now = new Date().toISOString();
    return {
      id: raw.id || genId('node'),
      title: String(raw.title || '未命名节点'),
      content: String(raw.content || ''),
      x: Number.isFinite(Number(raw.x)) ? Number(raw.x) : 0,
      y: Number.isFinite(Number(raw.y)) ? Number(raw.y) : 0,
      width: Number.isFinite(Number(raw.width)) ? clamp(Number(raw.width), NODE_MIN_WIDTH, NODE_MAX_WIDTH) : NODE_WIDTH,
      parentId: raw.parentId ?? null,
      dir: raw.dir === 'left' ? 'left' : 'right',
      collapsed: typeof raw.collapsed === 'boolean' ? raw.collapsed : Boolean(raw.id !== 'node-root' && (raw.kind === 'ai' || raw.parentId || raw.llm)),
      colorIndex: Number.isFinite(Number(raw.colorIndex)) ? Number(raw.colorIndex) : -1,
      loading: Boolean(raw.loading),
      kind: raw.kind || (raw.parentId ? 'ai' : 'document'),
      llm: raw.llm || null,
      error: raw.error || null,
      createdAt: raw.createdAt || now,
      updatedAt: raw.updatedAt || now,
    };
  }

  function addNode(raw: any, { createEdge = true }: any = {}) {
    const node = normalizeNode(raw);
    state.nodes.push(node);
    canvasNodes?.renderNode(node);
    if (createEdge && node.parentId) addEdge(node.parentId, node.id);
    canvasWorkspace?.drawEdges();
    canvasWorkspace?.updateMinimap();
    return node;
  }

  function deleteNodes(ids: string[]) {
    const targets = uniqueNodeIds(ids).filter((id) => id !== 'node-root');
    if (targets.length === 0) {
      showToast('根节点不能删除');
      return;
    }

    const targetSet = new Set(targets);
    const childCount = state.edges.filter((edge: any) => targetSet.has(edge.sourceId) && !targetSet.has(edge.targetId)).length;
    if (childCount > 0 && !confirm(`选中的节点还有 ${childCount} 个子节点。删除后子节点会保留但断开连接，继续吗？`)) return;
    if (targets.length > 1 && !confirm(`确定删除选中的 ${targets.length} 个节点吗？`)) return;

    for (const id of targets) unwrapMarksForTarget(id);
    state.annotations = state.annotations.filter((annotation: any) => !targetSet.has(annotation.targetNodeId) && !targetSet.has(annotation.sourceNodeId));
    state.nodes = state.nodes.filter((item: any) => !targetSet.has(item.id));
    state.nodes.forEach((item: any) => {
      if (targetSet.has(item.parentId)) item.parentId = null;
    });
    state.edges = state.edges.filter((edge: any) => !targetSet.has(edge.sourceId) && !targetSet.has(edge.targetId));
    if (targetSet.has(state.fullscreenNodeId)) closeFullscreen();
    for (const id of targets) document.getElementById(id)?.remove();
    setNodeSelection(getSelectedNodeIds().filter((id) => !targetSet.has(id)));
    state.contextNodeId = null;
    state.contextNodeIds = [];
    state.contextMenuSource = 'canvas';
    canvasWorkspace?.drawEdges();
    canvasWorkspace?.updateMinimap();
    if (state.activeView === 'tiled') tiledWorkspace?.render();
    showToast(targets.length > 1 ? `已删除 ${targets.length} 个节点` : '节点已删除');
  }

  function addEdge(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || state.edges.some((edge: any) => edge.sourceId === sourceId && edge.targetId === targetId)) return;
    state.edges.push({ id: genId('edge'), sourceId, targetId });
    canvasWorkspace?.drawEdges();
  }

  function exportFlow() {
    const flow: any = {
      version: 1,
      app: 'rhizodoc',
      name: state.flowName,
      savedAt: new Date().toISOString(),
      canvas: { ...state.canvas },
      colorIndex: state.colorIndex,
      nodes: state.nodes.map((node: any) => ({ ...node, loading: false })),
      edges: state.edges.map((edge: any) => ({ ...edge })),
      annotations: state.annotations.map((annotation: any) => ({ ...annotation })),
    };
    if (state.workspaces.length > 0) {
      flow.workspaces = state.workspaces.map((workspace: any) => ({ ...workspace }));
      if (state.activeWorkspaceId) flow.activeWorkspaceId = state.activeWorkspaceId;
    }
    return flow;
  }

  function downloadFlow() {
    if (state.nodes.length === 0) {
      showToast('当前没有可保存的流程图');
      return;
    }
    const flow = exportFlow();
    const blob = new Blob([`${JSON.stringify(flow, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeFileName(state.flowName || 'flow')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('流程图 JSON 已下载');
  }

  function loadFlow(flow: any) {
    const normalizedFlow = validateFlow(flow);
    resetGraph();
    state.flowName = normalizedFlow.name || normalizedFlow.rootTitle || '已加载流程图';
    state.canvas = normalizeCanvas(normalizedFlow.canvas);
    state.colorIndex = Number.isFinite(Number(normalizedFlow.colorIndex)) ? Number(normalizedFlow.colorIndex) : 0;
    state.nodes = normalizedFlow.nodes.map((node: any) => normalizeNode({ ...node, loading: false }));
    state.edges = normalizedFlow.edges.map((edge: any) => ({
      id: edge.id || genId('edge'),
      sourceId: edge.sourceId,
      targetId: edge.targetId,
    })).filter((edge: any) => edge.sourceId && edge.targetId);
    state.annotations = normalizedFlow.annotations.map((annotation: any) => ({
      id: annotation.id || genId('ann'),
      sourceNodeId: annotation.sourceNodeId,
      targetNodeId: annotation.targetNodeId,
      start: Number(annotation.start),
      length: Number(annotation.length),
      text: String(annotation.text || ''),
      colorIndex: Number.isFinite(Number(annotation.colorIndex)) ? Number(annotation.colorIndex) : 0,
    })).filter((annotation: any) => annotation.sourceNodeId && annotation.targetNodeId);
    state.workspaces = normalizedFlow.workspaces ? structuredClone(normalizedFlow.workspaces) : [];
    state.activeWorkspaceId = normalizedFlow.activeWorkspaceId || null;

    renderAll();
    canvasWorkspace?.updateTransform();
    hideWelcomeModal();
    closeServerFlowsModal();
    showToast('流程图已加载');
  }

  function normalizeCanvas(canvas: any) {
    return {
      x: Number.isFinite(Number(canvas?.x)) ? Number(canvas.x) : window.innerWidth / 2 - NODE_WIDTH / 2,
      y: Number.isFinite(Number(canvas?.y)) ? Number(canvas.y) : 150,
      scale: Number.isFinite(Number(canvas?.scale)) ? clamp(Number(canvas.scale), 0.18, 3) : 1,
    };
  }

  function uniqueNodeIds(ids: string[]) {
    const seen = new Set();
    const result = [];
    for (const id of ids || []) {
      if (!id || seen.has(id) || !getNode(id)) continue;
      seen.add(id);
      result.push(id);
    }
    return result;
  }

  function getSelectedNodeIds() {
    return state.nodes.map((node: any) => node.id).filter((id: string) => state.selectedNodeIds.has(id));
  }

  function isNodeSelected(id: string) {
    return state.selectedNodeIds.has(id);
  }

  function setNodeSelection(ids: string[]) {
    state.selectedNodeIds = new Set(uniqueNodeIds(ids));
    syncNodeSelectionClasses();
  }

  function clearNodeSelection() {
    setNodeSelection([]);
  }

  function selectOnlyNode(id: string) {
    setNodeSelection(id ? [id] : []);
  }

  function toggleNodeSelection(id: string) {
    if (!getNode(id)) return;
    const next = new Set<string>(getSelectedNodeIds());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setNodeSelection([...next]);
  }

  function syncNodeSelectionClasses() {
    document.querySelectorAll('.node').forEach((nodeEl) => {
      nodeEl.classList.toggle('selected', state.selectedNodeIds.has(nodeEl.id));
    });
  }

  function getActionNodeIds(clickedId: string) {
    const selected = getSelectedNodeIds();
    return selected.length > 1 && selected.includes(clickedId) ? selected : [clickedId];
  }

  function getContextNodeIds() {
    return state.contextNodeIds.length > 0 ? state.contextNodeIds : (state.contextNodeId ? [state.contextNodeId] : []);
  }

  function confirmReplaceGraph() {
    if (state.nodes.length === 0) return true;
    return confirm('当前流程图将被替换。请确认已保存，是否继续？');
  }

  function getGraphSummary(excludeId = null) {
    return state.nodes
      .filter((node: any) => node.id !== excludeId)
      .slice(0, 40)
      .map((node: any, index: number) => `${index + 1}. ${node.title}：${plainExcerpt(node.content, 220)}`)
      .join('\n');
  }

  function getRootNode() {
    return state.nodes.find((node: any) => node.id === 'node-root') || state.nodes.find((node: any) => !node.parentId) || null;
  }

  function getNode(id: string) {
    return state.nodes.find((node: any) => node.id === id) || null;
  }

  function updateFlowName() {
    dom.flowName.textContent = state.flowName || '未命名流程图';
  }

  return {
    attachControllers,
    createDocument,
    resetGraph,
    renderAll,
    setActiveView,
    normalizeNode,
    addNode,
    deleteNodes,
    addEdge,
    exportFlow,
    downloadFlow,
    loadFlow,
    normalizeCanvas,
    uniqueNodeIds,
    getSelectedNodeIds,
    isNodeSelected,
    setNodeSelection,
    clearNodeSelection,
    selectOnlyNode,
    toggleNodeSelection,
    getActionNodeIds,
    getContextNodeIds,
    confirmReplaceGraph,
    getGraphSummary,
    getRootNode,
    getNode,
    updateFlowName,
  };
}
