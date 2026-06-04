import { postEventStream } from '../api.js';
import type { RhizoDomRefs } from '../dom.js';
import { updateProgressCard } from '../ui.js';
import { codeFenceText, genId, plainExcerpt } from '../utils.js';
import { NODE_FALLBACK_HEIGHT, NODE_WIDTH } from '../canvas/constants.js';
import { normalizeGeneratedNode } from '../../shared/generated-node.js';
import type { LLMStreamDoneEvent, LLMStreamEvent } from '../../shared/types.js';

const DEFAULT_PROMPT = '请详细解释并扩展成一个可读的知识节点。';

type LLMGenerationControllerOptions = {
  dom: RhizoDomRefs;
  state: any;
  getNode: (id: string) => any;
  getRootNode: () => any;
  getGraphSummary: (excludeId?: string | null) => string;
  uniqueNodeIds: (ids: string[]) => string[];
  createDocument: (title: string, content: string, options?: any) => void;
  addNode: (raw: any, options?: any) => any;
  confirmReplaceGraph: () => boolean;
  updateFlowName: () => void;
  createProgressCard: (options?: any) => string;
  showToast: (message: string) => void;
  canvasWorkspace: any;
  canvasNodes: any;
  tiledWorkspace: any;
  nodeRendering: any;
  selectionController: any;
};

