import './styles.css';
import { fetchJson } from './api.js';
import { demoDocument } from './demo.js';
import { byId, collectDomRefs } from './dom.js';
import { positionContextMenu } from './floating.js';
import { createFullscreenController } from './fullscreen-controller.js';
import { createGraphController } from './graph/controller.js';
import { createLLMGenerationController } from './llm/generation.js';
import { createNodeRenderCoordinator } from './node-rendering.js';
import { createSelectionController } from './selection-controller.js';
import { createServerFlowsController } from './server-flows-controller.js';
import { NODE_WIDTH } from './canvas/constants.js';
import { createCanvasWorkspaceController } from './canvas/controller.js';
import { createCanvasInteractionsController, isEditableTarget } from './canvas/interactions.js';
import { createCanvasNodesController } from './canvas/nodes.js';
import { createTiledWorkspaceController } from './tiled/controller.js';
import { createProgressCard as createProgressCardElement, showToast as showToastMessage } from './ui.js';
import { escapeHtml } from './utils.js';
import { isFlowObject as isValidFlowShape } from '../shared/schemas.js';
import type { ApiConfigResponse } from '../shared/types.js';

const state: any = {
  canvas: { x: window.innerWidth / 2 - NODE_WIDTH / 2, y: 160, scale: 1 },
  isMoveMode: false,
  isMultiSelectMode: false,
  isNodeDragMode: false,
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  isDraggingNode: false,
  draggedNodeId: null,
  nodeDragOffset: { x: 0, y: 0 },
  nodeDragIds: [],
  nodeDragStartPoint: { x: 0, y: 0 },
  nodeDragStartClient: { x: 0, y: 0 },
  nodeDragStartPositions: [],
  nodeDragMoved: false,
  nodeDragStartedInMoveMode: false,
  suppressNodeClick: false,
  isMarqueeSelecting: false,
  marqueeStart: { x: 0, y: 0 },
  marqueeMoved: false,
  marqueeStartNodeId: null,
  marqueeBaseSelectionIds: [],
  isResizing: false,
  resizeNodeId: null,
  resizeStartWidth: 0,
  resizeStartNodeX: 0,
  resizeStartX: 0,
  resizeHandleSide: 'right',
  isDraggingMinimap: false,
  nodes: [],
  edges: [],
  annotations: [],
  colorIndex: 0,
  currentSelection: { text: '', parentNodeId: null, start: 0, length: 0, source: 'node' },
  isNativeTextSelecting: false,
  deferredRenderNodeIds: new Set(),
  deferredRenderPayloads: new Map(),
  keepTooltipAfterSelectionClear: false,
  contextNodeId: null,
  contextNodeIds: [],
  contextMenuSource: 'canvas',
  contextCanvasPoint: { x: 0, y: 0 },
  selectedNodeIds: new Set(),
  pendingLLM: null,
  fullscreenNodeId: null,
  flowName: '未命名流程图',
  workspaces: [],
  activeWorkspaceId: null,
  activeView: 'canvas',
  appConfig: null,
  minimapBounds: null,
};

