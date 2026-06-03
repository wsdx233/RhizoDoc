export type RhizoDocConfig = {
  loaded?: boolean;
  server: {
    host: string;
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

export type ApiConfigResponse = {
  ok: true;
  provider: string;
  model: string;
  modelName: string;
  apiType: string;
  reasoningEffort: string;
  ready: boolean;
  hasApiKey: boolean;
  authStatus: unknown;
  configSource: string;
  error: string | null;
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

export type LLMGenerateResponse = {
  ok: true;
  title: string;
  content: string;
  raw: string;
  usage: unknown | null;
  model: string;
  apiType: string;
  reasoningEffort: string;
};

export type FlowSummary = {
  name: string;
  fileName: string;
  size: number;
  updatedAt: string;
};

export type FlowListResponse = {
  ok: true;
  flows: FlowSummary[];
};

export type SaveFlowResponse = {
  ok: true;
  name: string;
  fileName: string;
};
