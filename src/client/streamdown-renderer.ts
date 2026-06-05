type StreamdownRenderOptions = {
  streaming?: boolean;
};

type StreamdownIslandModule = typeof import('./streamdown-island.js');

let islandPromise: Promise<StreamdownIslandModule> | null = null;
let islandModule: StreamdownIslandModule | null = null;

export async function renderStreamdownMarkdown(container: HTMLElement, markdown: string, options: StreamdownRenderOptions = {}) {
  const island = await loadStreamdownIsland();
  await island.renderStreamdownIsland(container, markdown, options);
}

export function unmountStreamdownMarkdown(container: HTMLElement | null | undefined) {
  islandModule?.unmountStreamdownIsland(container);
}

async function loadStreamdownIsland(): Promise<StreamdownIslandModule> {
  islandPromise ||= import('./streamdown-island.js').then((module) => {
    islandModule = module;
    return module;
  });
  return islandPromise;
}
