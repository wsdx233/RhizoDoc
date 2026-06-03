import { marked } from '/vendor/marked.esm.js';
import DOMPurify from '/vendor/purify.es.mjs';

marked.setOptions({ gfm: true, breaks: true });

const NODE_WIDTH = 340;
const NODE_MIN_WIDTH = 280;
const NODE_MAX_WIDTH = 820;
const NODE_COLLAPSE_HEIGHT = 260;
const NODE_FALLBACK_HEIGHT = 190;
const EDGE_SVG_OFFSET = 8000;
const DEFAULT_PROMPT = '请详细解释并扩展成一个可读的知识节点。';

const state = {
  canvas: { x: window.innerWidth / 2 - NODE_WIDTH / 2, y: 160, scale: 1 },
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  isDraggingNode: false,
  draggedNodeId: null,
  nodeDragOffset: { x: 0, y: 0 },
  isResizing: false,
  resizeNodeId: null,
  resizeStartWidth: 0,
  resizeStartX: 0,
  isDraggingMinimap: false,
  nodes: [],
  edges: [],
  annotations: [],
  colorIndex: 0,
  currentSelection: { text: '', parentNodeId: null, start: 0, length: 0, source: 'node' },
  keepTooltipAfterSelectionClear: false,
  contextNodeId: null,
  contextCanvasPoint: { x: 0, y: 0 },
  pendingLLM: null,
  fullscreenNodeId: null,
  progressIdCount: 0,
  flowName: '未命名流程图',
  appConfig: null,
  minimapBounds: null,
};

const DOM = {
  viewport: document.getElementById('viewport'),
  canvas: document.getElementById('canvas'),
  nodesLayer: document.getElementById('nodes-layer'),
  edgesLayer: document.getElementById('edges-layer'),
  topbar: document.getElementById('topbar'),
  flowName: document.getElementById('flow-name'),
  apiStatus: document.getElementById('api-status'),
  tooltip: document.getElementById('action-tooltip'),
  tooltipView: document.querySelector('#action-tooltip .tooltip-view'),
  promptInput: document.getElementById('ai-prompt'),
  nodeMenu: document.getElementById('node-context-menu'),
  canvasMenu: document.getElementById('canvas-context-menu'),
  minimap: document.getElementById('minimap'),
  minimapContent: document.getElementById('minimap-content'),
  minimapViewport: document.getElementById('minimap-viewport'),
  toast: document.getElementById('toast'),
  progressStack: document.getElementById('progress-stack'),
  fullscreenOverlay: document.getElementById('fullscreen-overlay'),
  fsTitle: document.getElementById('fs-title'),
  fsContent: document.getElementById('fs-content'),

  initialFileInput: document.getElementById('initial-file-input'),
  docFileInput: document.getElementById('doc-file-input'),
  flowFileInput: document.getElementById('flow-file-input'),
  welcomeModal: document.getElementById('welcome-modal'),
  initialTitle: document.getElementById('initial-title'),
  initialContent: document.getElementById('initial-content'),
  initialGeneratePrompt: document.getElementById('initial-generate-prompt'),
  initialGenerateButton: document.getElementById('btn-generate-initial'),

  llmModal: document.getElementById('llm-modal'),
  llmModalTitle: document.getElementById('llm-modal-title'),
  llmContext: document.getElementById('llm-context'),
  llmPrompt: document.getElementById('llm-prompt'),

  flowsModal: document.getElementById('flows-modal'),
  serverFlowList: document.getElementById('server-flow-list'),
};

init();

async function init() {
  bindEvents();
  updateCanvasTransform();
  updateFlowName();
  await loadAppConfig();
  showWelcomeModal();
}

