# Tiled Relation Field Design

## Purpose

The second RhizoDoc frontend is a **tiled relation field** over the same document graph. It borrows part of the feel of a tiling window manager: every depth column has a deterministic stack order, and keyboard operations can move focus or swap neighboring panels. Unlike a strict tiling manager, stacks are **elastic**: adjacent panels may have automatically computed whitespace between them when relation-aware layout needs room to align meaningful context.

The infinite canvas remains the free spatial map. The tiled relation field is the dense reading/synthesis view: horizontal position is graph depth, vertical order is a stack inside each depth, and the current focus plus graph/annotation relations can produce automatic vertical spacing so related panels appear near the reading context.

> Graph depth decides columns. Tiling order decides each column. Focus context and relations decide automatic elastic spacing. Users do not author explicit gaps.

## Core Principles

1. **Depth columns are semantic**
   - A node's column is determined by graph depth: root at depth 0, children at depth +1, DAG nodes at minimum reachable depth.
   - Layout state must not silently move a node across depth columns.
   - Reparenting or graph edits are explicit content operations, not layout operations.

2. **Each column is an elastic ordered stack**
   - Panels in one column keep a deterministic order and may not overlap.
   - Adjacent panels may have automatically computed whitespace between them.
   - This whitespace is derived render state, not a persisted user-authored gap.
   - The persisted layout primitive is still per-column order, i.e. `columns[].pageIds` for the matching depth.
   - Default derived order follows document reading order: children generated from annotations on the same source are ordered by annotation start position, not by annotation creation time.
   - Annotation-derived sibling groups are canonicalized back to source reading order during projection, so old automatically persisted creation-order columns do not override the reading model.
   - Users must be able to swap a focused panel with its previous/next neighbor by keyboard; a future explicit order-override flag may be needed if manual order should beat annotation reading order.

3. **“Loose” means constrained elastic spacing, not floating panels**
   - Panels do not drift freely inside the depth column.
   - The layout solver may separate neighboring panels only while preserving column order and non-overlap constraints.
   - Relation alignment, focus context, panel heights, compact-stack priors, and measured anchors decide the computed spacing.
   - Canonical layout must be deterministic for identical graph content, workspace order, panel dimensions, focus, and measured anchors.
   - Previous rendered positions are only temporary interactive smoothing input; they are not canonical layout state.
   - There is no manual gap state to maintain.

4. **Focus context optimizes what is nearby**
   - When reading the focused node, neighboring columns should automatically put likely useful nodes near the focused panel.
   - Strong candidates include parent, children, annotation source/target, and later semantic matches.
   - Annotation relations should have stronger pull than ordinary structural edges because they point to exact text spans.

5. **Navigation is semantic where horizontal, tiled where vertical**
   - Left/right keyboard navigation follows graph relations: parent/strongest incoming, child/strongest outgoing.
   - Up/down navigates the previous/next panel in the same depth stack.
   - Shift+Up / Shift+Down swaps the focused panel with the previous/next panel in its stack.

6. **Content and viewpoint remain separate**
   - Nodes, edges, annotations, and LLM metadata are content.
   - Column order, panel height/display/scroll, focus, search, and floating state are viewpoint/workspace state.
   - Graph depth is derived from content; stack order is workspace state.

## Product Shape

```text
                         current focus context

Depth 0 stack              Depth 1 stack                 Depth 2 stack
┌───────────────┐          ┌───────────────┐             ┌───────────────┐
│ Root          │          │ Child A       │             │ Grandchild X  │
├───────────────┤          ├───────────────┤             ├───────────────┤
│ Other root-ish│          │ Focused node  │◀──────────▶ │ Related child │
├───────────────┤          ├───────────────┤             ├───────────────┤
│ ...           │          │ Child B       │             │ ...           │
└───────────────┘          └───────────────┘             └───────────────┘
       ▲                         ▲                              ▲
       │ elastic spacing         │ focus column                 │ elastic spacing
```

The stacks remain ordered and non-overlapping. A focus-context layout pass can insert automatic whitespace so the most relevant panels line up around the focused panel without making individual panels freely draggable layout objects.

The workspace should allow intentional over-scroll. The user should be able to scroll far enough upward or downward that all panels leave the viewport; the limit is not the first/last panel touching the viewport edge.

## Data Model

The current model is close if interpreted correctly:

