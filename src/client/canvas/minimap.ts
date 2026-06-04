import { clamp } from '../utils.js';

export function updateCanvasMinimap(options: {
  minimap: HTMLElement;
  minimapContent: HTMLElement;
  minimapViewport: HTMLElement;
  nodes: any[];
  canvas: any;
  getGraphBounds: (padding?: number) => any;
  getNodeSize: (node: any) => any;
}) {
  const { minimap, minimapContent, minimapViewport, nodes, canvas, getGraphBounds, getNodeSize } = options;
  minimapContent.innerHTML = '';
  if (nodes.length === 0) {
    minimapViewport.style.display = 'none';
    return null;
  }
  minimapViewport.style.display = 'block';

  const mapW = minimap.clientWidth || 170;
  const mapH = minimap.clientHeight || 126;
  const bounds = getGraphBounds(500);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const mapScale = Math.min(mapW / width, mapH / height);
  const minimapBounds = { ...bounds, mapScale, mapW, mapH };

  for (const node of nodes) {
    const size = getNodeSize(node);
    const div = document.createElement('div');
    div.className = 'minimap-node';
    if (node.colorIndex >= 0) div.style.backgroundColor = `var(--hl-${node.colorIndex % 5}-bg)`;
    div.style.left = `${(node.x - bounds.minX) * mapScale}px`;
    div.style.top = `${(node.y - bounds.minY) * mapScale}px`;
    div.style.width = `${Math.max(3, size.width * mapScale)}px`;
    div.style.height = `${Math.max(3, size.height * mapScale)}px`;
    minimapContent.appendChild(div);
  }

  const vpX = (-canvas.x / canvas.scale - bounds.minX) * mapScale;
  const vpY = (-canvas.y / canvas.scale - bounds.minY) * mapScale;
  minimapViewport.style.left = `${vpX}px`;
  minimapViewport.style.top = `${vpY}px`;
  minimapViewport.style.width = `${(window.innerWidth / canvas.scale) * mapScale}px`;
  minimapViewport.style.height = `${(window.innerHeight / canvas.scale) * mapScale}px`;
  return minimapBounds;
}

export function centerCanvasFromMinimapPointer(options: {
  event: MouseEvent;
  minimap: HTMLElement;
  minimapBounds: any;
  canvas: any;
  viewportWidth?: number;
  viewportHeight?: number;
}) {
  const { event, minimap, minimapBounds, canvas } = options;
  if (!minimapBounds) return canvas;
  const rect = minimap.getBoundingClientRect();
  const { minX, minY, mapScale, mapW, mapH } = minimapBounds;
  const localX = clamp(event.clientX - rect.left, 0, mapW);
  const localY = clamp(event.clientY - rect.top, 0, mapH);
  const worldX = minX + localX / mapScale;
  const worldY = minY + localY / mapScale;
  return {
    ...canvas,
    x: (options.viewportWidth ?? window.innerWidth) / 2 - worldX * canvas.scale,
    y: (options.viewportHeight ?? window.innerHeight) / 2 - worldY * canvas.scale,
  };
}