const DOM = collectDomRefs();
let llmGeneration;
let fullscreen;
let serverFlows;
const graph = createGraphController({
  dom: DOM,
  state,
  hideMenus,
  hideWelcomeModal,
  closeServerFlowsModal: () => serverFlows.close(),
  closeFullscreen: () => fullscreen.close(),
  showToast,
});
const nodeRendering = createNodeRenderCoordinator({
  dom: DOM,
  state,
  getNode: graph.getNode,
});
const selectionController = createSelectionController({
  dom: DOM,
  state,
  getNode: graph.getNode,
  nodeRendering,
  hideMenus,
  submitSelection: () => llmGeneration.triggerSelection(),
});
const canvasWorkspace = createCanvasWorkspaceController({
  dom: DOM,
  state,
  getNode: graph.getNode,
});
fullscreen = createFullscreenController({
  dom: DOM,
  state,
  getNode: graph.getNode,
  nodeRendering,
  selectionController,
  canvasWorkspace,
});
const tiledWorkspace = createTiledWorkspaceController({
  root: DOM.tiledWorkspace,
  state,
  getNode: graph.getNode,
  openFullscreen: fullscreen.open,
  isEditableTarget,
});
const canvasNodes = createCanvasNodesController({
  nodesLayer: DOM.nodesLayer,
  state,
  getNode: graph.getNode,
  isNodeSelected: graph.isNodeSelected,
  canvasWorkspace,
  tiledWorkspace,
  shouldPreserveNodeContentForSelection: nodeRendering.shouldPreserveContentForSelection,
  syncFullscreenContent: nodeRendering.syncFullscreenContent,
});
nodeRendering.attachControllers({ canvasNodes, tiledWorkspace });
const canvasInteractions = createCanvasInteractionsController({
  dom: DOM,
  state,
  getNode: graph.getNode,
  canvasWorkspace,
  canvasNodes,
  getSelectedNodeIds: graph.getSelectedNodeIds,
  setNodeSelection: graph.setNodeSelection,
  clearNodeSelection: graph.clearNodeSelection,
  toggleNodeSelection: graph.toggleNodeSelection,
  getActionNodeIds: graph.getActionNodeIds,
  hideTooltip: selectionController.hideTooltip,
  hideMenus,
  openFullscreen: fullscreen.open,
});
graph.attachControllers({ canvasWorkspace, canvasNodes, tiledWorkspace, selectionController });
serverFlows = createServerFlowsController({
  dom: DOM,
  state,
  graph,
  showToast,
});
llmGeneration = createLLMGenerationController({
  dom: DOM,
  state,
  getNode: graph.getNode,
  getRootNode: graph.getRootNode,
  getGraphSummary: graph.getGraphSummary,
  uniqueNodeIds: graph.uniqueNodeIds,
  createDocument: graph.createDocument,
  addNode: graph.addNode,
  confirmReplaceGraph: graph.confirmReplaceGraph,
  updateFlowName: graph.updateFlowName,
  createProgressCard,
  showToast,
  canvasWorkspace,
  canvasNodes,
  tiledWorkspace,
  nodeRendering,
  selectionController,
});

init();

async function init() {
  bindEvents();
  canvasWorkspace.updateTransform();
  graph.updateFlowName();
  await loadAppConfig();
  showWelcomeModal();
}