```ts
export type RhizoWorkspace = {
  id: string;
  name: string;
  kind: 'bottomless-tiled'; // old 'tiled' normalizes here
  projection: TiledProjection;
  columns: TiledColumn[];   // one stack per graph depth
  pages: Record<string, TiledPageState>;
  floating: TiledFloatingPage[];
  focus: TiledFocus | null;
};

export type TiledColumn = {
  id: string;
  depth: number;            // graph depth, not arbitrary lane
  width: number;
  pageIds: string[];        // stack order only for nodes whose projected depth matches this column
  collapsed?: boolean;
};

export type TiledPageState = {
  nodeId: string;
  display: 'title' | 'compact' | 'normal' | 'expanded';
  height: number;
  scrollTop: number;
  pinned?: boolean;
};
```

Important invariants:

- `TiledColumn.depth` is semantic graph depth.
- `columns[].pageIds` stores order within that depth only.
- If persisted `pageIds` place a node in the wrong depth, normalization/projection ignores that membership.
- Elastic spacing is computed render state, not persisted per-panel free coordinates.

## Projection and Layout

1. Select root: requested root if valid, else `node-root`, else first parentless node, else first node.
2. Build relations from `edges` plus `parentId` fallback.
3. Assign each node a primary depth by minimum reachable distance from root.
4. Create one column stack per depth.
5. Preserve persisted order for page ids that still belong to that depth, except annotation-derived sibling groups are normalized to source reading order.
6. Append new nodes according to derived reading order: annotation children by source annotation start, then ordinary node insertion order.
7. Compute base compact stack layout with a small automatic minimum breathing gap.
8. Compute relation-aware elastic stack positions:
   - build an indexed relation model from edges, parent fallback, sibling context, and annotations;
   - create a compact base snapshot for all columns;
   - run bounded multi-pass relaxation from a consistent previous-pass snapshot;
   - each column receives soft desired positions from related panels in that snapshot;
   - a 1D weighted isotonic/PAVA solver preserves order and non-overlap while fitting desired positions.

### Elastic ordered-stack formula

For a column with panels in fixed order, the hard constraints are:

```text
y[i + 1] >= y[i] + height[i] + minGap
```

The soft objective is:

```text
minimize Σ weight[i] * (y[i] - desiredY[i])²
```

where `desiredY` is a weighted combination of:

- compact-stack position;
- relation alignment targets from the current relaxation snapshot;
- focus-context boosts for the active panel and its strongest relations;
- previous solved position only during explicit interactive smoothing, not canonical layout.

This is reduced to weighted isotonic regression by subtracting cumulative panel heights and minimum gaps, then solved with Pool Adjacent Violators Algorithm (PAVA). The automatic whitespace between panels is the residual separation produced by this constrained fit.

The result should be recomputed when focus, order, panel display/height, graph relations, or annotations change. Ordinary scrolling should redraw relation paths but should not continuously re-solve elastic gaps, because that would make the reading field feel unstable. Relation pulls are clamped and saturated so weak relations cannot accumulate into large empty fields.

### Anchor model

Elastic relation targets align **semantic anchors**, not just panel boxes.

Anchor priority:

1. Exact active annotation span when present, measurable, and visible in the source content viewport.
2. Focused panel's currently visible Markdown/content interval.
3. Focused panel's visible panel interval.
4. Panel center fallback.

This distinction matters for long panels: parent/context alignment should follow what the reader is currently seeing inside the focused panel, not the full card's center. Annotation relations should align to the highlighted source span when available.

Visibility is part of the annotation-span anchor contract:

- `visible`: the semantic span is actually visible and may be used as a precise span-level layout anchor.
- `above-viewport` / `below-viewport`: the span exists but is outside the current reading viewport. Its clamped top/bottom position is an offscreen cue anchor, not a real visible span anchor.

An offscreen annotation relation must not disappear from layout, but it must also not masquerade as an exact visible span. The relation degrades from a precise high-weight span anchor to a weaker bounded endpoint. Only sparse nearest-above / nearest-below annotations may use the clamped top/bottom cue position; all other offscreen annotations fall back to node-level anchors such as the focused visible-content interval, visible panel interval, or panel center. This preserves source/target direction without letting hidden spans pretend to be visible exact anchors.

## Focus Lens

Raw graph and annotation relations are first interpreted by a focus lens before they affect layout or overlays. The lens assigns relation roles such as:

- `annotation-jump`: an active annotation relation that may exactly align semantic anchors.
- `active-path`: the focused structural path, for example focused child → parent/context.
- `fanout-context`: high fan-out structural context that should not pull every child at once.
- `background`: relation data that remains available for navigation/search but does not affect current layout.

The layout solver consumes lens policies rather than deciding relation semantics itself. This keeps PAVA layout math separate from product choices about browsing intent, visual clutter, and high fan-out behavior.

## Relationship Tension

Relations should be visible as a dynamic field over the tiled stacks.

Structural relations:

