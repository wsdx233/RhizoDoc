import './styles.css';
import { applyAnnotationToContainer, unwrapMarksForTarget } from './annotations.js';
import { fetchJson, postEventStream, postJson } from './api.js';
import { demoDocument } from './demo.js';
import { byId, collectDomRefs } from './dom.js';
import { forEachLogicalTextSegment, getLogicalRangeSelection } from './logical-text.js';
import { postProcessNodeContent, renderMarkdown } from './markdown.js';
import { renderStreamdownMarkdown, unmountStreamdownMarkdown } from './streamdown-renderer.js';
import { createTiledWorkspaceController } from './tiled-workspace.js';
import { createProgressCard as createProgressCardElement, showToast as showToastMessage, updateProgressCard } from './ui.js';
import { clamp, closestElement, codeFenceText, cssAttr, escapeHtml, formatBytes, genId, plainExcerpt, safeFileName } from './utils.js';
import { normalizeGeneratedNode } from '../shared/generated-node.js';
import { isFlowObject as isValidFlowShape, validateFlow } from '../shared/schemas.js';
import type { ApiConfigResponse, FlowListResponse, LLMStreamDoneEvent, LLMStreamEvent, SaveFlowResponse } from '../shared/types.js';
const NODE_WIDTH = 340;
const NODE_MIN_WIDTH = 280;
const NODE_MAX_WIDTH = 820;
const NODE_COLLAPSE_HEIGHT = 260;
const NODE_FALLBACK_HEIGHT = 190;
const EDGE_SVG_OFFSET = 8000;
const DEFAULT_PROMPT = '请详细解释并扩展成一个可读的知识节点。';
const MARQUEE_DRAG_THRESHOLD = 4;

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
  keepTooltipAfterSelectionClear: false,
  contextNodeId: null,
  contextNodeIds: [],
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
const tiledWorkspace = createTiledWorkspaceController({
  root: DOM.tiledWorkspace,
  state,
  getNode,
  setActiveView,
  focusCanvasNode: focusNode,
  openFullscreen,
  isEditableTarget,
});

init();

async function init() {
  bindEvents();
  updateCanvasTransform();
  updateFlowName();
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
    createDocument(DOM.initialTitle.value.trim() || '核心文档', DOM.initialContent.value || '', { force: state.nodes.length === 0 });
  });
  DOM.initialGenerateButton.addEventListener('click', generateInitialDocument);
  DOM.initialGeneratePrompt.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') generateInitialDocument();
  });

  byId('btn-use-demo').addEventListener('click', () => {
    createDocument('RhizoDoc 演示', demoDocument(), { force: state.nodes.length === 0 });
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

  byId('btn-save-flow').addEventListener('click', downloadFlow);
  byId('btn-load-flow').addEventListener('click', () => DOM.flowFileInput.click());
  DOM.flowFileInput.addEventListener('change', async () => {
    await handleFlowFile(DOM.flowFileInput.files?.[0]);
    DOM.flowFileInput.value = '';
  });
  byId('btn-server-save').addEventListener('click', saveFlowToServer);
  byId('btn-server-load').addEventListener('click', openServerFlowsModal);
  byId('btn-flows-close').addEventListener('click', closeServerFlowsModal);
  byId('btn-refresh-flows').addEventListener('click', refreshServerFlows);
  DOM.viewCanvasButton.addEventListener('click', () => setActiveView('canvas'));
  DOM.viewTiledButton.addEventListener('click', () => setActiveView('tiled'));

  DOM.viewport.addEventListener('mousedown', onViewportMouseDown);
  DOM.viewport.addEventListener('auxclick', onViewportAuxClick);
  DOM.nodesLayer.addEventListener('mousedown', onNodesLayerMouseDown);
  DOM.nodesLayer.addEventListener('click', onNodesLayerClick);
  DOM.tiledWorkspace.addEventListener('click', tiledWorkspace.handleClick);
  DOM.tiledWorkspace.addEventListener('scroll', tiledWorkspace.handleScroll, true);
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);
  document.addEventListener('mouseup', (event) => {
    const wasNativeTextSelecting = state.isNativeTextSelecting;
    if (!wasNativeTextSelecting && shouldLockNativeSelectionMenu()) {
      event.preventDefault();
      lockNativeSelectionMenu();
    }
    setTimeout(() => {
      if (wasNativeTextSelecting) {
        state.isNativeTextSelecting = false;
        handleSelection();
        return;
      }
      lockNativeSelectionMenu();
    }, 0);
  }, true);
  DOM.viewport.addEventListener('wheel', onViewportWheel, { passive: false });
  window.addEventListener('resize', () => {
    drawEdges();
    updateMinimap();
  });

  document.addEventListener('selectionchange', handleSelection);
  document.addEventListener('mousedown', (event) => {
    const target = event.target as Element;
    state.isNativeTextSelecting = event.button === 0
      && !state.isMoveMode
      && !state.isMultiSelectMode
      && Boolean(target.closest('.node-content, .fs-content, .tiled-content'));
    if (!target.closest('#action-tooltip') && target.closest('.node-content, .fs-content, .tiled-content')) {
      hideTooltip({ preserveNativeSelection: state.isNativeTextSelecting });
    }
    if (!target.closest('#action-tooltip') && !target.closest('.node') && !target.closest('.fullscreen-container') && !target.closest('#tiled-workspace')) hideTooltip();
    if (!target.closest('.context-menu')) hideMenus();
  });

  DOM.tooltipView.addEventListener('click', () => {
    DOM.tooltip.classList.add('focus');
    DOM.promptInput.focus();
  });
  DOM.promptInput.addEventListener('focus', () => DOM.tooltip.classList.add('focus'));
  DOM.promptInput.addEventListener('blur', () => DOM.tooltip.classList.remove('focus'));
  DOM.promptInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') triggerSelectionLLM();
    if (event.key === 'Escape') hideTooltip();
  });
  byId('btn-confirm').addEventListener('click', triggerSelectionLLM);
  byId('btn-cancel').addEventListener('click', () => hideTooltip());

  DOM.viewport.addEventListener('contextmenu', onContextMenu);
  byId('menu-fullscreen').addEventListener('click', () => {
    hideMenus();
    openFullscreen(state.contextNodeId);
  });
  byId('menu-toggle-collapse').addEventListener('click', () => {
    const ids = getContextNodeIds();
    hideMenus();
    toggleNodesCollapse(ids);
  });
  byId('menu-ai-child').addEventListener('click', () => {
    hideMenus();
    openLLMDialog({ mode: 'node', parentNodeId: state.contextNodeId });
  });
  byId('menu-ai-canvas').addEventListener('click', () => {
    hideMenus();
    openLLMDialog({ mode: 'canvas', position: { ...state.contextCanvasPoint } });
  });
  byId('menu-regen').addEventListener('click', () => {
    const ids = getContextNodeIds();
    hideMenus();
    regenerateNodes(ids);
  });
  byId('menu-delete').addEventListener('click', () => {
    const ids = getContextNodeIds();
    hideMenus();
    deleteNodes(ids);
  });
  byId('menu-zoom-in').addEventListener('click', () => { hideMenus(); zoom(0.2, window.innerWidth / 2, window.innerHeight / 2); });
  byId('menu-zoom-out').addEventListener('click', () => { hideMenus(); zoom(-0.2, window.innerWidth / 2, window.innerHeight / 2); });
  byId('menu-zoom-fit').addEventListener('click', () => { hideMenus(); zoomFit(); });
  byId('menu-center').addEventListener('click', () => { hideMenus(); triggerCenter(); });

  byId('btn-center').addEventListener('click', triggerCenter);
  byId('btn-zoom-in').addEventListener('click', () => zoom(0.2, window.innerWidth / 2, window.innerHeight / 2));
  byId('btn-zoom-out').addEventListener('click', () => zoom(-0.2, window.innerWidth / 2, window.innerHeight / 2));
  byId('btn-zoom-fit').addEventListener('click', zoomFit);
  DOM.minimap.addEventListener('mousedown', onMinimapMouseDown);

  byId('btn-fs-close').addEventListener('click', closeFullscreen);
  DOM.fullscreenOverlay.addEventListener('mousedown', (event) => {
    if (event.target === DOM.fullscreenOverlay) closeFullscreen();
  });
  DOM.fsContent.addEventListener('click', (event) => {
    const annotated = (event.target as Element).closest('mark.annotated, .math-node.annotated-math') as HTMLElement | null;
    const targetId = annotated?.dataset.refId;
    if (targetId) focusNode(targetId);
  });

  byId('btn-llm-close').addEventListener('click', closeLLMDialog);
  byId('btn-llm-cancel').addEventListener('click', closeLLMDialog);
  byId('btn-llm-submit').addEventListener('click', submitLLMDialog);
  DOM.llmPrompt.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submitLLMDialog();
  });

  window.addEventListener('keydown', (event) => {
    updateInteractionModes(event);
    if (state.activeView === 'tiled' && tiledWorkspace.handleKeydown(event)) return;
    if (event.key !== 'Escape') return;
    if (state.isMarqueeSelecting) finishMarqueeSelection({ cancel: true });
    hideTooltip();
    hideMenus();
    closeFullscreen();
    closeLLMDialog();
    closeServerFlowsModal();
  });
  window.addEventListener('keyup', updateInteractionModes);
  window.addEventListener('blur', () => {
    state.isMoveMode = false;
    state.isMultiSelectMode = false;
    state.isNodeDragMode = false;
    syncInteractionModeClasses();
  });
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
          if ((fromInitial && state.nodes.length === 0) || confirmReplaceGraph()) {
            loadFlow(json);
            hideWelcomeModal();
          }
          return;
        }
      } catch {
        // 普通 JSON 文档会作为文本打开。
      }
    }

    const title = file.name.replace(/\.[^.]+$/, '') || '本地文档';
    createDocument(title, text, { force: fromInitial && state.nodes.length === 0 });
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
    if (!confirmReplaceGraph()) return;
    loadFlow(flow);
  } catch (error) {
    showToast(`加载流程图失败：${error.message}`);
  }
}