function bindEvents() {
  document.getElementById('btn-open-initial-file').addEventListener('click', () => DOM.initialFileInput.click());
  DOM.initialFileInput.addEventListener('change', async (event) => {
    await handleDocumentFile(event.target.files?.[0], { fromInitial: true });
    event.target.value = '';
  });

  document.getElementById('btn-create-initial').addEventListener('click', () => {
    createDocument(DOM.initialTitle.value.trim() || '核心文档', DOM.initialContent.value || '', { force: state.nodes.length === 0 });
  });
  DOM.initialGenerateButton.addEventListener('click', generateInitialDocument);
  DOM.initialGeneratePrompt.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') generateInitialDocument();
  });

  document.getElementById('btn-use-demo').addEventListener('click', () => {
    createDocument('RhizoDoc 演示', demoDocument(), { force: state.nodes.length === 0 });
  });
  DOM.welcomeModal.addEventListener('mousedown', (event) => {
    if (event.target === DOM.welcomeModal) hideWelcomeModal();
  });

  document.getElementById('btn-new-doc').addEventListener('click', showWelcomeModal);
  document.getElementById('btn-open-doc').addEventListener('click', () => DOM.docFileInput.click());
  DOM.docFileInput.addEventListener('change', async (event) => {
    await handleDocumentFile(event.target.files?.[0], { fromInitial: false });
    event.target.value = '';
  });

  document.getElementById('btn-save-flow').addEventListener('click', downloadFlow);
  document.getElementById('btn-load-flow').addEventListener('click', () => DOM.flowFileInput.click());
  DOM.flowFileInput.addEventListener('change', async (event) => {
    await handleFlowFile(event.target.files?.[0]);
    event.target.value = '';
  });
  document.getElementById('btn-server-save').addEventListener('click', saveFlowToServer);
  document.getElementById('btn-server-load').addEventListener('click', openServerFlowsModal);
  document.getElementById('btn-flows-close').addEventListener('click', closeServerFlowsModal);
  document.getElementById('btn-refresh-flows').addEventListener('click', refreshServerFlows);

  DOM.viewport.addEventListener('mousedown', onViewportMouseDown);
  DOM.viewport.addEventListener('auxclick', onViewportAuxClick);
  DOM.nodesLayer.addEventListener('mousedown', onNodesLayerMouseDown);
  DOM.nodesLayer.addEventListener('click', onNodesLayerClick);
  window.addEventListener('mousemove', onWindowMouseMove);
  window.addEventListener('mouseup', onWindowMouseUp);
  document.addEventListener('mouseup', (event) => {
    if (shouldLockNativeSelectionMenu()) {
      event.preventDefault();
      lockNativeSelectionMenu();
    }
    setTimeout(lockNativeSelectionMenu, 0);
  }, true);
  DOM.viewport.addEventListener('wheel', onViewportWheel, { passive: false });
  window.addEventListener('resize', () => {
    drawEdges();
    updateMinimap();
  });

  document.addEventListener('selectionchange', handleSelection);
  document.addEventListener('mousedown', (event) => {
    if (!event.target.closest('#action-tooltip') && event.target.closest('.node-content, .fs-content')) hideTooltip();
    if (!event.target.closest('#action-tooltip') && !event.target.closest('.node') && !event.target.closest('.fullscreen-container')) hideTooltip();
    if (!event.target.closest('.context-menu')) hideMenus();
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
  document.getElementById('btn-confirm').addEventListener('click', triggerSelectionLLM);
  document.getElementById('btn-cancel').addEventListener('click', hideTooltip);

  DOM.viewport.addEventListener('contextmenu', onContextMenu);
  document.getElementById('menu-fullscreen').addEventListener('click', () => {
    hideMenus();
    openFullscreen(state.contextNodeId);
  });
  document.getElementById('menu-toggle-collapse').addEventListener('click', () => {
    hideMenus();
    toggleNodeCollapse(state.contextNodeId);
  });
  document.getElementById('menu-ai-child').addEventListener('click', () => {
    hideMenus();
    openLLMDialog({ mode: 'node', parentNodeId: state.contextNodeId });
  });
  document.getElementById('menu-ai-canvas').addEventListener('click', () => {
    hideMenus();
    openLLMDialog({ mode: 'canvas', position: { ...state.contextCanvasPoint } });
  });
  document.getElementById('menu-regen').addEventListener('click', () => {
    hideMenus();
    regenerateNode(state.contextNodeId);
  });
  document.getElementById('menu-delete').addEventListener('click', () => {
    hideMenus();
    deleteNode(state.contextNodeId);
  });
  document.getElementById('menu-zoom-in').addEventListener('click', () => { hideMenus(); zoom(0.2, window.innerWidth / 2, window.innerHeight / 2); });
  document.getElementById('menu-zoom-out').addEventListener('click', () => { hideMenus(); zoom(-0.2, window.innerWidth / 2, window.innerHeight / 2); });
  document.getElementById('menu-zoom-fit').addEventListener('click', () => { hideMenus(); zoomFit(); });
  document.getElementById('menu-center').addEventListener('click', () => { hideMenus(); triggerCenter(); });

  document.getElementById('btn-center').addEventListener('click', triggerCenter);
  document.getElementById('btn-zoom-in').addEventListener('click', () => zoom(0.2, window.innerWidth / 2, window.innerHeight / 2));
  document.getElementById('btn-zoom-out').addEventListener('click', () => zoom(-0.2, window.innerWidth / 2, window.innerHeight / 2));
  document.getElementById('btn-zoom-fit').addEventListener('click', zoomFit);
  DOM.minimap.addEventListener('mousedown', onMinimapMouseDown);

  document.getElementById('btn-fs-close').addEventListener('click', closeFullscreen);
  DOM.fullscreenOverlay.addEventListener('mousedown', (event) => {
    if (event.target === DOM.fullscreenOverlay) closeFullscreen();
  });
  DOM.fsContent.addEventListener('click', (event) => {
    const mark = event.target.closest('mark.annotated');
    const targetId = mark?.dataset.refId;
    if (targetId) focusNode(targetId);
  });

  document.getElementById('btn-llm-close').addEventListener('click', closeLLMDialog);
  document.getElementById('btn-llm-cancel').addEventListener('click', closeLLMDialog);
  document.getElementById('btn-llm-submit').addEventListener('click', submitLLMDialog);
  DOM.llmPrompt.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') submitLLMDialog();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    hideTooltip();
    hideMenus();
    closeFullscreen();
    closeLLMDialog();
    closeServerFlowsModal();
  });
}

