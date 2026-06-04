type TiledTailScrollControllerOptions = {
  ensurePageState: (nodeId: string) => any;
};

export function createTiledTailScrollController(options: TiledTailScrollControllerOptions) {
  const { ensurePageState } = options;
  const tailStateByNodeId = new Map();

  function captureContentScrollState(contentEl: HTMLElement, nodeId: string) {
    const tailState = ensureTailState(nodeId, contentEl);
    return {
      nodeId,
      scrollTop: contentEl.scrollTop,
      followTail: tailState.followTail,
    };
  }

  function restoreContentScroll(contentEl: HTMLElement, pageState, scrollState) {
    const restore = () => {
      if (scrollState.followTail) {
        scrollToContentBottom(contentEl);
      } else {
        contentEl.scrollTop = scrollState.scrollTop;
      }
      pageState.scrollTop = contentEl.scrollTop;
      updateTailState(scrollState.nodeId, contentEl);
    };
    restore();
    queueMicrotask(restore);
    requestAnimationFrame(restore);
  }

  function attachScrollIntent(nodeId: string, contentEl: HTMLElement) {
    const tailState = ensureTailState(nodeId, contentEl);
    if (tailState.contentEl === contentEl && tailState.attached) return tailState;

    tailState.intersectionObserver?.disconnect();
    tailState.resizeObserver?.disconnect();
    tailState.contentEl = contentEl;
    tailState.attached = true;
    tailState.followTail = isNearContentBottom(contentEl);

    const sentinel = contentEl.querySelector('.tiled-bottom-sentinel');
    if (sentinel && 'IntersectionObserver' in window) {
      tailState.intersectionObserver = new IntersectionObserver((entries) => {
        tailState.followTail = entries.some((entry) => entry.isIntersecting) || isNearContentBottom(contentEl);
      }, { root: contentEl, threshold: 1 });
      tailState.intersectionObserver.observe(sentinel);
    }

    if ('ResizeObserver' in window) {
      tailState.resizeObserver = new ResizeObserver(() => {
        if (!tailState.followTail) return;
        scrollToContentBottom(contentEl);
        ensurePageState(nodeId).scrollTop = contentEl.scrollTop;
      });
      const host = contentEl.querySelector('.tiled-markdown-host') || contentEl;
      tailState.resizeObserver.observe(host);
      tailState.resizeObserver.observe(contentEl);
    }
    return tailState;
  }

  function disconnect(nodeId: string) {
    const tailState = tailStateByNodeId.get(nodeId);
    if (!tailState) return;
    tailState.intersectionObserver?.disconnect();
    tailState.resizeObserver?.disconnect();
    tailState.attached = false;
    tailState.contentEl = null;
  }

  function disconnectAll() {
    tailStateByNodeId.forEach((_, id) => disconnect(id));
  }

  function ensureTailState(nodeId: string, contentEl: HTMLElement | null = null) {
    let tailState = tailStateByNodeId.get(nodeId);
    if (!tailState) {
      tailState = { followTail: contentEl ? isNearContentBottom(contentEl) : true };
      tailStateByNodeId.set(nodeId, tailState);
    }
    return tailState;
  }

  function updateTailState(nodeId: string, contentEl: HTMLElement) {
    const tailState = ensureTailState(nodeId, contentEl);
    tailState.followTail = isNearContentBottom(contentEl);
    return tailState;
  }

  function isNearContentBottom(contentEl: HTMLElement) {
    return contentEl.scrollHeight - contentEl.clientHeight - contentEl.scrollTop <= 32;
  }

  function scrollToContentBottom(contentEl: HTMLElement) {
    contentEl.scrollTop = Math.max(0, contentEl.scrollHeight - contentEl.clientHeight);
  }

  return {
    captureContentScrollState,
    restoreContentScroll,
    attachScrollIntent,
    disconnect,
    disconnectAll,
    updateTailState,
  };
}