async function generateInitialDocument() {
  const prompt = DOM.initialGeneratePrompt.value.trim();
  if (!prompt) {
    showToast('请先填写生成新文档的 Prompt');
    DOM.initialGeneratePrompt.focus();
    return;
  }
  if (state.appConfig && !(state.appConfig.ready || state.appConfig.hasApiKey)) {
    showToast('请先在 pi 中配置默认模型和凭据');
    return;
  }
  if (state.nodes.length > 0 && !confirmReplaceGraph()) return;

  setInitialGenerateLoading(true);
  const progressId = createProgressCard({
    title: '生成根文档',
    sourceLabel: 'Prompt',
    sourceText: prompt,
    prompt,
    stage: '准备上下文',
    summary: '正在创建第一张文档节点',
  });

  const fallbackTitle = prompt.slice(0, 24) || 'AI 生成文档';
  createDocument(fallbackTitle, '_正在流式生成根文档..._', { force: true });
  const root = getRootNode();
  if (!root) return;
  root.kind = 'ai';
  root.loading = true;
  root.llm = { mode: 'initial', userPrompt: prompt };
  updateNodeElement(root.id);

  let rawText = '';
  let finalData: LLMStreamDoneEvent | null = null;
  let streamFrame = 0;
  let streamRenderVersion = 0;
  let thinkingNoticeShown = false;

  const initialPayload = { mode: 'initial', userPrompt: prompt };
  const updateStreamingRoot = async () => {
    streamFrame = 0;
    const version = ++streamRenderVersion;
    if (!rawText.trim()) return;
    const generated = normalizeGeneratedNode(rawText, initialPayload);
    root.title = generated.title || fallbackTitle;
    root.content = generated.content || '（正在生成正文…）';
    root.loading = true;
    root.updatedAt = new Date().toISOString();
    state.flowName = root.title;
    if (version !== streamRenderVersion) return;
    await renderNodeStreamdownContent(root.id, root.content, { streaming: true });
    if (version !== streamRenderVersion) return;
    updateFlowName();
    updateProgressCard(progressId, { stage: '流式生成中', summary: plainExcerpt(root.content, 120) });
  };

  const scheduleStreamRender = () => {
    if (streamFrame) return;
    streamFrame = requestAnimationFrame(updateStreamingRoot);
  };

  try {
    updateProgressCard(progressId, { stage: '请求模型', summary: '内容会边生成边渲染，可直接选中已出现文本继续批注' });
    await postEventStream<LLMStreamEvent>('/api/llm/stream', initialPayload, (event) => {
      if (event.type === 'ready') {
        updateProgressCard(progressId, { stage: '已连接模型', summary: `${event.model} / ${event.reasoningEffort || 'off'}` });
        return;
      }
      if (event.type === 'delta') {
        rawText += event.delta;
        scheduleStreamRender();
        return;
      }
      if (event.type === 'thinking_delta') {
        if (!thinkingNoticeShown) {
          thinkingNoticeShown = true;
          updateProgressCard(progressId, { stage: '模型思考中', summary: '模型正在组织答案，正文会在完成思考后继续流式渲染' });
        }
        return;
      }
      if (event.type === 'done') {
        finalData = event;
        return;
      }
      if (event.type === 'error') {
        throw new Error(event.detail || event.error || 'LLM 流式调用失败');
      }
    });

    if (streamFrame) {
      cancelAnimationFrame(streamFrame);
      streamFrame = 0;
    }
    streamRenderVersion += 1;

    const data = finalData || {
      type: 'done',
      title: normalizeGeneratedNode(rawText, initialPayload).title,
      content: normalizeGeneratedNode(rawText, initialPayload).content,
      raw: rawText,
      usage: null,
      model: '',
      apiType: '',
      reasoningEffort: '',
    };

    root.title = data.title || fallbackTitle;
    root.content = data.content || '（模型没有返回内容）';
    root.loading = false;
    root.llm = {
      mode: 'initial',
      userPrompt: prompt,
      model: data.model,
      apiType: data.apiType,
      reasoningEffort: data.reasoningEffort,
      usage: data.usage,
    };
    root.updatedAt = new Date().toISOString();
    state.flowName = root.title;
    await renderNodeStreamdownContent(root.id, root.content, { streaming: false });
    updateFlowName();
    updateProgressCard(progressId, { stage: '生成完成', summary: plainExcerpt(root.content || '', 120), done: true });
    showToast('AI 新文档已生成');
  } catch (error) {
    if (streamFrame) {
      cancelAnimationFrame(streamFrame);
      streamFrame = 0;
    }
    streamRenderVersion += 1;
    root.title = '生成失败';
    root.content = [
      '> LLM 调用失败。',
      '',
      '请检查 pi 默认模型、凭据配置，以及服务端控制台错误。',
      '',
      '```text',
      codeFenceText(error.message || String(error)),
      '```',
    ].join('\n');
    root.loading = false;
    root.error = error.message || String(error);
    root.updatedAt = new Date().toISOString();
    updateNodeElementPreservingActiveSelection(root.id);
    updateProgressCard(progressId, { stage: '生成失败', summary: error.message || String(error), error: true });
    showToast(`生成新文档失败：${error.message}`);
  } finally {
    setInitialGenerateLoading(false);
  }
}

function setInitialGenerateLoading(isLoading) {
  DOM.initialGenerateButton.disabled = isLoading;
  DOM.initialGeneratePrompt.disabled = isLoading;
  DOM.initialGenerateButton.innerHTML = isLoading
    ? '<span class="material-symbols-outlined">hourglass_top</span>生成中...'
    : '<span class="material-symbols-outlined">auto_awesome</span>生成文档';
}

function createDocument(title, content, { force = false } = {}) {
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
  updateCanvasTransform();
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
  clearNodeSelection();
  state.fullscreenNodeId = null;
  state.workspaces = [];
  state.activeWorkspaceId = null;
  DOM.fullscreenOverlay.classList.add('hidden');
  DOM.selectionBox.style.display = 'none';
  DOM.nodesLayer.innerHTML = '';
  DOM.edgesLayer.innerHTML = '';
}

function renderAll() {
  DOM.nodesLayer.innerHTML = '';
  for (const node of state.nodes) renderNode(node);
  drawEdges();
  updateMinimap();
  updateFlowName();
  if (state.activeView === 'tiled') tiledWorkspace.render();
}

function setActiveView(view) {
  state.activeView = view === 'tiled' ? 'tiled' : 'canvas';
  const isTiled = state.activeView === 'tiled';
  DOM.viewport.classList.toggle('hidden', isTiled);
  DOM.tiledWorkspace.classList.toggle('hidden', !isTiled);
  DOM.viewCanvasButton.className = isTiled ? 'md-btn ghost' : 'md-btn filled tonal';
  DOM.viewTiledButton.className = isTiled ? 'md-btn filled tonal' : 'md-btn ghost';
  DOM.viewCanvasButton.setAttribute('aria-pressed', String(!isTiled));
  DOM.viewTiledButton.setAttribute('aria-pressed', String(isTiled));
  document.body.classList.toggle('tiled-view', isTiled);
  hideTooltip();
  hideMenus();
  if (isTiled) tiledWorkspace.render();
  else {
    drawEdges();
    updateMinimap();
  }
}

function normalizeNode(raw) {
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

function addNode(raw, { createEdge = true } = {}) {
  const node = normalizeNode(raw);
  state.nodes.push(node);
  renderNode(node);
  if (createEdge && node.parentId) addEdge(node.parentId, node.id);
  drawEdges();
  updateMinimap();
  return node;
}

function renderNode(node) {
  const nodeEl = document.createElement('article');
  nodeEl.id = node.id;
  nodeEl.dataset.nodeId = node.id;
  nodeEl.className = 'node';
  nodeEl.classList.toggle('selected', isNodeSelected(node.id));
  nodeEl.innerHTML = `
    <div class="node-header" title="拖拽移动节点；按住 Shift 可从内容区拖动">
      <div class="node-title-group">
        <span class="material-symbols-outlined node-icon">description</span>
        <span class="node-title"></span>
      </div>
      <div class="node-actions" aria-label="节点操作">
        <button class="node-btn" data-node-action="fullscreen" title="全屏查看"><span class="material-symbols-outlined">fullscreen</span></button>
        <button class="node-btn" data-node-action="toggle" title="展开/收起"><span class="material-symbols-outlined">unfold_less</span></button>
        <button class="node-btn resize-handle" data-node-action="resize" title="拖拽调整宽度"><span class="material-symbols-outlined">drag_indicator</span></button>
      </div>
    </div>
    <div class="node-content-wrapper">
      <div class="node-content markdown-body"></div>
      <div class="node-content-mask"></div>
    </div>
    <button class="expand-btn" data-node-action="toggle"><span class="expand-label">展开全部</span> <span class="material-symbols-outlined">keyboard_arrow_down</span></button>
    <div class="node-meta"><span class="node-kind"></span><span class="node-count"></span></div>
  `;
  DOM.nodesLayer.appendChild(nodeEl);
  updateNodeElement(node.id);
}

function updateNodeElement(id, { contentHtml = null, preserveContent = false } = {}) {
  const node = getNode(id);
  const nodeEl = document.getElementById(id);
  if (!node || !nodeEl) return;

  nodeEl.classList.toggle('selected', isNodeSelected(id));
  node.width = clamp(Number(node.width) || NODE_WIDTH, NODE_MIN_WIDTH, NODE_MAX_WIDTH);
  nodeEl.style.left = `${node.x}px`;
  nodeEl.style.top = `${node.y}px`;
  nodeEl.style.width = `${node.width}px`;
  nodeEl.dataset.dir = node.dir || 'right';
  nodeEl.style.setProperty('--node-color', node.colorIndex >= 0
    ? `var(--hl-${node.colorIndex % 5}-bg)`
    : 'var(--md-sys-color-surface-container-high)');
  nodeEl.classList.toggle('loading', Boolean(node.loading));

  const icon = nodeEl.querySelector('.node-icon');
  icon.textContent = node.loading ? 'hourglass_top' : (node.llm ? 'auto_awesome' : 'description');
  nodeEl.querySelector('.node-title').textContent = node.title || '未命名节点';

  const contentEl = nodeEl.querySelector('.node-content') as HTMLElement;
  if (!preserveContent) {
    unmountStreamdownMarkdown(contentEl);
    contentEl.innerHTML = contentHtml ?? renderMarkdown(node.content || '');
    postProcessNodeContent(contentEl);
    applyAnnotationsForSourceNode(node.id);
  }
  updateNodeCollapseState(node.id);

  nodeEl.querySelector('.node-kind').textContent = node.llm ? 'AI / Markdown' : '文档 / Markdown';
  nodeEl.querySelector('.node-count').textContent = `${(node.content || '').length} 字`;

  requestAnimationFrame(() => {
    if (state.fullscreenNodeId === node.id && !preserveContent) syncFullscreenContent(node.id, { contentHtml });
    drawEdges();
    updateMinimap();
    if (state.activeView === 'tiled') {
      if (preserveContent) tiledWorkspace.updateNodeShell(node.id);
      else tiledWorkspace.render();
    }
  });
}

async function renderNodeStreamdownContent(id, markdown, options: any = {}) {
  const streaming = options.streaming !== false;
  if (shouldPreserveNodeContentForSelection(id)) {
    state.deferredRenderNodeIds.add(id);
    updateNodeElement(id, { preserveContent: true });
    return false;
  }

  const nodeEl = document.getElementById(id);
  const contentEl = nodeEl?.querySelector('.node-content') as HTMLElement | null;
  if (!contentEl) return false;

  state.deferredRenderNodeIds.delete(id);
  await renderStreamdownMarkdown(contentEl, markdown || '', { streaming });
  if (state.fullscreenNodeId === id) await renderStreamdownMarkdown(DOM.fsContent, markdown || '', { streaming });
  await tiledWorkspace.renderStreamdownContent(id, markdown || '', { streaming });
  updateNodeElement(id, { preserveContent: true });
  return true;
}

function updateNodeElementPreservingActiveSelection(id, options = {}) {
  if (shouldPreserveNodeContentForSelection(id)) {
    state.deferredRenderNodeIds.add(id);
    updateNodeElement(id, { ...options, preserveContent: true });
    return true;
  }
  state.deferredRenderNodeIds.delete(id);
  updateNodeElement(id, options);
  return false;
}

function shouldPreserveNodeContentForSelection(nodeId) {
  if (!nodeId) return false;
  if (state.currentSelection?.parentNodeId === nodeId && state.currentSelection.text && DOM.tooltip.style.display === 'flex') return true;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.toString().trim()) return false;
  const range = selection.getRangeAt(0);
  const contentEl = closestElement<HTMLElement>(range.commonAncestorContainer, '.node-content, .fs-content, .tiled-content');
  if (!contentEl) return false;
  const fullscreenSourceId = contentEl.classList.contains('fs-content') ? contentEl.dataset.sourceId : '';
  const tiledSection = contentEl.classList.contains('tiled-content') ? contentEl.closest('.tiled-section') as HTMLElement | null : null;
  const tiledSourceId = tiledSection?.dataset.nodeId || '';
  const selectedNodeId = fullscreenSourceId || tiledSourceId || contentEl.closest('.node')?.id || '';
  return selectedNodeId === nodeId;
}

