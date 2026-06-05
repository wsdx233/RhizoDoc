import { cssAttr } from '../utils.js';

type TiledRelationsControllerOptions = {
  root: HTMLElement;
  state: any;
  ensureWorkspace: () => any;
};

export function createTiledRelationsController(options: TiledRelationsControllerOptions) {
  const { root, state, ensureWorkspace } = options;
  let relationAnimationFrame = 0;

  function animate(duration = 320) {
    if (relationAnimationFrame) cancelAnimationFrame(relationAnimationFrame);
    const start = performance.now();
    const tick = () => {
      draw();
      if (performance.now() - start < duration) {
        relationAnimationFrame = requestAnimationFrame(tick);
      } else {
        relationAnimationFrame = 0;
      }
    };
    relationAnimationFrame = requestAnimationFrame(tick);
  }

  function draw() {
    const layer = root.querySelector('.tiled-relations-layer') as SVGSVGElement | null;
    if (!layer || state.activeView !== 'tiled') return;
    layer.innerHTML = '';
    const field = layer.closest('.tiled-field') as HTMLElement | null;
    const width = Math.max(field?.scrollWidth || 0, field?.offsetWidth || 0, root.clientWidth);
    const height = Math.max(field?.scrollHeight || 0, field?.offsetHeight || 0, root.clientHeight);
    layer.setAttribute('width', String(width));
    layer.setAttribute('height', String(height));
    layer.setAttribute('viewBox', `0 0 ${width} ${height}`);

    root.querySelectorAll('.tiled-section.related, .tiled-section.annotation-related').forEach((section) => {
      section.classList.remove('related', 'annotation-related');
    });

    const workspace = ensureWorkspace();
    const focusedId = workspace.focus?.nodeId || '';
    const annotationRelations = state.annotations.map((annotation) => ({
      annotationId: annotation.id,
      sourceId: annotation.sourceNodeId,
      targetId: annotation.targetNodeId,
      type: 'annotation',
      color: `var(--hl-${((Number(annotation.colorIndex) || 0) % 5 + 5) % 5}-fg)`,
    }));

    for (const relation of annotationRelations) {
      if (!relation.annotationId || !relation.sourceId || !relation.targetId || relation.sourceId === relation.targetId) continue;
      const source = getSectionAnchor(relation.sourceId, relation.targetId, relation.annotationId);
      const target = getSectionAnchor(relation.targetId);
      if (!source || !target) continue;
      const active = focusedId && (relation.sourceId === focusedId || relation.targetId === focusedId);
      appendRelationPath(layer, source, target, relation.type, relation.color, Boolean(active));
      if (active) {
        source.section.classList.add(relation.type === 'annotation' ? 'annotation-related' : 'related');
        target.section.classList.add(relation.type === 'annotation' ? 'annotation-related' : 'related');
      }
    }
  }

  function getSectionAnchor(nodeId, targetId = '', annotationId = '') {
    const section = root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`) as HTMLElement | null;
    if (!section || !isSectionVisibleInWorkspace(section)) return null;
    const field = section.closest('.tiled-field') as HTMLElement | null;
    const fieldRect = (field || root).getBoundingClientRect();
    const anchorElement = findRelationAnchorElement(section, annotationId, targetId);
    if (annotationId && !anchorElement) return null;
    const rect = getRelationAnchorRect(section, anchorElement);
    if (!rect) return null;
    return {
      x: rect.left - fieldRect.left + (field?.scrollLeft || 0) + rect.width / 2,
      y: rect.top - fieldRect.top + (field?.scrollTop || 0) + rect.height / 2,
      section,
    };
  }

  function findRelationAnchorElement(section: HTMLElement, annotationId = '', targetId = '') {
    if (annotationId) {
      return section.querySelector(`[data-annotation-id="${cssAttr(annotationId)}"]`) as HTMLElement | null;
    }
    return targetId
      ? section.querySelector(`[data-ref-id="${cssAttr(targetId)}"]`) as HTMLElement | null
      : null;
  }

  function isSectionVisibleInWorkspace(section: HTMLElement) {
    const rect = section.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    return rect.right > rootRect.left
      && rect.left < rootRect.right
      && rect.bottom > rootRect.top
      && rect.top < rootRect.bottom;
  }

  function getRelationAnchorRect(section: HTMLElement, anchorElement: HTMLElement | null) {
    const sectionRect = section.getBoundingClientRect();
    if (!anchorElement) return sectionRect;

    const anchorRect = anchorElement.getBoundingClientRect();
    const content = anchorElement.closest('.tiled-content') as HTMLElement | null;
    const contentRect = content?.getBoundingClientRect();
    if (!contentRect) return anchorRect;

    const visibleLeft = Math.max(anchorRect.left, contentRect.left, sectionRect.left);
    const visibleRight = Math.min(anchorRect.right, contentRect.right, sectionRect.right);
    const visibleTop = Math.max(anchorRect.top, contentRect.top, sectionRect.top);
    const visibleBottom = Math.min(anchorRect.bottom, contentRect.bottom, sectionRect.bottom);
    if (visibleRight > visibleLeft + 1 && visibleBottom > visibleTop + 1) {
      return rectLike(visibleLeft, visibleTop, visibleRight - visibleLeft, visibleBottom - visibleTop);
    }

    return null;
  }

  function rectLike(left: number, top: number, width: number, height: number) {
    return { left, top, width, height };
  }

  function appendRelationPath(layer, source, target, type, color, active) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    const dx = Math.max(80, Math.abs(target.x - source.x) * 0.45);
    const c1x = source.x + (target.x >= source.x ? dx : -dx);
    const c2x = target.x - (target.x >= source.x ? dx : -dx);
    path.setAttribute('d', `M ${source.x} ${source.y} C ${c1x} ${source.y}, ${c2x} ${target.y}, ${target.x} ${target.y}`);
    path.setAttribute('class', `tiled-relation ${type}${active ? ' active' : ''}`);
    path.setAttribute('stroke', color);
    layer.appendChild(path);
  }

  return {
    animate,
    draw,
  };
}