export function createLLMGenerationController(options: LLMGenerationControllerOptions) {
  const {
    dom,
    state,
    getNode,
    getRootNode,
    getGraphSummary,
    uniqueNodeIds,
    createDocument,
    addNode,
    confirmReplaceGraph,
    updateFlowName,
    createProgressCard,
    showToast,
    canvasWorkspace,
    canvasNodes,
    tiledWorkspace,
    nodeRendering,
    selectionController,
  } = options;

  async function generateInitialDocument() {
    const prompt = dom.initialGeneratePrompt.value.trim();
    if (!prompt) {
      showToast('请先填写生成新文档的 Prompt');
      dom.initialGeneratePrompt.focus();
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
    canvasNodes.updateElement(root.id);

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
      await nodeRendering.renderStreamdownContent(root.id, root.content, { streaming: true });
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
        if (handleLLMToolEvent(event, progressId)) return;
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
      await nodeRendering.renderStreamdownContent(root.id, root.content, { streaming: false });
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
      canvasNodes.updateElementPreservingActiveSelection(root.id);
      updateProgressCard(progressId, { stage: '生成失败', summary: error.message || String(error), error: true });
      showToast(`生成新文档失败：${error.message}`);
    } finally {
      setInitialGenerateLoading(false);
    }
  }

  function setInitialGenerateLoading(isLoading: boolean) {
    dom.initialGenerateButton.disabled = isLoading;
    dom.initialGeneratePrompt.disabled = isLoading;
    dom.initialGenerateButton.innerHTML = isLoading
      ? '<span class="material-symbols-outlined">hourglass_top</span>生成中...'
      : '<span class="material-symbols-outlined">auto_awesome</span>生成文档';
  }

  function handleLLMToolEvent(event: LLMStreamEvent, progressId: string) {
    if (event.type === 'tool_call') {
      updateProgressCard(progressId, { stage: `调用工具：${event.name}`, summary: summarizeToolArgs(event.args) });
      return true;
    }
    if (event.type === 'tool_update') {
      updateProgressCard(progressId, { stage: `工具运行中：${event.name}`, summary: event.summary || '正在获取外部信息' });
      return true;
    }
    if (event.type === 'tool_result') {
      updateProgressCard(progressId, {
        stage: event.ok ? `工具完成：${event.name}` : `工具失败：${event.name}`,
        summary: event.summary || (event.ok ? '已获取工具结果' : '工具调用失败'),
      });
      return true;
    }
    return false;
  }

  function summarizeToolArgs(args: unknown) {
    if (!args) return '准备获取外部信息';
    if (typeof args === 'string') return plainExcerpt(args, 160);
    if (typeof args === 'object') {
      const record = args as Record<string, unknown>;
      const query = record.query || record.text_query || record.url || record.input;
      if (query) return plainExcerpt(String(query), 180);
    }
    try {
      return plainExcerpt(JSON.stringify(args), 180);
    } catch {
      return '准备获取外部信息';
    }
  }

  function openDialog(context: any) {
    if (context.mode === 'node' && !getNode(context.parentNodeId)) return;
    state.pendingLLM = context;
    dom.llmPrompt.value = context.defaultPrompt || DEFAULT_PROMPT;

    if (context.mode === 'node') {
      const parent = getNode(context.parentNodeId);
      dom.llmModalTitle.textContent = `从「${parent.title}」生成子节点`;
      dom.llmContext.textContent = `将读取该节点的完整 Markdown 内容，并根据画布剩余空间智能选择左侧或右侧创建子节点。`;
    } else {
      dom.llmModalTitle.textContent = '在画布生成独立新节点';
      dom.llmContext.textContent = '将结合当前流程图摘要，在右键位置附近创建一个无父节点的新卡片。';
    }

    dom.llmModal.classList.remove('hidden');
    setTimeout(() => dom.llmPrompt.focus(), 30);
  }

  function closeDialog() {
    dom.llmModal.classList.add('hidden');
    state.pendingLLM = null;
  }

  function submitDialog() {
    const context = state.pendingLLM;
    if (!context) return;
    const prompt = dom.llmPrompt.value.trim() || DEFAULT_PROMPT;
    closeDialog();

    if (context.mode === 'node') {
      generateChildFromNode(context.parentNodeId, prompt);
    } else if (context.mode === 'canvas') {
      generateCanvasNode(prompt, context.position || state.contextCanvasPoint);
    }
  }

  function triggerSelection() {
    const selection = state.currentSelection;
    if (!selection?.parentNodeId || !selection.text) return;
    const parent = getNode(selection.parentNodeId);
    if (!parent) return;

    const userPrompt = dom.promptInput.value.trim() || DEFAULT_PROMPT;
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
    selectionController.clearTemporarySelection();
    state.annotations.push(annotation);
    canvasNodes.applyAnnotation(annotation);
    if (state.fullscreenNodeId === parent.id) nodeRendering.syncFullscreenContent(parent.id);
    if (state.activeView === 'tiled') tiledWorkspace.render();

    selectionController.hideTooltip();
    window.getSelection()?.removeAllRanges();

    const position = canvasWorkspace.findSmartChildPosition(parent, NODE_WIDTH);
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

    void callLLMAndUpdate(node.id, {
      mode: 'selection',
      userPrompt,
      selectedText: selection.text.trim(),
      parentTitle: parent.title,
      parentContent: parent.content,
    }, { progressId });
  }

  function generateChildFromNode(parentId: string, userPrompt: string) {
    const parent = getNode(parentId);
    if (!parent) return;
    const currentColor = state.colorIndex;
    state.colorIndex = (state.colorIndex + 1) % 5;
    const position = canvasWorkspace.findSmartChildPosition(parent, NODE_WIDTH);
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

    void callLLMAndUpdate(node.id, {
      mode: 'node',
      userPrompt,
      parentTitle: parent.title,
      parentContent: parent.content,
    }, { progressId });
  }

  function generateCanvasNode(userPrompt: string, position: any) {
    const safePosition = canvasWorkspace.findSafePosition(position?.x ?? 0, position?.y ?? 0, NODE_WIDTH, NODE_FALLBACK_HEIGHT);
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

    void callLLMAndUpdate(node.id, {
      mode: 'canvas',
      userPrompt,
      parentTitle: '',
      parentContent: '',
    }, { progressId });
  }

  async function callLLMAndUpdate(nodeId: string, payload: any, { progressId = null }: any = {}) {
    const node = getNode(nodeId);
    if (!node) return;

    node.loading = true;
    node.error = null;
    canvasNodes.updateElement(nodeId);

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
      await nodeRendering.renderStreamdownContent(nodeId, node.content, { streaming: true });
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
        if (handleLLMToolEvent(event, progressId)) return;
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
      await nodeRendering.renderStreamdownContent(nodeId, node.content, { streaming: false });
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
      canvasNodes.updateElementPreservingActiveSelection(nodeId);
      updateProgressCard(progressId, { stage: '生成失败', summary: error.message || String(error), error: true });
      showToast(`LLM 调用失败：${error.message}`);
    } finally {
      progressTimers.forEach(clearTimeout);
    }
  }

  function regenerateNode(id: string) {
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
    canvasNodes.updateElement(id);
    void callLLMAndUpdate(id, {
      mode: 'regenerate',
      userPrompt,
      selectedText: savedLLM.selectedText || '',
      parentTitle: parent?.title || '',
      parentContent: parent?.content || '',
    }, { progressId });
  }

  function regenerateNodes(ids: string[]) {
    const targets = uniqueNodeIds(ids).filter((id) => {
      const node = getNode(id);
      return node && id !== 'node-root' && node.llm;
    });
    for (const id of targets) regenerateNode(id);
  }

  return {
    generateInitialDocument,
    openDialog,
    closeDialog,
    submitDialog,
    triggerSelection,
    generateChildFromNode,
    generateCanvasNode,
    regenerateNode,
    regenerateNodes,
  };
}