function flushDeferredNodeRender(nodeId = null, { force = false } = {}) {
  const ids = nodeId ? [nodeId] : Array.from(state.deferredRenderNodeIds);
  for (const id of ids) {
    if (!id || !state.deferredRenderNodeIds.has(id)) continue;
    if (!force && shouldPreserveNodeContentForSelection(id)) continue;
    state.deferredRenderNodeIds.delete(id);
    updateNodeElement(id);
  }
}

function updateNodeCollapseState(id) {
  const node = getNode(id);
  const nodeEl = document.getElementById(id);
  const contentEl = nodeEl?.querySelector('.node-content') as HTMLElement | null;
  if (!node || !nodeEl || !contentEl) return;

  nodeEl.style.setProperty('--node-collapse-height', `${NODE_COLLAPSE_HEIGHT}px`);
  const isLong = contentEl.scrollHeight > NODE_COLLAPSE_HEIGHT + 8;
  const effectiveCollapsed = isLong && Boolean(node.collapsed);
  nodeEl.classList.toggle('collapsible', isLong);
  nodeEl.classList.toggle('collapsed', effectiveCollapsed);
  nodeEl.classList.toggle('expanded', isLong && !effectiveCollapsed);

  const toggleBtn = nodeEl.querySelector('[data-node-action="toggle"]') as HTMLElement | null;
  const toggleIcon = toggleBtn?.querySelector('.material-symbols-outlined');
  if (toggleBtn && toggleIcon) {
    toggleIcon.textContent = effectiveCollapsed ? 'unfold_more' : 'unfold_less';
    toggleBtn.title = effectiveCollapsed ? '展开内容' : '收起内容';
  }
  const expandBtn = nodeEl.querySelector('.expand-btn') as HTMLElement | null;
  if (toggleBtn) {
    toggleBtn.style.display = isLong ? 'inline-flex' : 'none';
    toggleBtn.setAttribute('aria-hidden', isLong ? 'false' : 'true');
  }
  if (expandBtn) {
    expandBtn.innerHTML = '<span class="expand-label">展开全部</span> <span class="material-symbols-outlined">keyboard_arrow_down</span>';
    expandBtn.style.display = isLong && effectiveCollapsed ? 'flex' : 'none';
    expandBtn.setAttribute('aria-hidden', isLong && effectiveCollapsed ? 'false' : 'true');
  }
}

function toggleNodeCollapse(id, forceCollapsed = null) {
  const node = getNode(id);
  const nodeEl = document.getElementById(id);
  if (!node) return false;
  if (nodeEl && !nodeEl.classList.contains('collapsible')) return false;
  const nextCollapsed = typeof forceCollapsed === 'boolean' ? forceCollapsed : !node.collapsed;
  if (node.collapsed === nextCollapsed) return false;
  node.collapsed = nextCollapsed;
  node.updatedAt = new Date().toISOString();
  updateNodeCollapseState(id);
  setTimeout(() => {
    drawEdges();
    updateMinimap();
  }, 180);
  return true;
}

function toggleNodesCollapse(ids, forceCollapsed = null) {
  const targets = uniqueNodeIds(ids).filter((id) => {
    const nodeEl = document.getElementById(id);
    return nodeEl?.classList.contains('collapsible');
  });
  if (targets.length === 0) return;

  const shouldCollapse = typeof forceCollapsed === 'boolean' ? forceCollapsed : targets.some((id) => !getNode(id)?.collapsed);
  let changed = false;
  for (const id of targets) changed = toggleNodeCollapse(id, shouldCollapse) || changed;
  if (!changed) {
    drawEdges();
    updateMinimap();
  }
}

function onViewportMouseDown(event) {
  syncModifierModesFromPointerEvent(event);
  const isLeftButton = event.button === 0;
  const isMiddleButton = event.button === 1;
  if (!isLeftButton && !isMiddleButton) return;

  if (isLeftButton && state.isMultiSelectMode && !(event.target as Element).closest('#action-tooltip, #toolbar, #topbar, .context-menu')) {
    startMarqueeSelection(event);
    return;
  }

  // 左键保持原逻辑：点在节点/浮层/工具栏时不拖动画布。
  // 中键作为全局画布平移入口：即使鼠标在文档节点内容中，也可以直接拖动画布。
  if (isLeftButton && (event.target as Element).closest('.node, #action-tooltip, #toolbar, #topbar')) return;

  state.isDragging = true;
  state.dragStart = { x: event.clientX - state.canvas.x, y: event.clientY - state.canvas.y };
  hideTooltip();
  hideMenus();

  if (isMiddleButton) event.preventDefault();
}

function onViewportAuxClick(event) {
  if (event.button === 1) event.preventDefault();
}