async function loadAppConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    state.appConfig = config;
    if (config.hasApiKey) {
      DOM.apiStatus.className = 'status-cluster ok';
      DOM.apiStatus.innerHTML = [
        '<span class="status-chip ready-chip"><svg class="status-fan status-fan-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" aria-hidden="true"><path d="M480-480q0-91 64.5-155.5T700-700q91 0 155.5 64.5T920-480H480ZM104.5-324.5Q40-389 40-480h440q0 91-64.5 155.5T260-260q-91 0-155.5-64.5ZM480-480q-91 0-155.5-64.5T260-700q0-91 64.5-155.5T480-920v440Zm0 440v-440q91 0 155.5 64.5T700-260q0 91-64.5 155.5T480-40Z"/></svg>就绪</span>',
        `<span class="status-chip" title="API 类型"><span class="material-symbols-outlined">hub</span>${escapeHtml(formatApiType(config.apiType))}</span>`,
        `<span class="status-chip" title="模型"><span class="material-symbols-outlined">deployed_code</span>${escapeHtml(config.model || '未设置模型')}</span>`,
        `<span class="status-chip" title="Reasoning Effort"><span class="material-symbols-outlined">psychology_alt</span>${escapeHtml(config.reasoningEffort || 'default')}</span>`,
      ].join('');
    } else {
      DOM.apiStatus.className = 'status-cluster warn';
      DOM.apiStatus.innerHTML = [
        '<span class="status-chip ready-chip"><span class="material-symbols-outlined">warning</span>未配置</span>',
        '<span class="status-chip"><span class="material-symbols-outlined">key_off</span>缺少 API Key</span>',
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
  if (state.appConfig && !state.appConfig.hasApiKey) {
    showToast('请先在 .env 中配置 OPENAI_API_KEY 并重启服务');
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
  try {
    updateProgressCard(progressId, { stage: '请求模型', summary: '模型正在生成完整 Markdown 文档' });
    const response = await fetch('/api/llm/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'initial', userPrompt: prompt }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.error || `HTTP ${response.status}`);

    const title = data.title || prompt.slice(0, 24) || 'AI 生成文档';
    createDocument(title, data.content || '（模型没有返回内容）', { force: true });

    const root = getRootNode();
    if (root) {
      root.kind = 'ai';
      root.llm = {
        mode: 'initial',
        userPrompt: prompt,
        model: data.model,
        apiType: data.apiType,
        reasoningEffort: data.reasoningEffort,
        usage: data.usage,
      };
      root.updatedAt = new Date().toISOString();
      updateNodeElement(root.id);
    }
    updateProgressCard(progressId, { stage: '生成完成', summary: plainExcerpt(data.content || '', 120), done: true });
    showToast('AI 新文档已生成');
  } catch (error) {
    updateProgressCard(progressId, { stage: '生成失败', summary: error.message, error: true });
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
  state.fullscreenNodeId = null;
  DOM.fullscreenOverlay.classList.add('hidden');
  DOM.nodesLayer.innerHTML = '';
  DOM.edgesLayer.innerHTML = '';
}

function renderAll() {
  DOM.nodesLayer.innerHTML = '';
  for (const node of state.nodes) renderNode(node);
  drawEdges();
  updateMinimap();
  updateFlowName();
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
  nodeEl.innerHTML = `
    <div class="node-header" title="拖拽移动节点">
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

function updateNodeElement(id) {
  const node = getNode(id);
  const nodeEl = document.getElementById(id);
  if (!node || !nodeEl) return;

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

  const contentEl = nodeEl.querySelector('.node-content');
  nodeEl.classList.remove('collapsible', 'collapsed', 'expanded');
  contentEl.innerHTML = renderMarkdown(node.content || '');
  postProcessNodeContent(contentEl);
  applyAnnotationsForSourceNode(node.id);

  nodeEl.querySelector('.node-kind').textContent = node.llm ? 'AI / Markdown' : '文档 / Markdown';
  nodeEl.querySelector('.node-count').textContent = `${(node.content || '').length} 字`;

  requestAnimationFrame(() => {
    updateNodeCollapseState(node.id);
    if (state.fullscreenNodeId === node.id) syncFullscreenContent(node.id);
    drawEdges();
    updateMinimap();
  });
}

function updateNodeCollapseState(id) {
  const node = getNode(id);
  const nodeEl = document.getElementById(id);
  const contentEl = nodeEl?.querySelector('.node-content');
  if (!node || !nodeEl || !contentEl) return;

  nodeEl.style.setProperty('--node-collapse-height', `${NODE_COLLAPSE_HEIGHT}px`);
  const isLong = contentEl.scrollHeight > NODE_COLLAPSE_HEIGHT + 8;
  const effectiveCollapsed = isLong && Boolean(node.collapsed);
  nodeEl.classList.toggle('collapsible', isLong);
  nodeEl.classList.toggle('collapsed', effectiveCollapsed);
  nodeEl.classList.toggle('expanded', isLong && !effectiveCollapsed);

  const toggleBtn = nodeEl.querySelector('[data-node-action="toggle"]');
  const toggleIcon = toggleBtn?.querySelector('.material-symbols-outlined');
  if (toggleBtn && toggleIcon) {
    toggleIcon.textContent = effectiveCollapsed ? 'unfold_more' : 'unfold_less';
    toggleBtn.title = effectiveCollapsed ? '展开内容' : '收起内容';
  }
  const expandBtn = nodeEl.querySelector('.expand-btn');
  if (toggleBtn) {
    toggleBtn.style.display = isLong ? 'inline-flex' : 'none';
    toggleBtn.setAttribute('aria-hidden', isLong ? 'false' : 'true');
  }
  if (expandBtn) {
    expandBtn.innerHTML = effectiveCollapsed
      ? '<span class="expand-label">展开全部</span> <span class="material-symbols-outlined">keyboard_arrow_down</span>'
      : '<span class="expand-label">收起内容</span> <span class="material-symbols-outlined">keyboard_arrow_up</span>';
  }
}

function toggleNodeCollapse(id) {
  const node = getNode(id);
  const nodeEl = document.getElementById(id);
  if (!node) return;
  if (nodeEl && !nodeEl.classList.contains('collapsible')) return;
  node.collapsed = !node.collapsed;
  node.updatedAt = new Date().toISOString();
  updateNodeCollapseState(id);
  setTimeout(() => {
    drawEdges();
    updateMinimap();
  }, 180);
}

function renderMarkdown(markdown) {
  try {
    const html = marked.parse(markdown || '');
    return DOMPurify.sanitize(html, {
      ADD_ATTR: ['target', 'rel'],
    });
  } catch (error) {
    return `<pre><code>${escapeHtml(markdown || '')}</code></pre>`;
  }
}

function postProcessNodeContent(contentEl) {
  contentEl.querySelectorAll('a[href]').forEach((link) => {
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
  });
}

function onViewportMouseDown(event) {
  const isLeftButton = event.button === 0;
  const isMiddleButton = event.button === 1;
  if (!isLeftButton && !isMiddleButton) return;

  // 左键保持原逻辑：点在节点/浮层/工具栏时不拖动画布。
  // 中键作为全局画布平移入口：即使鼠标在文档节点内容中，也可以直接拖动画布。
  if (isLeftButton && event.target.closest('.node, #action-tooltip, #toolbar, #topbar')) return;

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
  if (event.button !== 0) return;
  const nodeEl = event.target.closest('.node');
  if (!nodeEl) return;

  const resizeHandle = event.target.closest('.resize-handle');
  if (resizeHandle) {
    const node = getNode(nodeEl.id);
    if (!node) return;
    state.isResizing = true;
    state.resizeNodeId = nodeEl.id;
    state.resizeStartWidth = nodeEl.offsetWidth || node.width || NODE_WIDTH;
    state.resizeStartX = event.clientX;
    hideTooltip();
    hideMenus();
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  if (event.target.closest('.node-btn') || event.target.closest('.expand-btn')) return;

  const header = event.target.closest('.node-header');
  if (!header) return;
  state.isDraggingNode = true;
  state.draggedNodeId = nodeEl.id;
  const rect = nodeEl.getBoundingClientRect();
  state.nodeDragOffset = {
    x: (event.clientX - rect.left) / state.canvas.scale,
    y: (event.clientY - rect.top) / state.canvas.scale,
  };
  hideTooltip();
  hideMenus();
  event.preventDefault();
}

function onNodesLayerClick(event) {
  const action = event.target.closest('[data-node-action]');
  if (action && !action.classList.contains('resize-handle')) {
    const nodeEl = action.closest('.node');
    if (!nodeEl) return;
    event.preventDefault();
    event.stopPropagation();
    hideTooltip();
    hideMenus();
    const actionName = action.dataset.nodeAction;
    if (actionName === 'fullscreen') openFullscreen(nodeEl.id);
    if (actionName === 'toggle') toggleNodeCollapse(nodeEl.id);
    return;
  }

  const mark = event.target.closest('mark.annotated');
  if (!mark) return;
  const targetId = mark.dataset.refId;
  if (targetId) focusNode(targetId);
}

function onWindowMouseMove(event) {
  if (state.isDraggingMinimap) {
    centerCanvasFromMinimapEvent(event);
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
    const newWidth = clamp(state.resizeStartWidth + delta, NODE_MIN_WIDTH, NODE_MAX_WIDTH);
    node.width = newWidth;
    node.updatedAt = new Date().toISOString();
    nodeEl.style.width = `${newWidth}px`;
    updateNodeCollapseState(node.id);
    drawEdges();
    updateMinimap();
    return;
  }

  if (state.isDraggingNode && state.draggedNodeId) {
    const node = getNode(state.draggedNodeId);
    const nodeEl = document.getElementById(state.draggedNodeId);
    if (!node || !nodeEl) return;
    const newX = (event.clientX - state.canvas.x) / state.canvas.scale - state.nodeDragOffset.x;
    const newY = (event.clientY - state.canvas.y) / state.canvas.scale - state.nodeDragOffset.y;
    node.x = newX;
    node.y = newY;
    node.updatedAt = new Date().toISOString();
    nodeEl.style.left = `${newX}px`;
    nodeEl.style.top = `${newY}px`;
    drawEdges();
    updateMinimap();
  }
}

function onWindowMouseUp() {
  state.isDragging = false;
  state.isDraggingNode = false;
  state.draggedNodeId = null;
  state.isResizing = false;
  state.resizeNodeId = null;
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

function handleSelection() {
  if (state.isDragging || state.isDraggingNode || state.isResizing) return;
  if (!DOM.llmModal.classList.contains('hidden') || !DOM.welcomeModal.classList.contains('hidden')) return;

  const selection = window.getSelection();
  const rawText = selection?.toString() || '';
  if (!selection || selection.rangeCount === 0 || rawText.trim().length === 0) {
    if (state.keepTooltipAfterSelectionClear) {
      state.keepTooltipAfterSelectionClear = false;
      return;
    }
    if (!DOM.tooltip.classList.contains('focus')) hideTooltip();
    return;
  }

  const range = selection.getRangeAt(0);
  const contentEl = closestElement(range.commonAncestorContainer, '.node-content, .fs-content');
  if (!contentEl) return;

  const fsSourceId = contentEl.classList.contains('fs-content') ? contentEl.dataset.sourceId : '';
  const nodeEl = contentEl.closest('.node');
  const parentNodeId = fsSourceId || nodeEl?.id;
  if (!parentNodeId || !getNode(parentNodeId)) return;

  const offsets = getRangeOffsets(contentEl, range);
  if (!offsets || offsets.length <= 0) return;

  const normalized = normalizeSelectionText(rawText);
  if (!normalized.text) return;

  state.currentSelection = {
    text: normalized.text,
    parentNodeId,
    start: offsets.start + normalized.leading,
    length: normalized.text.length,
    source: fsSourceId ? 'fullscreen' : 'node',
  };

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
    : document.getElementById(selection.parentNodeId)?.querySelector('.node-content');
  if (!container) return;
  wrapTemporarySelectionByOffset(container, Number(selection.start), Number(selection.length));
}

function wrapTemporarySelectionByOffset(container, start, length) {
  if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0) return;
  const end = start + length;
  let cursor = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const textNode of textNodes) {
    const value = textNode.nodeValue || '';
    const nodeStart = cursor;
    const nodeEnd = cursor + value.length;
    cursor = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const from = Math.max(0, start - nodeStart);
    const to = Math.min(value.length, end - nodeStart);
    if (from < to) wrapTemporaryTextNodeSegment(textNode, from, to);
  }
}

function wrapTemporaryTextNodeSegment(textNode, from, to) {
  const value = textNode.nodeValue || '';
  const selectedText = value.slice(from, to);
  if (!selectedText.trim()) return;

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

function clearTemporarySelection() {
  document.querySelectorAll('.retained-selection').forEach((span) => {
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize();
  });
}

function normalizeSelectionText(rawText) {
  const text = String(rawText || '');
  const leading = text.match(/^\s*/)?.[0]?.length || 0;
  const trailing = text.match(/\s*$/)?.[0]?.length || 0;
  const trimmed = text.slice(leading, text.length - trailing);
  return { text: trimmed, leading, trailing };
}

function getRangeOffsets(container, range) {
  try {
    const before = document.createRange();
    before.selectNodeContents(container);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    return { start, length: range.toString().length };
  } catch {
    return null;
  }
}

function hideTooltip() {
  clearTemporarySelection();
  DOM.tooltip.style.display = 'none';
  DOM.tooltip.classList.remove('focus');
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

function syncFullscreenContent(id) {
  const node = getNode(id);
  if (!node || state.fullscreenNodeId !== id) return;
  DOM.fsContent.innerHTML = renderMarkdown(node.content || '');
  postProcessNodeContent(DOM.fsContent);
  state.annotations
    .filter((annotation) => annotation.sourceNodeId === id)
    .forEach((annotation) => applyAnnotationToContainer(DOM.fsContent, annotation));
}

function onContextMenu(event) {
  event.preventDefault();
  hideTooltip();
  const nodeEl = event.target.closest('.node');

  if (nodeEl) {
    state.contextNodeId = nodeEl.id;
    const node = getNode(nodeEl.id);
    const toggleMenu = document.getElementById('menu-toggle-collapse');
    const toggleIcon = toggleMenu.querySelector('.material-symbols-outlined');
    const isCollapsed = nodeEl.classList.contains('collapsed');
    const isCollapsible = nodeEl.classList.contains('collapsible');
    toggleIcon.textContent = isCollapsed ? 'unfold_more' : 'unfold_less';
    toggleMenu.lastChild.textContent = isCollapsed ? ' 展开内容' : ' 收起内容';
    toggleMenu.classList.toggle('disabled', !isCollapsible);
    document.getElementById('menu-regen').classList.toggle('disabled', nodeEl.id === 'node-root' || !node?.llm);
    document.getElementById('menu-delete').classList.toggle('disabled', nodeEl.id === 'node-root');
    DOM.canvasMenu.style.display = 'none';
    showMenu(DOM.nodeMenu, event.clientX, event.clientY);
  } else {
    state.contextNodeId = null;
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
    setTimeout(() => updateProgressCard(progressId, { stage: '大模型生成中', summary: '正在生成标题和 Markdown 正文' }), 1800),
  ];

  try {
    const response = await fetch('/api/llm/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(enrichedPayload),
    });
    updateProgressCard(progressId, { stage: '解析响应', summary: '正在渲染生成节点' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || data.error || `HTTP ${response.status}`);

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
    updateNodeElement(nodeId);
    updateProgressCard(progressId, { stage: '生成完成', summary: plainExcerpt(node.content, 130), done: true });
    showToast('LLM 节点已生成');
  } catch (error) {
    node.title = '生成失败';
    node.content = [
      '> LLM 调用失败。',
      '',
      '请检查 `.env` 中的 `OPENAI_API_KEY`、`OPENAI_MODEL`，以及服务端控制台错误。',
      '',
      '```text',
      codeFenceText(error.message || String(error)),
      '```',
    ].join('\n');
    node.loading = false;
    node.error = error.message || String(error);
    node.updatedAt = new Date().toISOString();
    updateNodeElement(nodeId);
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
  if (!id || id === 'node-root') {
    showToast('根节点不能删除');
    return;
  }
  const node = getNode(id);
  if (!node) return;
  const childCount = state.edges.filter((edge) => edge.sourceId === id).length;
  if (childCount > 0 && !confirm(`该节点还有 ${childCount} 个子节点。删除后子节点会保留但断开连接，继续吗？`)) return;

  unwrapMarksForTarget(id);
  state.annotations = state.annotations.filter((annotation) => annotation.targetNodeId !== id && annotation.sourceNodeId !== id);
  state.nodes = state.nodes.filter((item) => item.id !== id);
  state.nodes.forEach((item) => {
    if (item.parentId === id) item.parentId = null;
  });
  state.edges = state.edges.filter((edge) => edge.sourceId !== id && edge.targetId !== id);
  if (state.fullscreenNodeId === id) closeFullscreen();
  document.getElementById(id)?.remove();
  drawEdges();
  updateMinimap();
  showToast('节点已删除');
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

function highlightColors(colorIndex) {
  const index = ((Number(colorIndex) || 0) % 5 + 5) % 5;
  return { bg: `var(--hl-${index}-bg)`, fg: `var(--hl-${index}-fg)` };
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

function applyAnnotationToContainer(container, annotation) {
  if (!container) return;
  if (container.querySelector(`mark[data-annotation-id="${cssAttr(annotation.id)}"]`)) return;

  const totalText = container.textContent || '';
  let start = Number(annotation.start);
  let length = Number(annotation.length);
  const storedText = annotation.text || '';

  if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0 || totalText.slice(start, start + length) !== storedText) {
    const index = storedText ? totalText.indexOf(storedText) : -1;
    if (index < 0) return;
    start = index;
    length = storedText.length;
  }

  wrapTextByOffset(container, start, length, annotation);
}

function wrapTextByOffset(container, start, length, annotation) {
  const end = start + length;
  let cursor = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  for (const textNode of textNodes) {
    const value = textNode.nodeValue || '';
    const nodeStart = cursor;
    const nodeEnd = cursor + value.length;
    cursor = nodeEnd;

    if (nodeEnd <= start || nodeStart >= end) continue;
    const from = Math.max(0, start - nodeStart);
    const to = Math.min(value.length, end - nodeStart);
    if (from >= to) continue;
    wrapTextNodeSegment(textNode, from, to, annotation);
  }
}

function wrapTextNodeSegment(textNode, from, to, annotation) {
  const value = textNode.nodeValue || '';
  const fragment = document.createDocumentFragment();
  if (from > 0) fragment.appendChild(document.createTextNode(value.slice(0, from)));

  const mark = document.createElement('mark');
  const colors = highlightColors(annotation.colorIndex);
  mark.className = 'annotated';
  mark.dataset.refId = annotation.targetNodeId;
  mark.dataset.annotationId = annotation.id;
  mark.style.backgroundColor = colors.bg;
  mark.style.color = colors.fg;
  mark.title = '点击定位到生成节点';
  mark.textContent = value.slice(from, to);
  fragment.appendChild(mark);

  if (to < value.length) fragment.appendChild(document.createTextNode(value.slice(to)));
  textNode.parentNode?.replaceChild(fragment, textNode);
}

function unwrapMarksForTarget(targetId) {
  document.querySelectorAll('mark.annotated').forEach((mark) => {
    if (mark.dataset.refId !== targetId) return;
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
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
  return {
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
  resetGraph();
  state.flowName = flow.name || flow.rootTitle || '已加载流程图';
  state.canvas = normalizeCanvas(flow.canvas);
  state.colorIndex = Number.isFinite(Number(flow.colorIndex)) ? Number(flow.colorIndex) : 0;
  state.nodes = (flow.nodes || []).map((node) => normalizeNode({ ...node, loading: false }));
  state.edges = (flow.edges || []).map((edge) => ({
    id: edge.id || genId('edge'),
    sourceId: edge.sourceId,
    targetId: edge.targetId,
  })).filter((edge) => edge.sourceId && edge.targetId);
  state.annotations = (flow.annotations || []).map((annotation) => ({
    id: annotation.id || genId('ann'),
    sourceNodeId: annotation.sourceNodeId,
    targetNodeId: annotation.targetNodeId,
    start: Number(annotation.start),
    length: Number(annotation.length),
    text: String(annotation.text || ''),
    colorIndex: Number.isFinite(Number(annotation.colorIndex)) ? Number(annotation.colorIndex) : 0,
  })).filter((annotation) => annotation.sourceNodeId && annotation.targetNodeId);

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
    const response = await fetch('/api/flows', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, flow: exportFlow() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || data.detail || `HTTP ${response.status}`);
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
    const response = await fetch('/api/flows');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
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
  return value && typeof value === 'object' && Array.isArray(value.nodes) && Array.isArray(value.edges);
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

function closestElement(node, selector) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.(selector) || null;
}

function genId(prefix) {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}

function cssAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function safeFileName(value) {
  return String(value || 'flow').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/\s+/g, '_').slice(0, 90) || 'flow';
}

function plainExcerpt(markdown, maxLength) {
  const text = String(markdown || '')
    .replace(/```[\s\S]*?```/g, ' 代码块 ')
    .replace(/[#>*_`\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function codeFenceText(value) {
  return String(value || '').replace(/```/g, '`\u200b``');
}

function formatApiType(apiType) {
  if (apiType === 'chat_completions') return 'Chat Completions';
  if (apiType === 'responses') return 'Responses';
  if (apiType === 'auto') return 'Auto';
  return apiType || 'API';
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function createProgressCard({ title, sourceLabel = '批注', sourceText = '', prompt = '', stage = '准备中', summary = '' } = {}) {
  const id = `progress-${state.progressIdCount++}`;
  const card = document.createElement('article');
  card.id = id;
  card.className = 'progress-card';
  card.innerHTML = `
    <div class="progress-icon"><span class="material-symbols-outlined">progress_activity</span></div>
    <div class="progress-body">
      <div class="progress-title-row"><span class="progress-title"></span><span class="progress-stage"></span></div>
      <div class="progress-line"><span class="progress-label source-label"></span><span class="progress-value source-value"></span></div>
      <div class="progress-line"><span class="progress-label">提问</span><span class="progress-value prompt-value"></span></div>
      <div class="progress-line"><span class="progress-label">摘要</span><span class="progress-value summary-value"></span></div>
    </div>
  `;
  DOM.progressStack.appendChild(card);
  updateProgressCard(id, { title, sourceLabel, sourceText, prompt, stage, summary });
  return id;
}

function updateProgressCard(id, { title, sourceLabel, sourceText, prompt, stage, summary, done = false, error = false } = {}) {
  if (!id) return;
  const card = document.getElementById(id);
  if (!card) return;
  if (title !== undefined) card.querySelector('.progress-title').textContent = title || 'AI 生成';
  if (stage !== undefined) card.querySelector('.progress-stage').textContent = stage || '';
  if (sourceLabel !== undefined) card.querySelector('.source-label').textContent = sourceLabel || '上下文';
  if (sourceText !== undefined) card.querySelector('.source-value').textContent = sourceText || '—';
  if (prompt !== undefined) card.querySelector('.prompt-value').textContent = prompt || '默认扩展提示';
  if (summary !== undefined) card.querySelector('.summary-value').textContent = summary || '—';
  if (done || error) {
    card.classList.toggle('done', done && !error);
    card.classList.toggle('error', error);
    const icon = card.querySelector('.progress-icon .material-symbols-outlined');
    icon.textContent = error ? 'error' : 'check_circle';
    setTimeout(() => {
      card.style.opacity = '0';
      card.style.transform = 'translateX(-16px)';
      setTimeout(() => card.remove(), 260);
    }, error ? 6200 : 3800);
  }
}

let toastTimer = null;
function showToast(message) {
  DOM.toast.textContent = message;
  DOM.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => DOM.toast.classList.remove('show'), 2800);
}

function demoDocument() {
  return `# RhizoDoc 使用说明

这是一个可交互的 Markdown 文档节点。你可以：

1. **选中一段文字**，在浮层中输入要求，然后让 LLM 生成解释节点。
2. **右键任何节点**，选择“LLM 生成新节点”，根据整张卡片继续扩展。
3. **右键空白画布**，也可以让 LLM 在当前位置创建一个独立新节点。
4. 节点内容会按 Markdown 渲染，包括列表、表格、代码块和引用。
5. 顶部按钮支持保存 / 加载流程图 JSON，也支持保存到 Node 服务端。

> 后端支持 OpenAI Responses / Chat Completions API。默认 base URL 为 \`https://api.openai.com/v1\`，也可以在项目根目录的 \`.env\` 中配置兼容 OpenAI 的服务、模型名称和 reasoning effort。

## 可以尝试选中这句话

“把复杂文档拆成可追溯的知识节点，可以让分析过程更像一张可演化的研究地图。”
`;
}