- Parent-child relations are expressed primarily by depth columns, stack order, focus-lens roles, and navigation.
- They may influence layout as active focus context, for example when a focused child asks its parent/context to follow the current reading anchor.
- They are **not** drawn as default SVG curves in the tiled view; drawing every structural edge creates visual noise in high fan-out workspaces.
- Used for left/right navigation and context scoring.

Annotation relations:

- Annotation source/target lines inherit annotation color.
- Prefer exact highlighted mark as source anchor when visible.
- Offscreen annotation marks should become bounded edge/cue state and should not be clamped to viewport boundaries as if they were visible exact span anchors.
- The annotation relation itself still participates with reduced weight through node-level fallback anchors, so related panels do not snap back to the top of their column when a span scrolls offscreen.
- Offscreen cue positions are sparse: only nearest above/below marks may use top/bottom cue anchors; other offscreen relations use node-level fallback anchors.
- Stronger than structural edges for focus-context layout scoring.
- Used to pull annotation-related panels into view around the focused panel.

Future semantic relations:

- Search/embedding/tag/backlink relations can add weaker soft pulls.
- These should not override explicit annotation or parent-child context.

## Keyboard Model

Navigation:

- `ArrowLeft`: focus parent / strongest incoming structural relation.
- `ArrowRight`: focus child / strongest outgoing structural relation.
- `ArrowUp`: focus previous panel in the same depth stack.
- `ArrowDown`: focus next panel in the same depth stack.
- `Home`: focus root.
- `Backspace`: focus previous focus history entry.

Tiling layout operations:

- `Shift+ArrowUp`: swap focused panel with previous panel in the same depth stack.
- `Shift+ArrowDown`: swap focused panel with next panel in the same depth stack.
- `Shift + primary-button drag` on a panel: resize the panel and its depth column together; horizontal drag changes column width, vertical drag changes panel height. The elastic solver then recomputes automatic spacing from the new heights.
- `[` / `]`: shorten/tallify focused panel.
- `Space`: title-only toggle.

Graph/content operations remain explicit command-palette actions:

- reparent focused page;
- make focused page child of selected parent;
- detach from parent;
- move to floating scratchpad.

## Rendering Strategy

The current DOM implementation can remain for MVP:

- keep input handling inside the tiled workspace controller as event delegation plus small gesture state machines;
- treat pointer gestures, keyboard commands, scroll intent, and text selection as separate input channels;
- render depth columns as absolute stack lanes;
- render each panel at its computed elastic y;
- keep relation indexing and contextual layout mostly pure TypeScript so behavior is unit-testable without DOM;
- add viewport-sized vertical slack above and below the field, so over-scroll can move every panel out of view;
- measure semantic anchors separately from layout solving: visible content interval, annotation span, visible panel fallback;
- draw relation SVG paths from measured DOM anchors;
- recalculate elastic positions and relation paths when focus, order, height, display mode, graph relations, or annotations change;
- workspace scroll should redraw relation paths without re-solving elastic gaps;
- animate patched `left/top/width/height` changes and redraw relation paths during the transition.

A future renderer island may own the tiled workspace once interactions grow, but the pure projection/order rules should remain shared TypeScript.

## Implementation Phases

### Phase A: Correct MVP semantics

- Keep depth-derived columns.
- Reject cross-depth membership as a layout override.
- Render columns as ordered non-overlapping elastic stacks.
- Add relation overlay.
- Make left/right graph-aware.
- Make up/down stack-aware.
- Add Shift+Up/Down stack swapping.
- Add computed focus-context elastic spacing for neighboring columns.

### Phase B: Better context scoring and layout purity

- Keep the PAVA stack solver pure and deterministic.
- Build indexed relation candidates instead of scanning every edge/annotation for every pair.
- Use a focus-lens policy layer between raw relations and layout/overlay/navigation behavior.
- Use snapshot-based multi-pass relaxation instead of asymmetric left/right solve order.
- Score annotation source/target strongest.
- Score active structural path next.
- Keep high fan-out parent → children relations bounded as `fanout-context` until the user identifies a current child/annotation/hover target.
- Add tie-breaking based on recency, current viewport, and node generation source.
- Use previous positions only for explicit interactive smoothing, not canonical layout.

### Phase C: Offscreen and relaxation cues

- Add offscreen indicators for related panels.
- Add hover/focus line emphasis.
- Add optional “optimize current context” command that reorders stacks, but never silently changes graph depth.

### Phase D: Search and workspace features

- Search-generated viewpoints.
- Floating scratchpad with relation lines back to depth stacks.
- Workspace duplicate/rename/manage UI.
- Chinese fuzzy search and command palette.