function onNodesLayerMouseDown(event) {
  syncModifierModesFromPointerEvent(event);
  if (event.button !== 0) return;
  const nodeEl = (event.target as Element).closest('.node') as HTMLElement | null;
  if (!nodeEl) return;

  if (state.isMultiSelectMode) {
    startMarqueeSelection(event, nodeEl.id);
    event.stopPropagation();
    return;
  }

  if (state.isMoveMode) {
    startNodeDrag(event, nodeEl);
    return;
  }

  const resizeHandle = (event.target as Element).closest('.resize-handle') as HTMLElement | null;
  if (resizeHandle) {
    const node = getNode(nodeEl.id);
    if (!node) return;
    state.isResizing = true;
    state.resizeNodeId = nodeEl.id;
    state.resizeStartWidth = nodeEl.offsetWidth || node.width || NODE_WIDTH;
    state.resizeStartNodeX = node.x;
    state.resizeStartX = event.clientX;
    state.resizeHandleSide = nodeEl.dataset.dir === 'left' ? 'left' : 'right';
    hideTooltip();
    hideMenus();
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if ((event.target as Element).closest('.node-btn') || (event.target as Element).closest('.expand-btn')) return;

  if (state.isNodeDragMode) {
    startNodeDrag(event, nodeEl);
    return;
  }

  const header = (event.target as Element).closest('.node-header');
  if (!header) return;
  startNodeDrag(event, nodeEl);
}

function onNodesLayerClick(event) {
  if (state.suppressNodeClick) {
    event.preventDefault();
    event.stopPropagation();
    state.suppressNodeClick = false;
    return;
  }

  const action = (event.target as Element).closest('[data-node-action]') as HTMLElement | null;
  if (action && !action.classList.contains('resize-handle')) {
    const nodeEl = action.closest('.node');
    if (!nodeEl) return;
    event.preventDefault();
    event.stopPropagation();
    hideTooltip();
    hideMenus();
    const actionName = action.dataset.nodeAction;
    if (actionName === 'fullscreen') openFullscreen(nodeEl.id);
    if (actionName === 'toggle') toggleNodesCollapse(getActionNodeIds(nodeEl.id), !nodeEl.classList.contains('collapsed'));
    return;
  }

  const annotated = (event.target as Element).closest('mark.annotated, .math-node.annotated-math') as HTMLElement | null;
  if (!annotated) return;
  const targetId = annotated.dataset.refId;
  if (targetId) focusNode(targetId);
}

function startNodeDrag(event, nodeEl) {
  const node = getNode(nodeEl.id);
  if (!node) return;

  const selectedIds = getSelectedNodeIds();
  const shouldDragSelection = selectedIds.length > 0 && selectedIds.includes(nodeEl.id);
  if (!shouldDragSelection && selectedIds.length > 0) clearNodeSelection();
  const dragIds = shouldDragSelection ? selectedIds : [nodeEl.id];
  state.isDraggingNode = true;
  state.draggedNodeId = nodeEl.id;
  state.nodeDragIds = dragIds;
  state.nodeDragStartPoint = screenToCanvas(event.clientX, event.clientY);
  state.nodeDragStartClient = { x: event.clientX, y: event.clientY };
  state.nodeDragStartPositions = dragIds
    .map((id) => getNode(id))
    .filter(Boolean)
    .map((item) => ({ id: item.id, x: item.x, y: item.y }));
  for (const id of dragIds) document.getElementById(id)?.classList.add('dragging');
  const rect = nodeEl.getBoundingClientRect();
  state.nodeDragOffset = {
    x: (event.clientX - rect.left) / state.canvas.scale,
    y: (event.clientY - rect.top) / state.canvas.scale,
  };
  state.nodeDragMoved = false;
  state.nodeDragStartedInMoveMode = state.isMoveMode;
  hideTooltip();
  hideMenus();
  window.getSelection()?.removeAllRanges();
  event.preventDefault();
  event.stopPropagation();
}

function onWindowMouseMove(event) {
  if (state.isDraggingMinimap) {
    centerCanvasFromMinimapEvent(event);
    return;
  }

  if (state.isMarqueeSelecting) {
    updateMarqueeSelection(event);
    return;
  }

  if (state.isDragging) {
    state.canvas.x = event.clientX - state.dragStart.x;
    state.canvas.y = event.clientY - state.dragStart.y;
    updateCanvasTransform();
    return;
  }

  if (state.isResizing && state.resizeNodeId) {
    const node = getNode(state.resizeNodeId);
    const nodeEl = document.getElementById(state.resizeNodeId);
    if (!node || !nodeEl) return;
    const delta = (event.clientX - state.resizeStartX) / state.canvas.scale;
    const resizingFromLeft = state.resizeHandleSide === 'left';
    const newWidth = clamp(
      state.resizeStartWidth + (resizingFromLeft ? -delta : delta),
      NODE_MIN_WIDTH,
      NODE_MAX_WIDTH,
    );
    node.width = newWidth;
    if (resizingFromLeft) {
      node.x = state.resizeStartNodeX + state.resizeStartWidth - newWidth;
      nodeEl.style.left = `${node.x}px`;
    }
    node.updatedAt = new Date().toISOString();
    nodeEl.style.width = `${newWidth}px`;
    updateNodeCollapseState(node.id);
    drawEdges();
    updateMinimap();
    return;
  }

  if (state.isDraggingNode && state.draggedNodeId) {
    const current = screenToCanvas(event.clientX, event.clientY);
    const dx = current.x - state.nodeDragStartPoint.x;
    const dy = current.y - state.nodeDragStartPoint.y;
    const clientDistance = Math.hypot(event.clientX - state.nodeDragStartClient.x, event.clientY - state.nodeDragStartClient.y);
    if (clientDistance > MARQUEE_DRAG_THRESHOLD) state.nodeDragMoved = true;

    for (const start of state.nodeDragStartPositions) {
      const node = getNode(start.id);
      const nodeEl = document.getElementById(start.id);
      if (!node || !nodeEl) continue;
      const newX = start.x + dx;
      const newY = start.y + dy;
      node.x = newX;
      node.y = newY;
      node.updatedAt = new Date().toISOString();
      nodeEl.style.left = `${newX}px`;
      nodeEl.style.top = `${newY}px`;
    }
    drawEdges();
    updateMinimap();
  }
}

function onWindowMouseUp(event) {
  if (state.isMarqueeSelecting) finishMarqueeSelection({ cancel: false });
  state.isDragging = false;
  if (state.isDraggingNode && (state.nodeDragMoved || state.nodeDragStartedInMoveMode)) suppressNextNodeClick();
  document.querySelectorAll('.node.dragging').forEach((nodeEl) => nodeEl.classList.remove('dragging'));
  state.isDraggingNode = false;
  state.draggedNodeId = null;
  state.nodeDragIds = [];
  state.nodeDragStartPositions = [];
  state.nodeDragMoved = false;
  state.nodeDragStartedInMoveMode = false;
  state.isResizing = false;
  state.resizeNodeId = null;
  state.resizeHandleSide = 'right';
  state.isDraggingMinimap = false;
  DOM.minimap.classList.remove('dragging');
}

function onViewportWheel(event) {
  if (shouldPreserveNativeWheel(event)) return;
  event.preventDefault();
  zoom(-event.deltaY * 0.001, event.clientX, event.clientY);
}

function shouldPreserveNativeWheel(event) {
  const target = event.target;
  if (target.closest('#toolbar, #topbar, #action-tooltip, .context-menu')) return true;

  const codeBlock = target.closest('.node-content pre, .fs-content pre');
  return Boolean(codeBlock && isScrollableElement(codeBlock));
}

function isScrollableElement(element) {
  return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
}

function updateInteractionModes(event) {
  const editable = isEditableTarget(event.target);
  if (editable) {
    if (event.type === 'keyup') {
      if (event.code === 'Space' || event.key === ' ') state.isMoveMode = false;
      if (event.key === 'Control' || event.key === 'Meta' || (!event.ctrlKey && !event.metaKey)) state.isMultiSelectMode = false;
      if (event.key === 'Shift' || !event.shiftKey) state.isNodeDragMode = Boolean(event.shiftKey);
      syncInteractionModeClasses();
    }
    return;
  }

  if (event.type === 'keydown') {
    if (event.code === 'Space' || event.key === ' ') {
      state.isMoveMode = true;
      event.preventDefault();
    }
    state.isMultiSelectMode = Boolean(event.ctrlKey || event.metaKey || event.key === 'Control' || event.key === 'Meta');
    state.isNodeDragMode = Boolean(event.shiftKey || event.key === 'Shift');
  } else if (event.type === 'keyup') {
    if (event.code === 'Space' || event.key === ' ') state.isMoveMode = false;
    state.isMultiSelectMode = Boolean(event.ctrlKey || event.metaKey);
    state.isNodeDragMode = Boolean(event.shiftKey);
  }
  syncInteractionModeClasses();
}

function syncModifierModesFromPointerEvent(event) {
  if (isEditableTarget(event.target)) return;
  state.isMultiSelectMode = Boolean(event.ctrlKey || event.metaKey);
  state.isNodeDragMode = Boolean(event.shiftKey);
  syncInteractionModeClasses();
}

function syncInteractionModeClasses() {
  document.body.classList.toggle('move-mode', state.isMoveMode);
  document.body.classList.toggle('multi-select-mode', state.isMultiSelectMode);
  DOM.viewport.classList.toggle('move-mode', state.isMoveMode);
  DOM.viewport.classList.toggle('multi-select-mode', state.isMultiSelectMode);
  document.body.classList.toggle('node-drag-mode', state.isNodeDragMode);
  DOM.viewport.classList.toggle('node-drag-mode', state.isNodeDragMode);
}

function isEditableTarget(target) {
  return Boolean(target?.closest?.('input, textarea, select, button, [contenteditable="true"], [contenteditable=""]'));
}

function startMarqueeSelection(event, startNodeId = null) {
  state.isMarqueeSelecting = true;
  state.marqueeStart = { x: event.clientX, y: event.clientY };
  state.marqueeMoved = false;
  state.marqueeStartNodeId = startNodeId;
  state.marqueeBaseSelectionIds = getSelectedNodeIds();
  DOM.selectionBox.style.display = 'none';
  hideTooltip();
  hideMenus();
  window.getSelection()?.removeAllRanges();
  event.preventDefault();
  event.stopPropagation();
}

function updateMarqueeSelection(event) {
  const distance = Math.hypot(event.clientX - state.marqueeStart.x, event.clientY - state.marqueeStart.y);
  if (distance > MARQUEE_DRAG_THRESHOLD) state.marqueeMoved = true;
  if (!state.marqueeMoved) return;

  updateSelectionBox(event.clientX, event.clientY);
  const marqueeRect = getMarqueeCanvasRect(event.clientX, event.clientY);
  const hitIds = state.nodes
    .filter((node) => rectsIntersect(marqueeRect, getNodeCanvasRect(node)))
    .map((node) => node.id);
  setNodeSelection(hitIds);
  event.preventDefault();
}

function finishMarqueeSelection({ cancel = false } = {}) {
  const wasMoved = state.marqueeMoved;
  const startNodeId = state.marqueeStartNodeId;
  const baseSelectionIds = state.marqueeBaseSelectionIds;
  DOM.selectionBox.style.display = 'none';
  state.isMarqueeSelecting = false;
  state.marqueeMoved = false;
  state.marqueeStartNodeId = null;
  state.marqueeBaseSelectionIds = [];

  if (cancel) {
    setNodeSelection(baseSelectionIds);
    return;
  }
  suppressNextNodeClick();
  if (wasMoved) return;
  if (startNodeId) toggleNodeSelection(startNodeId);
  else clearNodeSelection();
}

function updateSelectionBox(clientX, clientY) {
  const viewportRect = DOM.viewport.getBoundingClientRect();
  const left = Math.min(state.marqueeStart.x, clientX) - viewportRect.left;
  const top = Math.min(state.marqueeStart.y, clientY) - viewportRect.top;
  const width = Math.abs(clientX - state.marqueeStart.x);
  const height = Math.abs(clientY - state.marqueeStart.y);
  DOM.selectionBox.style.display = 'block';
  DOM.selectionBox.style.left = `${left}px`;
  DOM.selectionBox.style.top = `${top}px`;
  DOM.selectionBox.style.width = `${width}px`;
  DOM.selectionBox.style.height = `${height}px`;
}

function getMarqueeCanvasRect(clientX, clientY) {
  const a = screenToCanvas(state.marqueeStart.x, state.marqueeStart.y);
  const b = screenToCanvas(clientX, clientY);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function getNodeCanvasRect(node) {
  const size = getNodeSize(node);
  return { x: node.x, y: node.y, width: size.width, height: size.height };
}

function rectsIntersect(a, b) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

function uniqueNodeIds(ids) {
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
  return state.nodes.map((node) => node.id).filter((id) => state.selectedNodeIds.has(id));
}

function isNodeSelected(id) {
  return state.selectedNodeIds.has(id);
}

function setNodeSelection(ids) {
  state.selectedNodeIds = new Set(uniqueNodeIds(ids));
  syncNodeSelectionClasses();
}

function clearNodeSelection() {
  setNodeSelection([]);
}

function selectOnlyNode(id) {
  setNodeSelection(id ? [id] : []);
}

function toggleNodeSelection(id) {
  if (!getNode(id)) return;
  const next = new Set(getSelectedNodeIds());
  if (next.has(id)) next.delete(id);
  else next.add(id);
  setNodeSelection([...next]);
}

function syncNodeSelectionClasses() {
  document.querySelectorAll('.node').forEach((nodeEl) => {
    nodeEl.classList.toggle('selected', state.selectedNodeIds.has(nodeEl.id));
  });
}

function suppressNextNodeClick() {
  state.suppressNodeClick = true;
  setTimeout(() => {
    state.suppressNodeClick = false;
  }, 120);
}

function getActionNodeIds(clickedId) {
  const selected = getSelectedNodeIds();
  return selected.length > 1 && selected.includes(clickedId) ? selected : [clickedId];
}

function getContextNodeIds() {
  return state.contextNodeIds.length > 0 ? state.contextNodeIds : (state.contextNodeId ? [state.contextNodeId] : []);
}

function handleSelection() {
  if (state.isDragging || state.isDraggingNode || state.isResizing || state.isMarqueeSelecting || state.isMoveMode || state.isMultiSelectMode) return;
  if (!DOM.llmModal.classList.contains('hidden') || !DOM.welcomeModal.classList.contains('hidden')) return;

  const selection = window.getSelection();
  const rawText = selection?.toString() || '';
  if (!selection || selection.rangeCount === 0 || rawText.trim().length === 0) {
    if (state.isNativeTextSelecting) return;
    if (state.keepTooltipAfterSelectionClear) {
      state.keepTooltipAfterSelectionClear = false;
      return;
    }
    if (DOM.tooltip.style.display === 'flex') return;
    if (!DOM.tooltip.classList.contains('focus')) hideTooltip();
    return;
  }

  const range = selection.getRangeAt(0);
  const contentEl = closestElement<HTMLElement>(range.commonAncestorContainer, '.node-content, .fs-content, .tiled-content');
  if (!contentEl) return;

  const fsSourceId = contentEl.classList.contains('fs-content') ? contentEl.dataset.sourceId : '';
  const tiledSection = contentEl.classList.contains('tiled-content') ? contentEl.closest('.tiled-section') as HTMLElement | null : null;
  const tiledSourceId = tiledSection?.dataset.nodeId || '';
  const nodeEl = contentEl.closest('.node');
  const parentNodeId = fsSourceId || tiledSourceId || nodeEl?.id;
  if (!parentNodeId || !getNode(parentNodeId)) return;

  const logicalSelection = getLogicalRangeSelection(contentEl, range, rawText);
  if (!logicalSelection || logicalSelection.length <= 0) return;

  state.currentSelection = {
    text: logicalSelection.text,
    parentNodeId,
    start: logicalSelection.start,
    length: logicalSelection.length,
    source: fsSourceId ? 'fullscreen' : (tiledSourceId ? 'tiled' : 'node'),
  };

  if (state.isNativeTextSelecting) return;

  const rect = range.getBoundingClientRect();
  DOM.tooltip.style.display = 'flex';
  DOM.tooltip.style.left = `${clamp(rect.left + rect.width / 2, 120, window.innerWidth - 120)}px`;
  DOM.tooltip.style.top = `${Math.max(76, rect.top - 14)}px`;
  DOM.promptInput.value = '';
}

function shouldLockNativeSelectionMenu() {
  if (DOM.tooltip.style.display !== 'flex' || DOM.tooltip.classList.contains('focus')) return false;
  if (!state.currentSelection?.parentNodeId || !state.currentSelection.text) return false;
  const selection = window.getSelection();
  return Boolean(selection && selection.rangeCount > 0 && selection.toString().trim());
}

function lockNativeSelectionMenu() {
  if (!shouldLockNativeSelectionMenu()) return;
  retainTemporarySelection();
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  state.keepTooltipAfterSelectionClear = true;
  selection.removeAllRanges();
}

function retainTemporarySelection() {
  const selection = state.currentSelection;
  if (!selection?.parentNodeId || !selection.text) return;
  clearTemporarySelection();

  const container = selection.source === 'fullscreen' && state.fullscreenNodeId === selection.parentNodeId
    ? DOM.fsContent
    : selection.source === 'tiled'
      ? DOM.tiledWorkspace.querySelector(`[data-node-id="${cssAttr(selection.parentNodeId)}"] .tiled-content`)
      : document.getElementById(selection.parentNodeId)?.querySelector('.node-content');
  if (!container) return;
  wrapTemporarySelectionByOffset(container, Number(selection.start), Number(selection.length));
}

function wrapTemporarySelectionByOffset(container, start, length) {
  forEachLogicalTextSegment(container, start, length, (unit, from, to) => {
    if (unit.type === 'math') {
      unit.element.classList.add('retained-math-selection');
      return;
    }
    if (from < to) wrapTemporaryTextNodeSegment(unit.node, from, to);
  });
}

function wrapTemporaryTextNodeSegment(textNode, from, to) {
  const value = textNode.nodeValue || '';
  const selectedText = value.slice(from, to);
  if (!selectedText.trim() || isTableStructuralWhitespaceTextNode(textNode, selectedText)) return;

  const leading = selectedText.match(/^\s*/)?.[0] || '';
  const trailing = selectedText.match(/\s*$/)?.[0] || '';
  const core = selectedText.slice(leading.length, selectedText.length - trailing.length);
  if (!core) return;

  const fragment = document.createDocumentFragment();
  if (from > 0) fragment.appendChild(document.createTextNode(value.slice(0, from)));
  if (leading) fragment.appendChild(document.createTextNode(leading));

  const span = document.createElement('span');
  span.className = 'retained-selection';
  span.textContent = core;
  fragment.appendChild(span);

  if (trailing) fragment.appendChild(document.createTextNode(trailing));
  if (to < value.length) fragment.appendChild(document.createTextNode(value.slice(to)));
  textNode.parentNode?.replaceChild(fragment, textNode);
}

function isTableStructuralWhitespaceTextNode(textNode, text) {
  if (String(text || '').trim()) return false;
  return Boolean(textNode.parentElement?.matches?.('table, thead, tbody, tfoot, tr, colgroup'));
}

function clearTemporarySelection() {
  document.querySelectorAll('.retained-selection').forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  });
  document.querySelectorAll('.math-node.retained-math-selection').forEach((mathEl) => {
    mathEl.classList.remove('retained-math-selection');
  });
}

