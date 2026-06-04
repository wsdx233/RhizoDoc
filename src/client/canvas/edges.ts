import { EDGE_SVG_OFFSET } from './constants.js';

export function drawCanvasEdges(options: { edgesLayer: SVGSVGElement; nodes: any[]; edges: any[]; getNodeSize: (node: any) => any }) {
  const { edgesLayer, nodes, edges, getNodeSize } = options;
  refreshCanvasNodeDirections(nodes, getNodeSize);
  edgesLayer.innerHTML = '';
  edgesLayer.style.width = '16000px';
  edgesLayer.style.height = '16000px';
  edgesLayer.style.transform = `translate(-${EDGE_SVG_OFFSET}px, -${EDGE_SVG_OFFSET}px)`;

  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  defs.innerHTML = [
    '<marker id="arrow-default" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--md-sys-color-outline)"/></marker>',
    ...Array.from({ length: 5 }, (_, index) => `<marker id="arrow-${index}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--hl-${index}-fg)"/></marker>`),
  ].join('');
  edgesLayer.appendChild(defs);

  for (const edge of edges) {
    const sourceEl = document.getElementById(edge.sourceId);
    const targetEl = document.getElementById(edge.targetId);
    const target = nodes.find((node) => node.id === edge.targetId);
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
    edgesLayer.appendChild(path);
  }
}

export function refreshCanvasNodeDirections(nodes: any[], getNodeSize: (node: any) => any) {
  for (const node of nodes) updateCanvasNodeDirection(nodes, node.id, getNodeSize);
}

export function updateCanvasNodeDirection(nodes: any[], id: string, getNodeSize: (node: any) => any) {
  const node = nodes.find((item) => item.id === id);
  if (!node || !node.parentId) return;
  const parent = nodes.find((item) => item.id === node.parentId);
  if (!parent) return;
  const nodeSize = getNodeSize(node);
  const parentSize = getNodeSize(parent);
  const childCenter = node.x + nodeSize.width / 2;
  const parentCenter = parent.x + parentSize.width / 2;
  node.dir = childCenter < parentCenter ? 'left' : 'right';
  document.getElementById(node.id)?.setAttribute('data-dir', node.dir);
}
