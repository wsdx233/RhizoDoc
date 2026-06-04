# Tiled Workspace Design

## Purpose

RhizoDoc currently has an infinite canvas view that is good for spatial exploration, edge inspection, and free-form annotation work. The tiled workspace is a second frontend view over the same flow data: a keyboard-friendly, column-oriented reading and synthesis surface inspired by tiling window managers, Miller columns, and sliding panes.

The tiled workspace should not replace the canvas. It should let users create a different viewpoint over the same document graph: structured, dense, persistent, and easy to navigate without a mouse.

## Design Principles

1. **Content and viewpoint stay separate**: nodes, edges, annotations, and LLM metadata remain content; tiled columns, section heights, ordering, scroll positions, floating pages, and focus are workspace state.
2. **Default layout is derived, user layout is persisted**: when no workspace overrides exist, derive columns from graph depth; persist only user choices and workspace-specific view state.
3. **Tree-first, DAG-tolerant**: most flows are expected to be trees, but the projection must tolerate DAG edges, orphan nodes, and independent canvas nodes.
4. **One page, many presentations**: a node/page can appear on the canvas, in a tiled section, in a floating scratchpad, and in a search result without duplicating content.
5. **Keyboard model is first-class**: focus, commands, and search should be designed as state/actions, not ad-hoc event listeners.
6. **Rendering remains incremental**: keep the current static Markdown renderer and Streamdown island; do not force a full app rewrite.

## Product Shape

The tiled workspace fills the viewport with columns. Each column corresponds by default to one graph depth. Each page appears as a section inside a column.

```text
┌──────────── depth 0 ────────────┬──────────── depth 1 ────────────┬──────────── depth 2 ────────────┐
│ Root document                   │ Child A                         │ Grandchild A1                   │
│ ┌─────────────────────────────┐ │ ┌─────────────────────────────┐ │ ┌─────────────────────────────┐ │
│ │ section: scrollable content │ │ │ section: title-only         │ │ │ section: scrollable content │ │
│ └─────────────────────────────┘ │ └─────────────────────────────┘ │ └─────────────────────────────┘ │
│                                 │ Child B                         │ Floating shelf overlays / side  │
└─────────────────────────────────┴─────────────────────────────────┴─────────────────────────────────┘
```

### Core Behaviors

- Nodes are projected into depth columns by default.
- Columns span the available screen width and have resizable widths.
- Each page is rendered as a section with a resizable height.
- If page content exceeds section height, the section content scrolls independently.
- A page can be title-only, compact, normal, or expanded.
- Page order inside each column is persistent per workspace.
- Floating pages act as a scratchpad outside the column flow.
- Workspaces persist different viewpoints over the same graph.
- Keyboard navigation, resizing, moving, and search are first-class actions.

## Data Model

The existing `RhizoFlow` should grow a view-state layer. The current flow schema can remain backward compatible by making this optional.

```ts
export type RhizoWorkspace = {
  id: string;
  name: string;
  kind: 'tiled';
  createdAt: string;
  updatedAt: string;
  projection: TiledProjection;
  columns: TiledColumn[];
  pages: Record<string, TiledPageState>;
  floating: TiledFloatingPage[];
  focus: TiledFocus | null;
  search?: TiledSearchState;
};

export type TiledProjection = {
  mode: 'depth';
  rootId?: string;
  maxDepth?: number;
  includeOrphans: boolean;
};

export type TiledColumn = {
  id: string;
  depth: number;
  width: number;
  pageIds: string[];
  collapsed?: boolean;
};

export type TiledPageState = {
  nodeId: string;
  display: 'title' | 'compact' | 'normal' | 'expanded';
  height: number;
  scrollTop: number;
  pinned?: boolean;
};

export type TiledFloatingPage = {
  nodeId: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  zIndex: number;
  display: 'compact' | 'normal' | 'expanded';
};

export type TiledFocus = {
  workspaceId: string;
  region: 'columns' | 'floating' | 'search';
  columnId?: string;
  nodeId?: string;
};
```

### Flow Integration

Add optional workspace fields to `RhizoFlow`:

```ts
export type RhizoFlow = {
  // existing fields
  workspaces?: RhizoWorkspace[];
  activeWorkspaceId?: string;
};
```

Backward compatibility rule:

- If a loaded flow has no `workspaces`, create an in-memory default tiled workspace from the current graph.
- Saving the flow persists workspace state only after the user switches to tiled view or changes tiled layout.
- Existing canvas fields remain the canonical canvas viewpoint.

## Projection Algorithm

The first implementation should derive columns from graph depth.

1. Choose root:
   - Prefer node with id `node-root`.
   - Else prefer first node with no `parentId`.
   - Else use first node.
2. Build adjacency from edges and fallback parent relationships.
3. BFS from root to assign minimum depth.
4. Assign unvisited/orphan nodes to an `orphans` column or depth `0` depending workspace setting.
5. For each depth, create a column.
6. Respect persisted `column.pageIds` ordering when present.
7. Append newly discovered nodes not in persisted order.
8. Remove deleted node ids from workspace state during validation/normalization.

DAG rule: if a node is reachable through multiple paths, use minimum depth as primary projection. Cross-depth edges stay visible through metadata/search/context, not through duplicate tiled sections by default.

## Layout State Rules

### Columns

- Width is stored as a number, preferably CSS pixels for v1.
- Later we can migrate to weighted fractions if responsive restoration becomes awkward.
- Minimum width should be around `260px`; default width around `420px`.
- Horizontal overflow is acceptable: users can pan/scroll through columns like sliding panes.

### Sections

- Default height: `min(520px, viewportHeight * 0.62)` for root/active pages, `220px` for other pages.
- Minimum section height: title-only height or about `72px`.
- Page content scrollTop is saved per workspace/page.
- Title-only mode still participates in ordering, focus, search, and commands.

