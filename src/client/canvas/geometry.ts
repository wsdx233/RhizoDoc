import { clamp } from '../utils.js';
import { NODE_FALLBACK_HEIGHT, NODE_WIDTH } from './constants.js';

export function screenToCanvasPoint(clientX: number, clientY: number, viewport: HTMLElement, canvasState: any) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: (clientX - rect.left - canvasState.x) / canvasState.scale,
    y: (clientY - rect.top - canvasState.y) / canvasState.scale,
  };
}

export function getCanvasNodeSize(node: any, element: HTMLElement | null | undefined = document.getElementById(node?.id)) {
  return {
    width: element?.offsetWidth || node?.width || NODE_WIDTH,
    height: element?.offsetHeight || NODE_FALLBACK_HEIGHT,
  };
}

export function getCanvasNodeRect(node: any, size = getCanvasNodeSize(node)) {
  return { x: node.x, y: node.y, width: size.width, height: size.height };
}

export function rectsIntersect(a: any, b: any) {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function getCanvasGraphBounds(nodes: any[], padding = 0, getNodeSize = getCanvasNodeSize) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const size = getNodeSize(node);
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + size.width);
    maxY = Math.max(maxY, node.y + size.height);
  }
  return { minX: minX - padding, minY: minY - padding, maxX: maxX + padding, maxY: maxY + padding };
}

export function getVisibleCanvasBounds(canvasState: any, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
  const scale = canvasState.scale || 1;
  return {
    minX: -canvasState.x / scale,
    minY: -canvasState.y / scale,
    maxX: (viewportWidth - canvasState.x) / scale,
    maxY: (viewportHeight - canvasState.y) / scale,
  };
}

export function findSmartCanvasChildPosition(nodes: any[], parent: any, options: any = {}) {
  const targetWidth = options.targetWidth || NODE_WIDTH;
  const targetHeight = options.targetHeight || NODE_FALLBACK_HEIGHT;
  const parentSize = options.getNodeSize?.(parent) || getCanvasNodeSize(parent);
  const viewport = options.viewport || getVisibleCanvasBounds(options.canvas || { x: 0, y: 0, scale: 1 });
  const gap = options.gap || 82;
  const leftSpace = parent.x - viewport.minX;
  const rightSpace = viewport.maxX - (parent.x + parentSize.width);
  const getNodeSize = options.getNodeSize || getCanvasNodeSize;

  const candidates = ['right', 'left']
    .map((dir) => findSideSlot(nodes, parent, parentSize, dir, targetWidth, targetHeight, gap, viewport, dir === 'right' ? rightSpace : leftSpace, getNodeSize))
    .filter(Boolean)
    .sort((a: any, b: any) => b.score - a.score);

  if (candidates.length > 0) return candidates[0];
  const fallbackDir = leftSpace > rightSpace ? 'left' : 'right';
  const fallbackX = fallbackDir === 'left' ? parent.x - targetWidth - gap : parent.x + parentSize.width + gap;
  const fallback = findSafeCanvasPosition(nodes, fallbackX, parent.y, targetWidth, targetHeight, getNodeSize);
  return { ...fallback, dir: fallbackDir };
}

function findSideSlot(nodes: any[], parent: any, parentSize: any, dir: string, targetWidth: number, targetHeight: number, gap: number, viewport: any, sideSpace: number, getNodeSize: (node: any) => any) {
  const baseX = dir === 'right' ? parent.x + parentSize.width + gap : parent.x - targetWidth - gap;
  const offsets = [0, 210, -210, 420, -420, 630, -630, 840, -840, 1050];
  const visibleBonus = baseX + targetWidth > viewport.minX + 32 && baseX < viewport.maxX - 32 ? 220 : -80;
  const sideBias = dir === 'right' ? 28 : 0;

  for (const offset of offsets) {
    const y = parent.y + offset;
    if (!isSafeCanvasBox(nodes, baseX, y, targetWidth, targetHeight, 28, getNodeSize)) continue;
    return {
      x: baseX,
      y,
      dir,
      score: sideSpace + visibleBonus + sideBias - Math.abs(offset) * 0.72,
    };
  }
  return null;
}

export function findSafeCanvasPosition(nodes: any[], startX: number, startY: number, width = NODE_WIDTH, height = NODE_FALLBACK_HEIGHT, getNodeSize = getCanvasNodeSize) {
  let x = startX;
  let y = startY;
  let attempts = 0;
  while (attempts < 90) {
    if (isSafeCanvasBox(nodes, x, y, width, height, 28, getNodeSize)) return { x, y };
    y += 230;
    attempts += 1;
    if (attempts % 6 === 0) {
      x += width + 70;
      y = startY + ((attempts / 6) % 2) * 120;
    }
  }
  return { x: startX + Math.random() * 120, y: startY + Math.random() * 120 };
}

export function isSafeCanvasBox(nodes: any[], x: number, y: number, width: number, height: number, margin = 28, getNodeSize = getCanvasNodeSize) {
  return !nodes.some((node) => {
    const size = getNodeSize(node);
    return x < node.x + size.width + margin && x + width + margin > node.x && y < node.y + size.height + margin && y + height + margin > node.y;
  });
}

export function fitCanvasToBounds(canvasState: any, bounds: any, viewportWidth = window.innerWidth, viewportHeight = window.innerHeight) {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const availableW = Math.max(360, viewportWidth - 120);
  const availableH = Math.max(260, viewportHeight - 160);
  const scale = Math.min(availableW / width, availableH / height, 1.45);
  return {
    scale: clamp(scale, 0.18, 3),
    x: viewportWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * clamp(scale, 0.18, 3),
    y: viewportHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * clamp(scale, 0.18, 3) + 24,
  };
}
