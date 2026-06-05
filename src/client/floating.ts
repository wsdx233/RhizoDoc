import { autoUpdate, computePosition, flip, inline, offset, shift, type ClientRectObject, type VirtualElement } from '@floating-ui/dom';

type PositionOptions = {
  contextElement?: Element | null;
  padding?: number;
};

const EMPTY_RECT: ClientRectObject = { x: 0, y: 0, width: 0, height: 0, top: 0, right: 0, bottom: 0, left: 0 };

function rectToClientRectObject(rect: DOMRect | ClientRect): ClientRectObject {
  const maybeDomRect = rect as DOMRect;
  return {
    x: Number.isFinite(maybeDomRect.x) ? maybeDomRect.x : rect.left,
    y: Number.isFinite(maybeDomRect.y) ? maybeDomRect.y : rect.top,
    width: rect.width,
    height: rect.height,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function unionClientRects(rects: ClientRectObject[]): ClientRectObject {
  if (rects.length === 0) return EMPTY_RECT;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { x: left, y: top, width: right - left, height: bottom - top, top, right, bottom, left };
}

function collectElementClientRects(elements: Element[]): ClientRectObject[] {
  return elements
    .flatMap((element) => Array.from(element.getClientRects()).map(rectToClientRectObject))
    .filter((rect) => rect.width > 0 || rect.height > 0);
}

export function createPointVirtualElement(clientX: number, clientY: number, contextElement?: Element | null): VirtualElement {
  const rect: ClientRectObject = { x: clientX, y: clientY, width: 0, height: 0, top: clientY, right: clientX, bottom: clientY, left: clientX };
  return {
    getBoundingClientRect: () => rect,
    contextElement: contextElement || undefined,
  };
}

export function createRangeVirtualElement(range: Range, contextElement?: Element | null): VirtualElement {
  return {
    getBoundingClientRect: () => rectToClientRectObject(range.getBoundingClientRect()),
    getClientRects: () => Array.from(range.getClientRects()).map(rectToClientRectObject),
    contextElement: contextElement || undefined,
  };
}

export function createElementListVirtualElement(getElements: () => Element[], contextElement?: Element | null): VirtualElement {
  const getClientRects = () => collectElementClientRects(getElements());
  return {
    getBoundingClientRect: () => unionClientRects(getClientRects()),
    getClientRects,
    contextElement: contextElement || undefined,
  };
}

async function updateSelectionTooltipPosition(tooltip: HTMLElement, reference: VirtualElement, active: () => boolean) {
  const { x, y } = await computePosition(reference, tooltip, {
    placement: 'top',
    strategy: 'fixed',
    middleware: [
      inline(),
      offset(12),
      flip({ padding: { top: 76, right: 8, bottom: 8, left: 8 } }),
      shift({ padding: { top: 76, right: 8, bottom: 8, left: 8 } }),
    ],
  });
  if (!active()) return;

  const tooltipWidth = tooltip.getBoundingClientRect().width;
  Object.assign(tooltip.style, {
    position: 'fixed',
    left: `${x + tooltipWidth / 2}px`,
    top: `${y}px`,
    transform: 'translateX(-50%)',
  });
}

async function updateContextMenuPosition(menu: HTMLElement, reference: VirtualElement, padding: number, active: () => boolean) {
  const { x, y } = await computePosition(reference, menu, {
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [
      offset(4),
      flip({ padding }),
      shift({ padding }),
    ],
  });
  if (!active()) return;

  Object.assign(menu.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
    transform: '',
  });
}

export function startSelectionTooltipAutoUpdate(tooltip: HTMLElement, reference: VirtualElement): () => void {
  let active = true;
  const isActive = () => active && tooltip.isConnected && tooltip.style.display !== 'none';
  const update = () => { void updateSelectionTooltipPosition(tooltip, reference, isActive); };
  const cleanupAutoUpdate = autoUpdate(reference, tooltip, update);
  return () => {
    active = false;
    cleanupAutoUpdate();
  };
}

export function startRangeSelectionTooltipAutoUpdate(tooltip: HTMLElement, range: Range, options: PositionOptions = {}): () => void {
  return startSelectionTooltipAutoUpdate(tooltip, createRangeVirtualElement(range, options.contextElement));
}

export function startElementListSelectionTooltipAutoUpdate(tooltip: HTMLElement, getElements: () => Element[], options: PositionOptions = {}): () => void {
  return startSelectionTooltipAutoUpdate(tooltip, createElementListVirtualElement(getElements, options.contextElement));
}

export function startContextMenuAutoUpdate(menu: HTMLElement, clientX: number, clientY: number, options: PositionOptions = {}): () => void {
  let active = true;
  const padding = options.padding ?? 8;
  const reference = createPointVirtualElement(clientX, clientY, options.contextElement);
  const isActive = () => active && menu.isConnected && menu.style.display !== 'none';
  const update = () => { void updateContextMenuPosition(menu, reference, padding, isActive); };
  const cleanupAutoUpdate = autoUpdate(reference, menu, update);
  return () => {
    active = false;
    cleanupAutoUpdate();
  };
}
