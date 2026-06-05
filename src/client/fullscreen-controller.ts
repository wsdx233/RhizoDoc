import type { RhizoDomRefs } from './dom.js';

type FullscreenControllerOptions = {
  dom: RhizoDomRefs;
  state: any;
  getNode: (id: string) => any;
  nodeRendering: any;
  selectionController: any;
  canvasWorkspace: any;
};

export function createFullscreenController(options: FullscreenControllerOptions) {
  const { dom, state, getNode, nodeRendering, selectionController, canvasWorkspace } = options;

  function open(id: string) {
    const node = getNode(id);
    if (!node) return;
    state.fullscreenNodeId = id;
    dom.fsTitle.textContent = node.title || '节点全屏浏览';
    dom.fsContent.dataset.sourceId = id;
    nodeRendering.syncFullscreenContent(id);
    dom.fullscreenOverlay.classList.remove('hidden');
  }

  function close() {
    if (dom.fullscreenOverlay.classList.contains('hidden')) return;
    dom.fullscreenOverlay.classList.add('hidden');
    state.fullscreenNodeId = null;
    dom.fsContent.dataset.sourceId = '';
    selectionController.hideTooltip();
    window.getSelection()?.removeAllRanges();
  }

  function handleOverlayMouseDown(event: MouseEvent) {
    if (event.target === dom.fullscreenOverlay) close();
  }

  function handleContentClick(event: MouseEvent) {
    const annotated = (event.target as Element).closest('mark.annotated, .math-node.annotated-math, .katex.annotated-math') as HTMLElement | null;
    const targetId = annotated?.dataset.refId;
    if (targetId) canvasWorkspace.focusNode(targetId);
  }

  return {
    open,
    close,
    handleOverlayMouseDown,
    handleContentClick,
  };
}