function hideTooltip({ preserveNativeSelection = false } = {}) {
  const deferredNodeId = state.currentSelection?.parentNodeId || null;
  if (!preserveNativeSelection) state.isNativeTextSelecting = false;
  clearTemporarySelection();
  DOM.tooltip.style.display = 'none';
  DOM.tooltip.classList.remove('focus');
  if (!preserveNativeSelection) window.getSelection()?.removeAllRanges();
  state.currentSelection = { text: '', parentNodeId: null, start: 0, length: 0, source: 'node' };
  flushDeferredNodeRender(deferredNodeId, { force: true });
}

function hideMenus() {
  DOM.nodeMenu.style.display = 'none';
  DOM.canvasMenu.style.display = 'none';
}

function openFullscreen(id) {
  const node = getNode(id);
  if (!node) return;
  state.fullscreenNodeId = id;
  DOM.fsTitle.textContent = node.title || '节点全屏浏览';
  DOM.fsContent.dataset.sourceId = id;
  syncFullscreenContent(id);
  DOM.fullscreenOverlay.classList.remove('hidden');
}

function closeFullscreen() {
  if (DOM.fullscreenOverlay.classList.contains('hidden')) return;
  DOM.fullscreenOverlay.classList.add('hidden');
  state.fullscreenNodeId = null;
  DOM.fsContent.dataset.sourceId = '';
  hideTooltip();
  window.getSelection()?.removeAllRanges();
}

function syncFullscreenContent(id, { contentHtml = null } = {}) {
  const node = getNode(id);
  if (!node || state.fullscreenNodeId !== id) return;
  if (shouldPreserveNodeContentForSelection(id)) {
    state.deferredRenderNodeIds.add(id);
    return;
  }
  unmountStreamdownMarkdown(DOM.fsContent);
  DOM.fsContent.innerHTML = contentHtml ?? renderMarkdown(node.content || '');
  postProcessNodeContent(DOM.fsContent);
  state.annotations
    .filter((annotation) => annotation.sourceNodeId === id)
    .forEach((annotation) => applyAnnotationToContainer(DOM.fsContent, annotation));
}

function onContextMenu(event) {
  event.preventDefault();
  hideTooltip();
  const nodeEl = (event.target as Element).closest('.node') as HTMLElement | null;

  if (nodeEl) {
    if (!isNodeSelected(nodeEl.id)) selectOnlyNode(nodeEl.id);
    const contextIds = getActionNodeIds(nodeEl.id);
    state.contextNodeId = nodeEl.id;
    state.contextNodeIds = contextIds;
    const selectedNodes = contextIds.map((id) => getNode(id)).filter(Boolean);
    const toggleMenu = byId('menu-toggle-collapse');
    const toggleIcon = toggleMenu.querySelector('.material-symbols-outlined');
    const collapsibleIds = contextIds.filter((id) => document.getElementById(id)?.classList.contains('collapsible'));
    const shouldCollapse = collapsibleIds.some((id) => !getNode(id)?.collapsed);
    toggleIcon.textContent = shouldCollapse ? 'unfold_less' : 'unfold_more';
    toggleMenu.lastChild.textContent = shouldCollapse ? ' 收起内容' : ' 展开内容';
    toggleMenu.classList.toggle('disabled', collapsibleIds.length === 0);
    byId('menu-regen').classList.toggle('disabled', !selectedNodes.some((node) => node.id !== 'node-root' && node.llm));
    byId('menu-delete').classList.toggle('disabled', !selectedNodes.some((node) => node.id !== 'node-root'));
    DOM.canvasMenu.style.display = 'none';
    showMenu(DOM.nodeMenu, event.clientX, event.clientY);
  } else {
    state.contextNodeId = null;
    state.contextNodeIds = [];
    state.contextCanvasPoint = screenToCanvas(event.clientX, event.clientY);
    DOM.nodeMenu.style.display = 'none';
    showMenu(DOM.canvasMenu, event.clientX, event.clientY);
  }
}