function bindEvents() {
  byId('btn-open-initial-file').addEventListener('click', () => DOM.initialFileInput.click());
  DOM.initialFileInput.addEventListener('change', async () => {
    await handleDocumentFile(DOM.initialFileInput.files?.[0], { fromInitial: true });
    DOM.initialFileInput.value = '';
  });

  byId('btn-create-initial').addEventListener('click', () => {
    graph.createDocument(DOM.initialTitle.value.trim() || '核心文档', DOM.initialContent.value || '', { force: state.nodes.length === 0 });
  });
  DOM.initialGenerateButton.addEventListener('click', llmGeneration.generateInitialDocument);
  DOM.initialGeneratePrompt.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') llmGeneration.generateInitialDocument();
  });

  byId('btn-use-demo').addEventListener('click', () => {
    graph.createDocument('RhizoDoc 演示', demoDocument(), { force: state.nodes.length === 0 });
  });
  DOM.welcomeModal.addEventListener('mousedown', (event) => {
    if (event.target === DOM.welcomeModal) hideWelcomeModal();
  });

  byId('btn-new-doc').addEventListener('click', showWelcomeModal);
  byId('btn-open-doc').addEventListener('click', () => DOM.docFileInput.click());
  DOM.docFileInput.addEventListener('change', async () => {
    await handleDocumentFile(DOM.docFileInput.files?.[0], { fromInitial: false });
    DOM.docFileInput.value = '';
  });

  byId('btn-save-flow').addEventListener('click', graph.downloadFlow);
  byId('btn-load-flow').addEventListener('click', () => DOM.flowFileInput.click());
  DOM.flowFileInput.addEventListener('change', async () => {
    await handleFlowFile(DOM.flowFileInput.files?.[0]);
    DOM.flowFileInput.value = '';
  });
  byId('btn-server-save').addEventListener('click', serverFlows.save);
  byId('btn-server-load').addEventListener('click', serverFlows.open);
  byId('btn-flows-close').addEventListener('click', serverFlows.close);
  byId('btn-refresh-flows').addEventListener('click', serverFlows.refresh);
  DOM.viewCanvasButton.addEventListener('click', () => graph.setActiveView('canvas'));
  DOM.viewTiledButton.addEventListener('click', () => graph.setActiveView('tiled'));

  DOM.viewport.addEventListener('mousedown', canvasInteractions.handleViewportMouseDown);
  DOM.viewport.addEventListener('auxclick', canvasInteractions.handleViewportAuxClick);
  DOM.nodesLayer.addEventListener('mousedown', canvasInteractions.handleNodesLayerMouseDown);
  DOM.nodesLayer.addEventListener('click', canvasInteractions.handleNodesLayerClick);
  DOM.tiledWorkspace.addEventListener('click', tiledWorkspace.handleClick);
  DOM.tiledWorkspace.addEventListener('auxclick', tiledWorkspace.handleAuxClick);
  DOM.tiledWorkspace.addEventListener('contextmenu', onTiledContextMenu);
  DOM.tiledWorkspace.addEventListener('scroll', tiledWorkspace.handleScroll, true);
  DOM.tiledWorkspace.addEventListener('pointerdown', tiledWorkspace.handlePointerDown);
  DOM.tiledWorkspace.addEventListener('pointermove', tiledWorkspace.handlePointerMove);
  DOM.tiledWorkspace.addEventListener('pointerup', tiledWorkspace.handlePointerUp);
  DOM.tiledWorkspace.addEventListener('pointercancel', tiledWorkspace.handlePointerCancel);
  window.addEventListener('mousemove', canvasInteractions.handleWindowMouseMove);
  window.addEventListener('mouseup', canvasInteractions.handleWindowMouseUp);
  document.addEventListener('mouseup', selectionController.handleDocumentMouseUp, true);
  DOM.viewport.addEventListener('wheel', canvasInteractions.handleViewportWheel, { passive: false });
  window.addEventListener('resize', () => {
    canvasWorkspace.drawEdges();
    canvasWorkspace.updateMinimap();
  });

  document.addEventListener('selectionchange', selectionController.handleSelection);
  document.addEventListener('mousedown', selectionController.handleDocumentMouseDown);

  DOM.tooltipView.addEventListener('click', selectionController.focusTooltipPrompt);
  DOM.promptInput.addEventListener('focus', selectionController.handlePromptFocus);
  DOM.promptInput.addEventListener('blur', selectionController.handlePromptBlur);
  DOM.promptInput.addEventListener('keydown', selectionController.handlePromptKeydown);
  byId('btn-confirm').addEventListener('click', llmGeneration.triggerSelection);
  byId('btn-cancel').addEventListener('click', () => selectionController.hideTooltip());

  DOM.viewport.addEventListener('contextmenu', onContextMenu);
  byId('menu-fullscreen').addEventListener('click', () => {
    hideMenus();
    fullscreen.open(state.contextNodeId);
  });
  byId('menu-toggle-collapse').addEventListener('click', () => {
    const ids = graph.getContextNodeIds();
    const source = state.contextMenuSource;
    hideMenus();
    if (source === 'tiled') tiledWorkspace.toggleTitleOnly(ids);
    else canvasNodes.toggleManyCollapse(ids);
  });
  byId('menu-ai-child').addEventListener('click', () => {
    hideMenus();
    llmGeneration.openDialog({ mode: 'node', parentNodeId: state.contextNodeId });
  });
  byId('menu-ai-canvas').addEventListener('click', () => {
    hideMenus();
    llmGeneration.openDialog({ mode: 'canvas', position: { ...state.contextCanvasPoint } });
  });
  byId('menu-regen').addEventListener('click', () => {
    const ids = graph.getContextNodeIds();
    hideMenus();
    llmGeneration.regenerateNodes(ids);
  });
  byId('menu-delete').addEventListener('click', () => {
    const ids = graph.getContextNodeIds();
    hideMenus();
    graph.deleteNodes(ids);
  });
  byId('menu-zoom-in').addEventListener('click', () => { hideMenus(); canvasWorkspace.zoom(0.2, window.innerWidth / 2, window.innerHeight / 2); });
  byId('menu-zoom-out').addEventListener('click', () => { hideMenus(); canvasWorkspace.zoom(-0.2, window.innerWidth / 2, window.innerHeight / 2); });
  byId('menu-zoom-fit').addEventListener('click', () => { hideMenus(); canvasWorkspace.zoomFit(); });
  byId('menu-center').addEventListener('click', () => { hideMenus(); canvasWorkspace.center(); });

  byId('btn-center').addEventListener('click', canvasWorkspace.center);
  byId('btn-zoom-in').addEventListener('click', () => { canvasWorkspace.zoom(0.2, window.innerWidth / 2, window.innerHeight / 2); selectionController.hideTooltip(); });
  byId('btn-zoom-out').addEventListener('click', () => { canvasWorkspace.zoom(-0.2, window.innerWidth / 2, window.innerHeight / 2); selectionController.hideTooltip(); });
  byId('btn-zoom-fit').addEventListener('click', canvasWorkspace.zoomFit);
  DOM.minimap.addEventListener('mousedown', canvasInteractions.handleMinimapMouseDown);

  byId('btn-fs-close').addEventListener('click', fullscreen.close);
  DOM.fullscreenOverlay.addEventListener('mousedown', fullscreen.handleOverlayMouseDown);
  DOM.fsContent.addEventListener('click', fullscreen.handleContentClick);

  byId('btn-llm-close').addEventListener('click', llmGeneration.closeDialog);
  byId('btn-llm-cancel').addEventListener('click', llmGeneration.closeDialog);
  byId('btn-llm-submit').addEventListener('click', llmGeneration.submitDialog);
  DOM.llmPrompt.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') llmGeneration.submitDialog();
  });

  window.addEventListener('keydown', (event) => {
    canvasInteractions.updateInteractionModes(event);
    if (state.activeView === 'tiled' && tiledWorkspace.handleKeydown(event)) return;
    if (event.key !== 'Escape') return;
    canvasInteractions.cancelMarqueeSelection();
    selectionController.hideTooltip();
    hideMenus();
    fullscreen.close();
    llmGeneration.closeDialog();
    serverFlows.close();
  });
  window.addEventListener('keyup', canvasInteractions.updateInteractionModes);
  window.addEventListener('blur', canvasInteractions.resetModifierModes);
}

