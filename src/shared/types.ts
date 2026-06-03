export type RhizoDocConfig = {
  loaded?: boolean;
  server: {
    port: number;
    jsonLimit: string;
  };
  pi: {
    provider: string;
    model: string;
    thinkingLevel: string;
    maxTokens: number;
  };
  storage: {
    flowsDir: string;
  };
};

export type LLMMode = 'selection' | 'node' | 'canvas' | 'initial' | 'regenerate';

export type LLMGeneratePayload = {
  mode: LLMMode;
  userPrompt: string;
  selectedText: string;
  parentTitle: string;
  parentContent: string;
  rootTitle: string;
  graphSummary: string;
  apiType: string;
};

export type RhizoNode = {
  id: string;
  parentId: string | null;
  title: string;
  content: string;
  x: number;
  y: number;
  width: number;
  height: number;
  collapsed: boolean;
  generated: boolean;
  loading: boolean;
  direction: 'left' | 'right';
  createdAt: string;
  [key: string]: unknown;
};

export type RhizoEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  [key: string]: unknown;
};

export type RhizoAnnotation = {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  start: number;
  length: number;
  text: string;
  colorIndex: number;
  [key: string]: unknown;
};

export type RhizoCanvas = {
  x: number;
  y: number;
  scale: number;
};

export type RhizoFlow = {
  version: number;
  app: string;
  name: string;
  savedAt: string;
  canvas: RhizoCanvas;
  colorIndex: number;
  nodes: RhizoNode[];
  edges: RhizoEdge[];
  annotations: RhizoAnnotation[];
  [key: string]: unknown;
};