function showMenu(menu, clientX, clientY) {
  menu.style.display = 'flex';
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(clientX, window.innerWidth - rect.width - 8)}px`;
  menu.style.top = `${Math.min(clientY, window.innerHeight - rect.height - 8)}px`;
}

function openLLMDialog(context) {
  if (context.mode === 'node' && !getNode(context.parentNodeId)) return;
  state.pendingLLM = context;
  DOM.llmPrompt.value = context.defaultPrompt || DEFAULT_PROMPT;

  if (context.mode === 'node') {
    const parent = getNode(context.parentNodeId);
    DOM.llmModalTitle.textContent = `从「${parent.title}」生成子节点`;
    DOM.llmContext.textContent = `将读取该节点的完整 Markdown 内容，并根据画布剩余空间智能选择左侧或右侧创建子节点。`;
  } else {
    DOM.llmModalTitle.textContent = '在画布生成独立新节点';
    DOM.llmContext.textContent = '将结合当前流程图摘要，在右键位置附近创建一个无父节点的新卡片。';
  }

  DOM.llmModal.classList.remove('hidden');
  setTimeout(() => DOM.llmPrompt.focus(), 30);
}

function closeLLMDialog() {
  DOM.llmModal.classList.add('hidden');
  state.pendingLLM = null;
}

function submitLLMDialog() {
  const context = state.pendingLLM;
  if (!context) return;
  const prompt = DOM.llmPrompt.value.trim() || DEFAULT_PROMPT;
  closeLLMDialog();

  if (context.mode === 'node') {
    generateChildFromNode(context.parentNodeId, prompt);
  } else if (context.mode === 'canvas') {
    generateCanvasNode(prompt, context.position || state.contextCanvasPoint);
  }
}

function triggerSelectionLLM() {
  const selection = state.currentSelection;
  if (!selection?.parentNodeId || !selection.text) return;
  const parent = getNode(selection.parentNodeId);
  if (!parent) return;

  const userPrompt = DOM.promptInput.value.trim() || DEFAULT_PROMPT;
  const newNodeId = genId('node');
  const currentColor = state.colorIndex;
  state.colorIndex = (state.colorIndex + 1) % 5;

  const annotation = {
    id: genId('ann'),
    sourceNodeId: parent.id,
    targetNodeId: newNodeId,
    start: selection.start,
    length: selection.length,
    text: selection.text,
    colorIndex: currentColor,
  };
  clearTemporarySelection();
  state.annotations.push(annotation);
  applyAnnotation(annotation);
  if (state.fullscreenNodeId === parent.id) syncFullscreenContent(parent.id);
  if (state.activeView === 'tiled') tiledWorkspace.render();

  hideTooltip();
  window.getSelection()?.removeAllRanges();

  const position = findSmartChildPosition(parent, NODE_WIDTH);
  const node = addNode({
    id: newNodeId,
    title: 'AI 思考中...',
    content: '_正在根据选中文本调用 LLM 生成内容..._',
    x: position.x,
    y: position.y,
    width: NODE_WIDTH,
    parentId: parent.id,
    dir: position.dir,
    collapsed: true,
    colorIndex: currentColor,
    loading: true,
    kind: 'ai',
    llm: {
      mode: 'selection',
      userPrompt,
      selectedText: selection.text.trim(),
      sourceNodeId: parent.id,
      annotationId: annotation.id,
    },
  });

  const progressId = createProgressCard({
    title: '批注生成子节点',
    sourceLabel: '批注',
    sourceText: selection.text.trim(),
    prompt: userPrompt,
    stage: '准备上下文',
    summary: `来源：${parent.title}`,
  });

  callLLMAndUpdate(node.id, {
    mode: 'selection',
    userPrompt,
    selectedText: selection.text.trim(),
    parentTitle: parent.title,
    parentContent: parent.content,
  }, { progressId });
}

function generateChildFromNode(parentId, userPrompt) {
  const parent = getNode(parentId);
  if (!parent) return;
  const currentColor = state.colorIndex;
  state.colorIndex = (state.colorIndex + 1) % 5;
  const position = findSmartChildPosition(parent, NODE_WIDTH);
  const node = addNode({
    title: 'AI 思考中...',
    content: '_正在根据节点内容调用 LLM 生成新节点..._',
    x: position.x,
    y: position.y,
    width: NODE_WIDTH,
    parentId: parent.id,
    dir: position.dir,
    collapsed: true,
    colorIndex: currentColor,
    loading: true,
    kind: 'ai',
    llm: { mode: 'node', userPrompt, sourceNodeId: parent.id },
  });

  const progressId = createProgressCard({
    title: '节点问答生成',
    sourceLabel: '来源',
    sourceText: parent.title,
    prompt: userPrompt,
    stage: '准备上下文',
    summary: plainExcerpt(parent.content, 120),
  });

  callLLMAndUpdate(node.id, {
    mode: 'node',
    userPrompt,
    parentTitle: parent.title,
    parentContent: parent.content,
  }, { progressId });
}

function generateCanvasNode(userPrompt, position) {
  const safePosition = findSafePosition(position?.x ?? 0, position?.y ?? 0, NODE_WIDTH, NODE_FALLBACK_HEIGHT);
  const node = addNode({
    title: 'AI 思考中...',
    content: '_正在创建独立节点..._',
    x: safePosition.x,
    y: safePosition.y,
    width: NODE_WIDTH,
    parentId: null,
    dir: 'right',
    collapsed: true,
    colorIndex: -1,
    loading: true,
    kind: 'ai',
    llm: { mode: 'canvas', userPrompt },
  });

  const progressId = createProgressCard({
    title: '画布新节点生成',
    sourceLabel: '画布',
    sourceText: `x:${Math.round(safePosition.x)} y:${Math.round(safePosition.y)}`,
    prompt: userPrompt,
    stage: '准备图谱摘要',
    summary: plainExcerpt(getGraphSummary(node.id), 120),
  });

  callLLMAndUpdate(node.id, {
    mode: 'canvas',
    userPrompt,
    parentTitle: '',
    parentContent: '',
  }, { progressId });
}

async function callLLMAndUpdate(nodeId, payload, { progressId = null } = {}) {
  const node = getNode(nodeId);
  if (!node) return;

  node.loading = true;
  node.error = null;
  updateNodeElement(nodeId);

  const enrichedPayload = {
    ...payload,
    rootTitle: getRootNode()?.title || '',
    graphSummary: getGraphSummary(nodeId),
  };

  updateProgressCard(progressId, {
    stage: '组织上下文',
    summary: plainExcerpt(enrichedPayload.selectedText || enrichedPayload.parentContent || enrichedPayload.graphSummary, 130),
  });
  const progressTimers = [
    setTimeout(() => updateProgressCard(progressId, { stage: '请求模型', summary: '上下文已发送，等待模型响应' }), 450),
    setTimeout(() => updateProgressCard(progressId, { stage: '流式生成中', summary: '内容会边生成边渲染，可直接选中已出现文本继续批注' }), 1800),
  ];

  let rawText = '';
  let finalData: LLMStreamDoneEvent | null = null;
  let streamFrame = 0;
  let streamRenderVersion = 0;
  let thinkingNoticeShown = false;

  const updateStreamingNode = async () => {
    streamFrame = 0;
    const version = ++streamRenderVersion;
    if (!rawText.trim()) return;
    const generated = normalizeGeneratedNode(rawText, enrichedPayload);
    node.title = generated.title || 'AI 生成节点';
    node.content = generated.content || '（正在生成正文…）';
    node.loading = true;
    node.updatedAt = new Date().toISOString();
    if (version !== streamRenderVersion) return;
    await renderNodeStreamdownContent(nodeId, node.content, { streaming: true });
    if (version !== streamRenderVersion) return;
    updateProgressCard(progressId, { stage: '流式生成中', summary: plainExcerpt(node.content, 130) });
  };

  const scheduleStreamRender = () => {
    if (streamFrame) return;
    streamFrame = requestAnimationFrame(updateStreamingNode);
  };

  try {
    await postEventStream<LLMStreamEvent>('/api/llm/stream', enrichedPayload, (event) => {
      if (event.type === 'ready') {
        updateProgressCard(progressId, { stage: '已连接模型', summary: `${event.model} / ${event.reasoningEffort || 'off'}` });
        return;
      }
      if (event.type === 'delta') {
        rawText += event.delta;
        scheduleStreamRender();
        return;
      }
      if (event.type === 'thinking_delta') {
        if (!thinkingNoticeShown) {
          thinkingNoticeShown = true;
          updateProgressCard(progressId, { stage: '模型思考中', summary: '模型正在组织答案，正文会在完成思考后继续流式渲染' });
        }
        return;
      }
      if (event.type === 'done') {
        finalData = event;
        return;
      }
      if (event.type === 'error') {
        throw new Error(event.detail || event.error || 'LLM 流式调用失败');
      }
    });

    if (streamFrame) {
      cancelAnimationFrame(streamFrame);
      streamFrame = 0;
    }
    streamRenderVersion += 1;

    const data = finalData || {
      type: 'done',
      title: normalizeGeneratedNode(rawText, enrichedPayload).title,
      content: normalizeGeneratedNode(rawText, enrichedPayload).content,
      raw: rawText,
      usage: null,
      model: '',
      apiType: '',
      reasoningEffort: '',
    };

    updateProgressCard(progressId, { stage: '解析响应', summary: '正在渲染生成节点' });
    node.title = data.title || 'AI 生成节点';
    node.content = data.content || '（模型没有返回内容）';
    node.loading = false;
    node.error = null;
    node.updatedAt = new Date().toISOString();
    node.llm = {
      ...(node.llm || {}),
      ...enrichedPayload,
      model: data.model,
      apiType: data.apiType,
      reasoningEffort: data.reasoningEffort,
      usage: data.usage,
    };
    await renderNodeStreamdownContent(nodeId, node.content, { streaming: false });
    updateProgressCard(progressId, { stage: '生成完成', summary: plainExcerpt(node.content, 130), done: true });
    showToast('LLM 节点已生成');
  } catch (error) {
    if (streamFrame) {
      cancelAnimationFrame(streamFrame);
      streamFrame = 0;
    }
    streamRenderVersion += 1;
    node.title = '生成失败';
    node.content = [
      '> LLM 调用失败。',
      '',
      '请检查 pi 默认模型、凭据配置，以及服务端控制台错误。',
      '',
      '```text',
      codeFenceText(error.message || String(error)),
      '```',
    ].join('\n');
    node.loading = false;
    node.error = error.message || String(error);
    node.updatedAt = new Date().toISOString();
    updateNodeElementPreservingActiveSelection(nodeId);
    updateProgressCard(progressId, { stage: '生成失败', summary: error.message || String(error), error: true });
    showToast(`LLM 调用失败：${error.message}`);
  } finally {
    progressTimers.forEach(clearTimeout);
  }
}

function regenerateNode(id) {
  const node = getNode(id);
  if (!node || id === 'node-root') return;
  const parent = getNode(node.parentId);
  const previous = node.content;
  const savedLLM = node.llm || {};
  const userPrompt = [
    savedLLM.userPrompt || DEFAULT_PROMPT,
    '请重新生成该节点，结构更清晰、信息密度更高，避免与上一版机械重复。',
    '',
    '【上一版内容】',
    previous,
  ].join('\n');

  const progressId = createProgressCard({
    title: '重新生成节点',
    sourceLabel: '旧版',
    sourceText: node.title,
    prompt: savedLLM.userPrompt || DEFAULT_PROMPT,
    stage: '准备重生成',
    summary: plainExcerpt(previous, 120),
  });

  node.loading = true;
  updateNodeElement(id);
  callLLMAndUpdate(id, {
    mode: 'regenerate',
    userPrompt,
    selectedText: savedLLM.selectedText || '',
    parentTitle: parent?.title || '',
    parentContent: parent?.content || '',
  }, { progressId });
}

