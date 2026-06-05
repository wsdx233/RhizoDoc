import React from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createCodePlugin } from '@streamdown/code';
import { math as mathPlugin } from '@streamdown/math';
import { Streamdown } from 'streamdown';
import 'katex/dist/katex.min.css';
import 'streamdown/styles.css';

type StreamdownRenderOptions = {
  streaming?: boolean;
};

const roots = new WeakMap<HTMLElement, Root>();
const codePlugin = createCodePlugin({ themes: ['github-dark', 'github-dark'] });
const streamdownPlugins = { code: codePlugin, math: mathPlugin };

export function renderStreamdownIsland(container: HTMLElement, markdown: string, { streaming = true }: StreamdownRenderOptions = {}) {
  let root = roots.get(container);
  if (!root) {
    container.textContent = '';
    root = createRoot(container);
    roots.set(container, root);
  }

  const element = React.createElement(Streamdown, {
    animated: false,
    className: 'rhizodoc-streamdown',
    controls: false,
    isAnimating: streaming,
    lineNumbers: false,
    mode: 'streaming',
    parseIncompleteMarkdown: true,
    plugins: streamdownPlugins,
    shikiTheme: ['github-dark', 'github-dark'],
    children: markdown,
  });

  if (streaming) root.render(element);
  else flushSync(() => root.render(element));
}

export function unmountStreamdownIsland(container: HTMLElement | null | undefined) {
  if (!container) return;
  const root = roots.get(container);
  if (!root) return;
  root.unmount();
  roots.delete(container);
}
