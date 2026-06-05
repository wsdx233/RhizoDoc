import { computePosition, flip, inline, offset, shift, type ClientRectObject, type VirtualElement } from '@floating-ui/dom';

type PositionOptions = {
  contextElement?: Element | null;
  padding?: number;
};

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

export async function positionSelectionTooltip(tooltip: HTMLElement, range: Range, options: PositionOptions = {}) {
  const reference = createRangeVirtualElement(range, options.contextElement);
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

  const tooltipWidth = tooltip.getBoundingClientRect().width;
  Object.assign(tooltip.style, {
    position: 'fixed',
    left: `${x + tooltipWidth / 2}px`,
    top: `${y}px`,
    transform: 'translateX(-50%)',
  });
}

export async function positionContextMenu(menu: HTMLElement, clientX: number, clientY: number, options: PositionOptions = {}) {
  const reference = createPointVirtualElement(clientX, clientY, options.contextElement);
  const { x, y } = await computePosition(reference, menu, {
    placement: 'bottom-start',
    strategy: 'fixed',
    middleware: [
      offset(4),
      flip({ padding: options.padding ?? 8 }),
      shift({ padding: options.padding ?? 8 }),
    ],
  });

  Object.assign(menu.style, {
    position: 'fixed',
    left: `${x}px`,
    top: `${y}px`,
  });
}