async function loadAppConfig() {
  try {
    const config = await fetchJson<ApiConfigResponse>('/api/config');
    state.appConfig = config;
    if (config.ready || config.hasApiKey) {
      DOM.apiStatus.className = 'status-cluster ok';
      DOM.apiStatus.innerHTML = [
        '<span class="status-chip ready-chip"><svg class="status-fan status-fan-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="M480-480q0-91 64.5-155.5T700-700q91 0 155.5 64.5T920-480H480ZM104.5-324.5Q40-389 40-480h440q0 91-64.5 155.5T260-260q-91 0-155.5-64.5ZM480-480q-91 0-155.5-64.5T260-700q0-91 64.5-155.5T480-920v440Zm0 440v-440q91 0 155.5 64.5T700-260q0 91-64.5 155.5T480-40Z"/></svg>就绪</span>',
        `<span class="status-chip" title="Pi Provider"><span class="material-symbols-outlined">hub</span>${escapeHtml(config.provider || 'pi')}</span>`,
        `<span class="status-chip" title="模型"><span class="material-symbols-outlined">deployed_code</span>${escapeHtml(config.modelName || config.model || '未设置模型')}</span>`,
        `<span class="status-chip" title="Thinking"><span class="material-symbols-outlined">psychology_alt</span>${escapeHtml(config.reasoningEffort || 'off')}</span>`,
      ].join('');
    } else {
      DOM.apiStatus.className = 'status-cluster warn';
      DOM.apiStatus.innerHTML = [
        '<span class="status-chip ready-chip"><span class="material-symbols-outlined">warning</span>未配置</span>',
        `<span class="status-chip" title="${escapeHtml(config.error || '请在 pi 中配置默认模型和凭据')}"><span class="material-symbols-outlined">settings</span>Pi 模型未就绪</span>`,
      ].join('');
    }
  } catch (error) {
    DOM.apiStatus.className = 'status-cluster error';
    DOM.apiStatus.innerHTML = '<span class="status-chip ready-chip"><span class="material-symbols-outlined">error</span>状态失败</span>';
    console.error(error);
  }
}

function showWelcomeModal() {
  DOM.welcomeModal.classList.remove('hidden');
}

function hideWelcomeModal() {
  DOM.welcomeModal.classList.add('hidden');
}

async function handleDocumentFile(file, { fromInitial = false } = {}) {
  if (!file) return;
  try {
    const text = await file.text();
    if (file.name.toLowerCase().endsWith('.json')) {
      try {
        const json = JSON.parse(text);
        if (isFlowObject(json)) {
          if ((fromInitial && state.nodes.length === 0) || graph.confirmReplaceGraph()) {
            graph.loadFlow(json);
            hideWelcomeModal();
          }
          return;
        }
      } catch {
        // 普通 JSON 文档会作为文本打开。
      }
    }

    const title = file.name.replace(/\.[^.]+$/, '') || '本地文档';
    graph.createDocument(title, text, { force: fromInitial && state.nodes.length === 0 });
  } catch (error) {
    showToast(`读取文件失败：${error.message}`);
  }
}

async function handleFlowFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const flow = JSON.parse(text);
    if (!isFlowObject(flow)) throw new Error('这不是有效的流程图 JSON。');
    if (!graph.confirmReplaceGraph()) return;
    graph.loadFlow(flow);
  } catch (error) {
    showToast(`加载流程图失败：${error.message}`);
  }
}