function deleteNode(id) {
  deleteNodes([id]);
}

function regenerateNodes(ids) {
  const targets = uniqueNodeIds(ids).filter((id) => {
    const node = getNode(id);
    return node && id !== 'node-root' && node.llm;
  });
  for (const id of targets) regenerateNode(id);
}

function deleteNodes(ids) {
  const targets = uniqueNodeIds(ids).filter((id) => id !== 'node-root');
  if (targets.length === 0) {
    showToast('根节点不能删除');
    return;
  }

  const targetSet = new Set(targets);
  const childCount = state.edges.filter((edge) => targetSet.has(edge.sourceId) && !targetSet.has(edge.targetId)).length;
  if (childCount > 0 && !confirm(`选中的节点还有 ${childCount} 个子节点。删除后子节点会保留但断开连接，继续吗？`)) return;
  if (targets.length > 1 && !confirm(`确定删除选中的 ${targets.length} 个节点吗？`)) return;

  for (const id of targets) unwrapMarksForTarget(id);
  state.annotations = state.annotations.filter((annotation) => !targetSet.has(annotation.targetNodeId) && !targetSet.has(annotation.sourceNodeId));
  state.nodes = state.nodes.filter((item) => !targetSet.has(item.id));
  state.nodes.forEach((item) => {
    if (targetSet.has(item.parentId)) item.parentId = null;
  });
  state.edges = state.edges.filter((edge) => !targetSet.has(edge.sourceId) && !targetSet.has(edge.targetId));
  if (targetSet.has(state.fullscreenNodeId)) closeFullscreen();
  for (const id of targets) document.getElementById(id)?.remove();
  setNodeSelection(getSelectedNodeIds().filter((id) => !targetSet.has(id)));
  state.contextNodeId = null;
  state.contextNodeIds = [];
  drawEdges();
  updateMinimap();
  showToast(targets.length > 1 ? `已删除 ${targets.length} 个节点` : '节点已删除');
}

function addEdge(sourceId, targetId) {
  if (!sourceId || !targetId || state.edges.some((edge) => edge.sourceId === sourceId && edge.targetId === targetId)) return;
  state.edges.push({ id: genId('edge'), sourceId, targetId });
  drawEdges();
}

function drawEdges() {
  refreshNodeDirections();
  DOM.edgesLayer.innerHTML = '';
  DOM.edgesLayer.style.width = '16000px';
  DOM.edgesLayer.style.height = '16000px';
  DOM.edgesLayer.style.transform = `translate(-${EDGE_SVG_OFFSET}px, -${EDGE_SVG_OFFSET}px)`;

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = [
    '<marker id="arrow-default" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--md-sys-color-outline)"/></marker>',
    ...Array.from({ length: 5 }, (_, index) => `<marker id="arrow-${index}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--hl-${index}-fg)"/></marker>`),
  ].join('');
  DOM.edgesLayer.appendChild(defs);

  for (const edge of state.edges) {
    const sourceEl = document.getElementById(edge.sourceId);
    const targetEl = document.getElementById(edge.targetId);
    const target = getNode(edge.targetId);
    if (!sourceEl || !targetEl) continue;

    const sRect = {
      x: (parseFloat(sourceEl.style.left) || 0) + EDGE_SVG_OFFSET,
      y: (parseFloat(sourceEl.style.top) || 0) + EDGE_SVG_OFFSET,
      w: sourceEl.offsetWidth,
      h: sourceEl.offsetHeight,
    };
    const tRect = {
      x: (parseFloat(targetEl.style.left) || 0) + EDGE_SVG_OFFSET,
      y: (parseFloat(targetEl.style.top) || 0) + EDGE_SVG_OFFSET,
      w: targetEl.offsetWidth,
      h: targetEl.offsetHeight,
    };

    const targetOnRight = tRect.x + tRect.w / 2 >= sRect.x + sRect.w / 2;
    const sourceAnchorY = sRect.y + Math.min(72, Math.max(36, sRect.h * 0.22));
    const targetAnchorY = tRect.y + Math.min(72, Math.max(36, tRect.h * 0.22));
    const sX = targetOnRight ? sRect.x + sRect.w : sRect.x;
    const tX = targetOnRight ? tRect.x : tRect.x + tRect.w;
    const distance = Math.max(70, Math.abs(tX - sX) * 0.48);
    const cp1X = targetOnRight ? sX + distance : sX - distance;
    const cp2X = targetOnRight ? tX - distance : tX + distance;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${sX} ${sourceAnchorY} C ${cp1X} ${sourceAnchorY}, ${cp2X} ${targetAnchorY}, ${tX} ${targetAnchorY}`);
    path.setAttribute('class', 'edge');
    const markerId = target?.colorIndex >= 0 ? `arrow-${target.colorIndex % 5}` : 'arrow-default';
    path.setAttribute('marker-end', `url(#${markerId})`);
    path.style.stroke = target?.colorIndex >= 0 ? `var(--hl-${target.colorIndex % 5}-fg)` : 'var(--md-sys-color-outline)';
    DOM.edgesLayer.appendChild(path);
  }
}

function refreshNodeDirections() {
  for (const node of state.nodes) updateNodeDirection(node.id);
}

function updateNodeDirection(id) {
  const node = getNode(id);
  if (!node || !node.parentId) return;
  const parent = getNode(node.parentId);
  if (!parent) return;
  const nodeSize = getNodeSize(node);
  const parentSize = getNodeSize(parent);
  const childCenter = node.x + nodeSize.width / 2;
  const parentCenter = parent.x + parentSize.width / 2;
  node.dir = childCenter < parentCenter ? 'left' : 'right';
  document.getElementById(node.id)?.setAttribute('data-dir', node.dir);
}

function applyAnnotationsForSourceNode(sourceNodeId) {
  state.annotations
    .filter((annotation) => annotation.sourceNodeId === sourceNodeId)
    .forEach(applyAnnotation);
}

function applyAnnotation(annotation) {
  const sourceEl = document.getElementById(annotation.sourceNodeId);
  const container = sourceEl?.querySelector('.node-content');
  applyAnnotationToContainer(container, annotation);
}

function updateCanvasTransform() {
  DOM.canvas.style.transform = `translate(${state.canvas.x}px, ${state.canvas.y}px) scale(${state.canvas.scale})`;
  DOM.viewport.style.backgroundPosition = `${state.canvas.x}px ${state.canvas.y}px`;
  DOM.viewport.style.backgroundSize = `${40 * state.canvas.scale}px ${40 * state.canvas.scale}px`;
  updateMinimap();
}

function zoom(delta, mouseX, mouseY) {
  const oldScale = state.canvas.scale;
  const newScale = clamp(oldScale + delta, 0.18, 3);
  const rect = DOM.viewport.getBoundingClientRect();
  const mx = mouseX - rect.left;
  const my = mouseY - rect.top;
  state.canvas.x = mx - (mx - state.canvas.x) * (newScale / oldScale);
  state.canvas.y = my - (my - state.canvas.y) * (newScale / oldScale);
  state.canvas.scale = newScale;
  updateCanvasTransform();
  hideTooltip();
}

function zoomFit() {
  if (state.nodes.length === 0) return;
  const bounds = getGraphBounds(80);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const availableW = Math.max(360, window.innerWidth - 120);
  const availableH = Math.max(260, window.innerHeight - 160);
  const scale = Math.min(availableW / width, availableH / height, 1.45);
  state.canvas.scale = clamp(scale, 0.18, 3);
  state.canvas.x = window.innerWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * state.canvas.scale;
  state.canvas.y = window.innerHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * state.canvas.scale + 24;
  updateCanvasTransform();
}

function triggerCenter() {
  state.canvas.x = window.innerWidth / 2;
  state.canvas.y = window.innerHeight / 2;
  updateCanvasTransform();
}

function focusNode(id) {
  const node = getNode(id);
  const nodeEl = document.getElementById(id);
  if (!node || !nodeEl) return;
  const width = nodeEl.offsetWidth || NODE_WIDTH;
  const height = nodeEl.offsetHeight || NODE_FALLBACK_HEIGHT;
  state.canvas.x = window.innerWidth / 2 - (node.x + width / 2) * state.canvas.scale;
  state.canvas.y = window.innerHeight / 2 - (node.y + height / 2) * state.canvas.scale;
  updateCanvasTransform();
  nodeEl.classList.remove('focused');
  void nodeEl.offsetWidth;
  nodeEl.classList.add('focused');
}

function screenToCanvas(clientX, clientY) {
  const rect = DOM.viewport.getBoundingClientRect();
  return {
    x: (clientX - rect.left - state.canvas.x) / state.canvas.scale,
    y: (clientY - rect.top - state.canvas.y) / state.canvas.scale,
  };
}

function getNodeSize(node) {
  const el = document.getElementById(node.id);
  return {
    width: el?.offsetWidth || node?.width || NODE_WIDTH,
    height: el?.offsetHeight || NODE_FALLBACK_HEIGHT,
  };
}

function getGraphBounds(padding = 0) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of state.nodes) {
    const size = getNodeSize(node);
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + size.width);
    maxY = Math.max(maxY, node.y + size.height);
  }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}

function findSmartChildPosition(parent, targetWidth = NODE_WIDTH) {
  const parentSize = getNodeSize(parent);
  const viewport = getVisibleCanvasBounds();
  const gap = 82;
  const targetHeight = NODE_FALLBACK_HEIGHT;
  const leftSpace = parent.x - viewport.minX;
  const rightSpace = viewport.maxX - (parent.x + parentSize.width);

  const candidates = ['right', 'left']
    .map((dir) => findSideSlot(parent, parentSize, dir, targetWidth, targetHeight, gap, viewport, dir === 'right' ? rightSpace : leftSpace))
    .filter(Boolean)
    .sort((a, b) => b.score - a.score);

  if (candidates.length > 0) return candidates[0];
  const fallbackDir = leftSpace > rightSpace ? 'left' : 'right';
  const fallbackX = fallbackDir === 'left' ? parent.x - targetWidth - gap : parent.x + parentSize.width + gap;
  const fallback = findSafePosition(fallbackX, parent.y, targetWidth, targetHeight);
  return { ...fallback, dir: fallbackDir };
}

