export type RhizoDomRefs = {
  viewport: HTMLElement;
  canvas: HTMLElement;
  nodesLayer: HTMLElement;
  edgesLayer: SVGSVGElement;
  tiledWorkspace: HTMLElement;
  topbar: HTMLElement;
  flowName: HTMLElement;
  apiStatus: HTMLElement;
  tooltip: HTMLElement;
  tooltipView: HTMLElement;
  promptInput: HTMLInputElement;
  nodeMenu: HTMLElement;
  canvasMenu: HTMLElement;
  minimap: HTMLElement;
  minimapContent: HTMLElement;
  minimapViewport: HTMLElement;
  toast: HTMLElement;
  progressStack: HTMLElement;
  fullscreenOverlay: HTMLElement;
  fsTitle: HTMLElement;
  fsContent: HTMLElement;
  selectionBox: HTMLElement;
  viewCanvasButton: HTMLButtonElement;
  viewTiledButton: HTMLButtonElement;
  themePalette: HTMLSelectElement;
  themeMode: HTMLSelectElement;
  themeCurrent: HTMLElement;

  initialFileInput: HTMLInputElement;
  docFileInput: HTMLInputElement;
  flowFileInput: HTMLInputElement;
  welcomeModal: HTMLElement;
  initialTitle: HTMLInputElement;
  initialContent: HTMLTextAreaElement;
  initialGeneratePrompt: HTMLTextAreaElement;
  initialGenerateButton: HTMLButtonElement;

  llmModal: HTMLElement;
  llmModalTitle: HTMLElement;
  llmContext: HTMLElement;
  llmPrompt: HTMLTextAreaElement;

  flowsModal: HTMLElement;
  serverFlowList: HTMLElement;
};

export function collectDomRefs(): RhizoDomRefs {
  return {
    viewport: byId('viewport'),
    canvas: byId('canvas'),
    nodesLayer: byId('nodes-layer'),
    edgesLayer: byId('edges-layer'),
    tiledWorkspace: byId('tiled-workspace'),
    topbar: byId('topbar'),
    flowName: byId('flow-name'),
    apiStatus: byId('api-status'),
    tooltip: byId('action-tooltip'),
    tooltipView: query('#action-tooltip .tooltip-view'),
    promptInput: byId('ai-prompt'),
    nodeMenu: byId('node-context-menu'),
    canvasMenu: byId('canvas-context-menu'),
    minimap: byId('minimap'),
    minimapContent: byId('minimap-content'),
    minimapViewport: byId('minimap-viewport'),
    toast: byId('toast'),
    progressStack: byId('progress-stack'),
    fullscreenOverlay: byId('fullscreen-overlay'),
    fsTitle: byId('fs-title'),
    fsContent: byId('fs-content'),
    selectionBox: byId('selection-box'),
    viewCanvasButton: byId('btn-view-canvas'),
    viewTiledButton: byId('btn-view-tiled'),
    themePalette: byId('theme-palette'),
    themeMode: byId('theme-mode'),
    themeCurrent: byId('theme-current'),

    initialFileInput: byId('initial-file-input'),
    docFileInput: byId('doc-file-input'),
    flowFileInput: byId('flow-file-input'),
    welcomeModal: byId('welcome-modal'),
    initialTitle: byId('initial-title'),
    initialContent: byId('initial-content'),
    initialGeneratePrompt: byId('initial-generate-prompt'),
    initialGenerateButton: byId('btn-generate-initial'),

    llmModal: byId('llm-modal'),
    llmModalTitle: byId('llm-modal-title'),
    llmContext: byId('llm-context'),
    llmPrompt: byId('llm-prompt'),

    flowsModal: byId('flows-modal'),
    serverFlowList: byId('server-flow-list'),
  };
}

export function byId<T extends Element = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing DOM element: #${id}`);
  return element as unknown as T;
}

export function query<T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing DOM element: ${selector}`);
  return element as T;
}
