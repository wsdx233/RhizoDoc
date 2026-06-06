import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createCodePlugin, type ThemeInput } from '@streamdown/code';
import { math as mathPlugin } from '@streamdown/math';
import { Streamdown } from 'streamdown';
import { THEME_CHANGE_EVENT, getCodeThemesForCurrentPalette } from './theme.js';
import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';

type StreamdownRenderOptions = {
  streaming?: boolean;
};

const roots = new WeakMap<HTMLElement, Root>();
const mountedContainers = new Set<HTMLElement>();
const lastRenders = new WeakMap<HTMLElement, { markdown: string; streaming: boolean }>();
const codePlugins = new Map<string, ReturnType<typeof createCodePlugin>>();
const streamdownPlugins = new Map<string, { code: ReturnType<typeof createCodePlugin>; math: typeof mathPlugin }>();
const streamdownLinkSafety = { enabled: false };

export async function renderStreamdownIsland(container: HTMLElement, markdown: string, { streaming = true }: StreamdownRenderOptions = {}) {
  let root = roots.get(container);
  if (!root) {
    container.textContent = '';
    root = createRoot(container);
    roots.set(container, root);
  }

  mountedContainers.add(container);
  lastRenders.set(container, { markdown, streaming });
  const codeThemes = [...getCodeThemesForCurrentPalette()] as [ThemeInput, ThemeInput];

  const element = React.createElement(Streamdown, {
    animated: false,
    className: 'rhizodoc-streamdown',
    controls: false,
    isAnimating: streaming,
    lineNumbers: false,
    linkSafety: streamdownLinkSafety,
    mode: 'streaming',
    parseIncompleteMarkdown: true,
    plugins: getStreamdownPlugins(codeThemes),
    shikiTheme: codeThemes,
    children: markdown,
  });

  if (streaming) root.render(element);
  else flushSync(() => root.render(element));
  await nextFrame();
}

function nextFrame() {
  return new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

export function unmountStreamdownIsland(container: HTMLElement | null | undefined) {
  if (!container) return;
  const root = roots.get(container);
  if (!root) return;
  root.unmount();
  roots.delete(container);
  mountedContainers.delete(container);
  lastRenders.delete(container);
}

function getStreamdownPlugins(themes: [ThemeInput, ThemeInput]) {
  const key = themes.map((theme) => typeof theme === 'string' ? theme : theme.name || 'custom').join('\u0000');
  let plugins = streamdownPlugins.get(key);
  if (!plugins) {
    let codePlugin = codePlugins.get(key);
    if (!codePlugin) {
      codePlugin = createCodePlugin({ themes });
      codePlugins.set(key, codePlugin);
    }
    plugins = { code: codePlugin, math: mathPlugin };
    streamdownPlugins.set(key, plugins);
  }
  return plugins;
}

window.addEventListener(THEME_CHANGE_EVENT, () => {
  for (const container of Array.from(mountedContainers)) {
    const lastRender = lastRenders.get(container);
    if (!lastRender) continue;
    if (!container.isConnected) {
      mountedContainers.delete(container);
      lastRenders.delete(container);
      continue;
    }
    void renderStreamdownIsland(container, lastRender.markdown, { streaming: false });
  }
});