function findSideSlot(parent, parentSize, dir, targetWidth, targetHeight, gap, viewport, sideSpace) {
  const baseX = dir === 'right' ? parent.x + parentSize.width + gap : parent.x - targetWidth - gap;
  const offsets = [0, 210, -210, 420, -420, 630, -630, 840, -840, 1050];
  const visibleBonus = baseX + targetWidth > viewport.minX + 32 && baseX < viewport.maxX - 32 ? 220 : -80;
  const sideBias = dir === 'right' ? 28 : 0;

  for (const offset of offsets) {
    const y = parent.y + offset;
    if (!isSafeBox(baseX, y, targetWidth, targetHeight)) continue;
    return {
      x: baseX,
      y,
      dir,
      score: sideSpace + visibleBonus + sideBias - Math.abs(offset) * 0.72,
    };
  }
  return null;
}

function findSafePosition(startX, startY, width = NODE_WIDTH, height = NODE_FALLBACK_HEIGHT) {
  let x = startX;
  let y = startY;
  let attempts = 0;
  while (attempts < 90) {
    if (isSafeBox(x, y, width, height)) return { x, y };
    y += 230;
    attempts += 1;
    if (attempts % 6 === 0) {
      x += width + 70;
      y = startY + ((attempts / 6) % 2) * 120;
    }
  }
  return { x: startX + Math.random() * 120, y: startY + Math.random() * 120 };
}

function isSafeBox(x, y, width, height, margin = 28) {
  return !state.nodes.some((node) => {
    const size = getNodeSize(node);
    return x < node.x + size.width + margin && x + width + margin > node.x && y < node.y + size.height + margin && y + height + margin > node.y;
  });
}

function getVisibleCanvasBounds() {
  const scale = state.canvas.scale || 1;
  return {
    minX: -state.canvas.x / scale,
    minY: -state.canvas.y / scale,
    maxX: (window.innerWidth - state.canvas.x) / scale,
    maxY: (window.innerHeight - state.canvas.y) / scale,
  };
}

function updateMinimap() {
  DOM.minimapContent.innerHTML = '';
  if (state.nodes.length === 0) {
    DOM.minimapViewport.style.display = 'none';
    state.minimapBounds = null;
    return;
  }
  DOM.minimapViewport.style.display = 'block';

  const mapW = DOM.minimap.clientWidth || 170;
  const mapH = DOM.minimap.clientHeight || 126;
  const bounds = getGraphBounds(500);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const mapScale = Math.min(mapW / width, mapH / height);
  state.minimapBounds = { ...bounds, mapScale, mapW, mapH };

  for (const node of state.nodes) {
    const size = getNodeSize(node);
    const div = document.createElement('div');
    div.className = 'minimap-node';
    if (node.colorIndex >= 0) div.style.backgroundColor = `var(--hl-${node.colorIndex % 5}-bg)`;
    div.style.left = `${(node.x - bounds.minX) * mapScale}px`;
    div.style.top = `${(node.y - bounds.minY) * mapScale}px`;
    div.style.width = `${Math.max(3, size.width * mapScale)}px`;
    div.style.height = `${Math.max(3, size.height * mapScale)}px`;
    DOM.minimapContent.appendChild(div);
  }

  const vpX = (-state.canvas.x / state.canvas.scale - bounds.minX) * mapScale;
  const vpY = (-state.canvas.y / state.canvas.scale - bounds.minY) * mapScale;
  DOM.minimapViewport.style.left = `${vpX}px`;
  DOM.minimapViewport.style.top = `${vpY}px`;
  DOM.minimapViewport.style.width = `${(window.innerWidth / state.canvas.scale) * mapScale}px`;
  DOM.minimapViewport.style.height = `${(window.innerHeight / state.canvas.scale) * mapScale}px`;
}

function onMinimapMouseDown(event) {
  if (event.button !== 0 || !state.minimapBounds) return;
  state.isDraggingMinimap = true;
  DOM.minimap.classList.add('dragging');
  hideTooltip();
  hideMenus();
  centerCanvasFromMinimapEvent(event);
  event.preventDefault();
}

function centerCanvasFromMinimapEvent(event) {
  if (!state.minimapBounds) return;
  const rect = DOM.minimap.getBoundingClientRect();
  const { minX, minY, mapScale, mapW, mapH } = state.minimapBounds;
  const localX = clamp(event.clientX - rect.left, 0, mapW);
  const localY = clamp(event.clientY - rect.top, 0, mapH);
  const worldX = minX + localX / mapScale;
  const worldY = minY + localY / mapScale;
  state.canvas.x = window.innerWidth / 2 - worldX * state.canvas.scale;
  state.canvas.y = window.innerHeight / 2 - worldY * state.canvas.scale;
  updateCanvasTransform();
}

function exportFlow() {
  const flow: any = {
    version: 1,
    app: 'rhizodoc',
    name: state.flowName,
    savedAt: new Date().toISOString(),
    canvas: { ...state.canvas },
    colorIndex: state.colorIndex,
    nodes: state.nodes.map((node) => ({ ...node, loading: false })),
    edges: state.edges.map((edge) => ({ ...edge })),
    annotations: state.annotations.map((annotation) => ({ ...annotation })),
  };
  if (state.workspaces.length > 0) {
    flow.workspaces = state.workspaces.map((workspace) => ({ ...workspace }));
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

function loadFlow(flow) {
  const normalizedFlow = validateFlow(flow);
  resetGraph();
  state.flowName = normalizedFlow.name || normalizedFlow.rootTitle || '已加载流程图';
  state.canvas = normalizeCanvas(normalizedFlow.canvas);
  state.colorIndex = Number.isFinite(Number(normalizedFlow.colorIndex)) ? Number(normalizedFlow.colorIndex) : 0;
  state.nodes = normalizedFlow.nodes.map((node) => normalizeNode({ ...node, loading: false }));
  state.edges = normalizedFlow.edges.map((edge) => ({
    id: edge.id || genId('edge'),
    sourceId: edge.sourceId,
    targetId: edge.targetId,
  })).filter((edge) => edge.sourceId && edge.targetId);
  state.annotations = normalizedFlow.annotations.map((annotation) => ({
    id: annotation.id || genId('ann'),
    sourceNodeId: annotation.sourceNodeId,
    targetNodeId: annotation.targetNodeId,
    start: Number(annotation.start),
    length: Number(annotation.length),
    text: String(annotation.text || ''),
    colorIndex: Number.isFinite(Number(annotation.colorIndex)) ? Number(annotation.colorIndex) : 0,
  })).filter((annotation) => annotation.sourceNodeId && annotation.targetNodeId);
  state.workspaces = normalizedFlow.workspaces ? structuredClone(normalizedFlow.workspaces) : [];
  state.activeWorkspaceId = normalizedFlow.activeWorkspaceId || null;

  renderAll();
  updateCanvasTransform();
  hideWelcomeModal();
  closeServerFlowsModal();
  showToast('流程图已加载');
}

function normalizeCanvas(canvas) {
  return {
    x: Number.isFinite(Number(canvas?.x)) ? Number(canvas.x) : window.innerWidth / 2 - NODE_WIDTH / 2,
    y: Number.isFinite(Number(canvas?.y)) ? Number(canvas.y) : 150,
    scale: Number.isFinite(Number(canvas?.scale)) ? clamp(Number(canvas.scale), 0.18, 3) : 1,
  };
}

async function saveFlowToServer() {
  if (state.nodes.length === 0) {
    showToast('当前没有可保存的流程图');
    return;
  }
  const name = prompt('请输入服务端保存名称：', state.flowName || '未命名流程图');
  if (!name) return;
  try {
    const data = await postJson<SaveFlowResponse>('/api/flows', { name, flow: exportFlow() });
    state.flowName = data.name || name;
    updateFlowName();
    showToast(`已保存到服务端：${state.flowName}`);
  } catch (error) {
    showToast(`服务端保存失败：${error.message}`);
  }
}

async function openServerFlowsModal() {
  DOM.flowsModal.classList.remove('hidden');
  await refreshServerFlows();
}

function closeServerFlowsModal() {
  DOM.flowsModal.classList.add('hidden');
}

async function refreshServerFlows() {
  DOM.serverFlowList.innerHTML = '<p class="muted">正在读取...</p>';
  try {
    const data = await fetchJson<FlowListResponse>('/api/flows');
    const flows = data.flows || [];
    if (flows.length === 0) {
      DOM.serverFlowList.innerHTML = '<p class="muted">服务端还没有保存的流程图。</p>';
      return;
    }

    DOM.serverFlowList.innerHTML = '';
    for (const flow of flows) {
      const item = document.createElement('div');
      item.className = 'flow-item';
      item.innerHTML = `
        <div><strong></strong><small></small></div>
        <div class="flow-actions">
          <button class="md-btn ghost flow-load"><span class="material-symbols-outlined">open_in_new</span>加载</button>
          <button class="md-btn ghost flow-delete"><span class="material-symbols-outlined">delete</span>删除</button>
        </div>
      `;
      item.querySelector('strong').textContent = flow.name;
      item.querySelector('small').textContent = `${formatBytes(flow.size)} · ${new Date(flow.updatedAt).toLocaleString()}`;
      item.querySelector('.flow-load').addEventListener('click', async () => {
        if (!confirmReplaceGraph()) return;
        const res = await fetch(`/api/flows/${encodeURIComponent(flow.name)}`);
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || '加载失败');
          return;
        }
        loadFlow(json);
      });
      item.querySelector('.flow-delete').addEventListener('click', async () => {
        if (!confirm(`确定删除服务端流程图「${flow.name}」吗？`)) return;
        const res = await fetch(`/api/flows/${encodeURIComponent(flow.name)}`, { method: 'DELETE' });
        if (!res.ok) showToast('删除失败');
        await refreshServerFlows();
      });
      DOM.serverFlowList.appendChild(item);
    }
  } catch (error) {
    DOM.serverFlowList.innerHTML = `<p class="muted">读取失败：${escapeHtml(error.message)}</p>`;
  }
}

function isFlowObject(value) {
  return isValidFlowShape(value);
}

function confirmReplaceGraph() {
  if (state.nodes.length === 0) return true;
  return confirm('当前流程图将被替换。请确认已保存，是否继续？');
}

function getGraphSummary(excludeId = null) {
  return state.nodes
    .filter((node) => node.id !== excludeId)
    .slice(0, 40)
    .map((node, index) => `${index + 1}. ${node.title}：${plainExcerpt(node.content, 220)}`)
    .join('\n');
}

function getRootNode() {
  return state.nodes.find((node) => node.id === 'node-root') || state.nodes.find((node) => !node.parentId) || null;
}

function getNode(id) {
  return state.nodes.find((node) => node.id === id) || null;
}

function updateFlowName() {
  DOM.flowName.textContent = state.flowName || '未命名流程图';
}

function createProgressCard(options = {}) {
  return createProgressCardElement(DOM.progressStack, options);
}

function showToast(message) {
  showToastMessage(DOM.toast, message);
}