### Floating

Floating is a scratchpad, not a second source of truth.

- A floating page references a node id.
- Floating pages are excluded from column layout only if user explicitly chooses `float-only`; v1 can allow the same node to appear in both places.
- Floating state is workspace-specific.
- Keyboard command should toggle current page into/out of floating.

## Keyboard and Command Model

Implement a command registry before adding many shortcuts.

```ts
export type TiledCommand = {
  id: string;
  label: string;
  run: (context: TiledCommandContext) => void;
  when?: (context: TiledCommandContext) => boolean;
};
```

Initial commands:

- `focus.left` / `focus.right`: move to adjacent column.
- `focus.up` / `focus.down`: move to previous/next section in current column.
- `page.toggleTitleOnly`: toggle title-only mode.
- `page.expand` / `page.compact`: change section display mode.
- `page.resizeTaller` / `page.resizeShorter`: adjust focused section height.
- `page.moveUp` / `page.moveDown`: reorder within column.
- `page.moveLeft` / `page.moveRight`: move page to adjacent column override.
- `page.floatToggle`: toggle scratchpad/floating state.
- `workspace.next` / `workspace.prev`: switch viewpoints.
- `search.open`: focus search/command palette.

Suggested defaults:

- Arrow keys for normal navigation when not editing text.
- `h/j/k/l` optionally when a Vim mode is enabled.
- `Space` toggles title-only.
- `[` / `]` adjust section height.
- `Shift+J` / `Shift+K` reorder sections.
- `/` opens search.
- `Ctrl/Cmd+K` opens command palette.

## Search Design

Search should index graph content, not only visible tiled pages.

MVP index fields:

- node title
- node Markdown content
- annotation text
- parent title
- depth/workspace column label

Chinese-friendly search should not rely on whitespace tokenization. A pragmatic v1:

1. Normalize full-width/half-width variants and lowercase Latin.
2. Use `Intl.Segmenter('zh')` where available.
3. Add CJK character bigrams/trigrams as fallback tokens.
4. Optionally add pinyin initials later.

Candidate libraries:

- Orama with Mandarin tokenizer for a higher-level search engine.
- FlexSearch with custom CJK tokenizer for performance.
- MiniSearch if we want minimal dependency size and full tokenizer control.

Search result actions:

- focus page in current workspace
- open result in floating scratchpad
- add result to current column
- create a new workspace from search results

## Rendering Strategy

Tiled sections should reuse existing rendering infrastructure:

- Static node content: use current `renderMarkdown()` path.
- Active LLM stream: use the existing lazy Streamdown island.
- Annotation wrapping: reuse `annotations.ts` and logical text utilities.

This argues for a React island that owns tiled layout and lifecycle, while existing canvas remains vanilla TypeScript.

Possible island boundary:

```ts
renderTiledWorkspace(container, {
  flow,
  workspace,
  actions,
});
```

The React island should not mutate global state directly. It receives state and calls typed actions such as `updateWorkspacePageState`, `moveWorkspacePage`, `focusNode`, and `openNodeOnCanvas`.

## Implementation Plan

### Phase 1: Schema and Projection

- Add workspace/tiled types in shared code.
- Add normalizers for optional workspace state.
- Add pure depth projection function with tests.
- Persist optional workspaces in flow JSON.
- Do not render UI yet.

### Phase 2: Read-Only Tiled View

- Add a view switcher: canvas / tiled.
- Render columns and sections from projected graph.
- Use static Markdown rendering inside sections.
- No dragging/resizing yet.
- Keyboard focus outline only.

### Phase 3: Persistent Layout Controls

- Resizable column widths.
- Resizable section heights.
- Per-section scroll position persistence.
- Title-only / compact / normal display modes.
- Reorder pages within a column.

### Phase 4: Floating Scratchpad and Workspaces

- Floating shelf/overlay for temporary pages.
- Workspace create/rename/duplicate/delete.
- Different page ordering/display states per workspace.
- Commands for moving pages between tiled/floating.

### Phase 5: Search and Command Palette

- Add local search index.
- Add Chinese-friendly tokenization.
- Add command palette with result actions.
- Support search-generated workspace/viewpoint.

## Open Questions

1. Should column width be stored as pixels or relative weights? Pixels are simpler for v1; weights are better for responsive restoration.
2. Should a page moved to a custom column change its graph depth override, or only the workspace layout? Prefer workspace-only.
3. Should floating pages duplicate column presence or remove from columns while floating? Prefer duplicate in v1, optional float-only later.
4. Should workspaces live inside flow JSON immediately, or in browser local storage until user saves? Prefer flow JSON for portability, with auto-created defaults.
5. Should tiled view show graph edges visually? Probably not in v1; show parent/child metadata and navigation affordances instead.

## References

- i3 User Guide: https://i3wm.org/docs/userguide.html
- Sway: https://swaywm.org/
- Zellij layouts: https://zellij.dev/documentation/layouts.html
- React Mosaic: https://github.com/nomcopter/react-mosaic
- Dockview: https://dockview.dev/
- GoldenLayout: https://golden-layout.com/
- Lumino: https://github.com/jupyterlab/lumino
- JSON Canvas: https://jsoncanvas.org/
- Logseq: https://github.com/logseq/logseq
- AFFiNE: https://github.com/toeverything/AFFiNE
- BlockSuite: https://github.com/toeverything/BlockSuite
- SiYuan: https://github.com/siyuan-note/siyuan
- Orama Mandarin tokenizer: https://docs.orama.com/docs/orama-js/supported-languages/using-chinese-with-orama
- FlexSearch: https://github.com/nextapps-de/flexsearch
- MiniSearch: https://lucaong.github.io/minisearch/