function hideMenus() {
  DOM.nodeMenu.style.display = 'none';
  DOM.canvasMenu.style.display = 'none';
}

function onContextMenu(event) {
  event.preventDefault();
  selectionController.hideTooltip();
  const nodeEl = (event.target as Element).closest('.node') as HTMLElement | null;

  if (nodeEl) {
    if (!graph.isNodeSelected(nodeEl.id)) graph.selectOnlyNode(nodeEl.id);
    configureCanvasNodeContextMenu(nodeEl.id, graph.getActionNodeIds(nodeEl.id));
    DOM.canvasMenu.style.display = 'none';
    showMenu(DOM.nodeMenu, event.clientX, event.clientY);
  } else {
    state.contextNodeId = null;
    state.contextNodeIds = [];
    state.contextMenuSource = 'canvas';
    state.contextCanvasPoint = canvasWorkspace.screenToCanvas(event.clientX, event.clientY);
    DOM.nodeMenu.style.display = 'none';
    showMenu(DOM.canvasMenu, event.clientX, event.clientY);
  }
}

function onTiledContextMenu(event) {
  event.preventDefault();
  selectionController.hideTooltip();
  const section = (event.target as Element).closest('.tiled-section') as HTMLElement | null;
  const nodeId = section?.dataset.nodeId;
  if (!nodeId || !graph.getNode(nodeId)) {
    state.contextNodeId = null;
    state.contextNodeIds = [];
    state.contextMenuSource = 'tiled';
    hideMenus();
    return;
  }

  tiledWorkspace.focusNode(nodeId, { scroll: false });
  configureTiledNodeContextMenu(nodeId);
  DOM.canvasMenu.style.display = 'none';
  showMenu(DOM.nodeMenu, event.clientX, event.clientY);
}

function configureCanvasNodeContextMenu(nodeId, contextIds) {
  state.contextNodeId = nodeId;
  state.contextNodeIds = contextIds;
  state.contextMenuSource = 'canvas';
  const selectedNodes = contextIds.map((id) => graph.getNode(id)).filter(Boolean);
  const toggleMenu = byId('menu-toggle-collapse');
  const collapsibleIds = contextIds.filter((id) => document.getElementById(id)?.classList.contains('collapsible'));
  const shouldCollapse = collapsibleIds.some((id) => !graph.getNode(id)?.collapsed);
  setMenuItemLabel(toggleMenu, shouldCollapse ? 'unfold_less' : 'unfold_more', shouldCollapse ? '收起内容' : '展开内容');
  toggleMenu.classList.toggle('disabled', collapsibleIds.length === 0);
  byId('menu-regen').classList.toggle('disabled', !selectedNodes.some((node) => node.id !== 'node-root' && node.llm));
  byId('menu-delete').classList.toggle('disabled', !selectedNodes.some((node) => node.id !== 'node-root'));
}

function configureTiledNodeContextMenu(nodeId) {
  state.contextNodeId = nodeId;
  state.contextNodeIds = [nodeId];
  state.contextMenuSource = 'tiled';
  const node = graph.getNode(nodeId);
  const toggleMenu = byId('menu-toggle-collapse');
  const isTitleOnly = tiledWorkspace.isTitleOnly(nodeId);
  setMenuItemLabel(toggleMenu, isTitleOnly ? 'unfold_more' : 'notes', isTitleOnly ? '展开面板' : '仅显示标题');
  toggleMenu.classList.remove('disabled');
  byId('menu-regen').classList.toggle('disabled', !(node && node.id !== 'node-root' && node.llm));
  byId('menu-delete').classList.toggle('disabled', !(node && node.id !== 'node-root'));
}

function setMenuItemLabel(menuItem, iconName, label) {
  const icon = menuItem.querySelector('.material-symbols-outlined');
  if (icon) icon.textContent = iconName;
  const textNode = Array.from(menuItem.childNodes as NodeListOf<ChildNode>).find((node) => node.nodeType === Node.TEXT_NODE);
  if (textNode) textNode.textContent = ` ${label}`;
  else menuItem.append(` ${label}`);
}

function showMenu(menu, clientX, clientY) {
  menu.style.display = 'flex';
  void positionContextMenu(menu, clientX, clientY);
}

function isFlowObject(value) {
  return isValidFlowShape(value);
}

function createProgressCard(options = {}) {
  return createProgressCardElement(DOM.progressStack, options);
}

function showToast(message) {
  showToastMessage(DOM.toast, message);
}
