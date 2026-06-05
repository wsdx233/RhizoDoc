import { projectTiledColumns } from '../../shared/workspace.js';
import type { TiledLayoutRefreshRequest } from './transition-policy.js';
import { cssAttr } from '../utils.js';

type TiledNavigationControllerOptions = {
  root: HTMLElement;
  state: any;
  getNode: (id: string) => any;
  ensureWorkspace: () => any;
  refreshLayoutPositions: (request?: TiledLayoutRefreshRequest) => void;
  runFocusedAction: (action: string) => void;
  isEditableTarget: (target: EventTarget | null) => boolean;
};

export function createTiledNavigationController(options: TiledNavigationControllerOptions) {
  const {
    root,
    state,
    getNode,
    ensureWorkspace,
    refreshLayoutPositions,
    runFocusedAction,
    isEditableTarget,
  } = options;

  function handleKeydown(event: KeyboardEvent) {
    if (isEditableTarget(event.target)) return false;
    const key = event.key;
    const handledKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' ', '[', ']']);
    if (!handledKeys.has(key)) return false;

    if (event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
      swapFocusedPanel(key);
    } else if (key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown') {
      moveFocus(key);
    } else if (key === ' ') {
      runFocusedAction('section-title-toggle');
    } else if (key === '[') {
      runFocusedAction('section-shorter');
    } else if (key === ']') {
      runFocusedAction('section-taller');
    }
    event.preventDefault();
    return true;
  }

  function moveFocus(key: string) {
    const workspace = ensureWorkspace();
    const columns = workspace.columns || [];
    if (columns.length === 0) return;
    const currentNodeId = workspace.focus?.nodeId;
    let columnIndex = Math.max(0, columns.findIndex((column) => column.pageIds.includes(currentNodeId)));
    if (columnIndex < 0) columnIndex = 0;
    let pageIndex = Math.max(0, columns[columnIndex].pageIds.indexOf(currentNodeId));

    let nextNodeId = '';
    if (key === 'ArrowLeft') {
      nextNodeId = getPrimaryParentNodeId(currentNodeId || columns[columnIndex].pageIds[pageIndex]);
    } else if (key === 'ArrowRight') {
      nextNodeId = getPrimaryChildNodeId(currentNodeId || columns[columnIndex].pageIds[pageIndex]);
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      nextNodeId = getNearestVerticalNodeId(currentNodeId || columns[columnIndex].pageIds[pageIndex], key);
      if (!nextNodeId) {
        pageIndex = key === 'ArrowUp'
          ? Math.max(0, pageIndex - 1)
          : Math.min(columns[columnIndex].pageIds.length - 1, pageIndex + 1);
      }
    }

    if (!nextNodeId) nextNodeId = columns[columnIndex].pageIds[Math.max(0, pageIndex)];
    if (!nextNodeId) return;
    const nextColumn = columns.find((column) => column.pageIds.includes(nextNodeId)) || columns[columnIndex];
    workspace.focus = { workspaceId: workspace.id, region: 'columns', columnId: nextColumn.id, nodeId: nextNodeId };
    workspace.updatedAt = new Date().toISOString();
    const horizontalNavigation = key === 'ArrowLeft' || key === 'ArrowRight';
    if (horizontalNavigation) {
      refreshLayoutPositions({ reason: 'focus-keyboard-horizontal' });
      requestAnimationFrame(() => scrollNodeIntoHorizontalView(nextNodeId));
    } else {
      refreshLayoutPositions({ reason: 'focus-keyboard-vertical' });
      requestAnimationFrame(() => {
        root.querySelector(`[data-node-id="${cssAttr(nextNodeId)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      });
    }
  }

  function scrollNodeIntoHorizontalView(nodeId: string) {
    const section = root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`) as HTMLElement | null;
    if (!section) return;
    const sectionRect = section.getBoundingClientRect();
    const rootRect = root.getBoundingClientRect();
    const margin = 24;
    if (sectionRect.left < rootRect.left + margin) {
      root.scrollLeft -= rootRect.left + margin - sectionRect.left;
    } else if (sectionRect.right > rootRect.right - margin) {
      root.scrollLeft += sectionRect.right - rootRect.right + margin;
    }
  }

  function getNearestVerticalNodeId(nodeId: string, key: string) {
    if (!nodeId) return '';
    const workspace = ensureWorkspace();
    const projection = projectTiledColumns(state.nodes, state.edges, workspace, state.annotations || []);
    const current = projection.pageLayouts[nodeId];
    if (!current) return '';
    const candidates = Object.values(projection.pageLayouts)
      .filter((item: any) => item.nodeId !== nodeId && item.depth === current.depth)
      .filter((item: any) => key === 'ArrowUp' ? item.order < current.order : item.order > current.order)
      .sort((a: any, b: any) => key === 'ArrowUp' ? b.order - a.order : a.order - b.order);
    return (candidates[0] as any)?.nodeId || '';
  }

  function swapFocusedPanel(key: string) {
    const workspace = ensureWorkspace();
    const projection = projectTiledColumns(state.nodes, state.edges, workspace, state.annotations || []);
    workspace.columns = projection.columns;
    const nodeId = workspace.focus?.nodeId || workspace.columns[0]?.pageIds[0];
    if (!nodeId) return;
    const column = workspace.columns.find((item) => item.pageIds.includes(nodeId));
    const index = column?.pageIds.indexOf(nodeId) ?? -1;
    const swapIndex = key === 'ArrowUp' ? index - 1 : index + 1;
    if (!column || index < 0 || swapIndex < 0 || swapIndex >= column.pageIds.length) return;
    [column.pageIds[index], column.pageIds[swapIndex]] = [column.pageIds[swapIndex], column.pageIds[index]];
    workspace.focus = { workspaceId: workspace.id, region: 'columns', columnId: column.id, nodeId };
    workspace.updatedAt = new Date().toISOString();
    refreshLayoutPositions({ reason: 'focus-keyboard-vertical' });
    requestAnimationFrame(() => {
      root.querySelector(`[data-node-id="${cssAttr(nodeId)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  function getPrimaryParentNodeId(nodeId: string) {
    if (!nodeId) return '';
    const incomingEdge = state.edges.find((edge) => edge.targetId === nodeId);
    if (incomingEdge?.sourceId && getNode(incomingEdge.sourceId)) return incomingEdge.sourceId;
    const node = getNode(nodeId);
    return node?.parentId && getNode(node.parentId) ? node.parentId : '';
  }

  function getPrimaryChildNodeId(nodeId: string) {
    if (!nodeId) return '';
    const outgoingEdge = state.edges.find((edge) => edge.sourceId === nodeId);
    if (outgoingEdge?.targetId && getNode(outgoingEdge.targetId)) return outgoingEdge.targetId;
    const child = state.nodes.find((node) => node.parentId === nodeId);
    return child?.id || '';
  }

  return {
    handleKeydown,
  };
}
