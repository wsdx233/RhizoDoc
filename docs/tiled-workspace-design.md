# Tiled Relation Field Design

## Purpose

The second RhizoDoc frontend is a **tiled relation field** over the same document graph. It should borrow the feel of a tiling window manager: every depth column is a tiled stack, panels are contiguous, ordering is explicit, and keyboard operations can move focus or swap neighboring panels.

The infinite canvas remains the free spatial map. The tiled relation field is the dense reading/synthesis view: horizontal position is graph depth, vertical order is a tiling stack inside each depth, and the current focus can shift neighboring columns as whole stacks so the most relevant related panels appear near the reading context.

> Graph depth decides columns. Tiling order decides each column. Focus context decides relative column offsets.

## Core Principles

1. **Depth columns are semantic**
   - A node's column is determined by graph depth: root at depth 0, children at depth +1, DAG nodes at minimum reachable depth.
   - Layout state must not silently move a node across depth columns.
   - Reparenting or graph edits are explicit content operations, not layout operations.

2. **Each column is a tiling stack**
   - Panels in one column are stacked contiguously, like a tiling window manager.
   - There are no arbitrary holes between neighboring panels in the same column.
   - The persisted layout primitive is per-column order, i.e. `columns[].pageIds` for the matching depth.
   - Users must be able to swap a focused panel with its previous/next neighbor by keyboard.

3. **“Loose” means relative column offset, not floating panels**
   - Left and right depth columns can be vertically offset relative to the focused column.
   - This offset is calculated from the current focus context.
   - The offset moves a whole column stack, preserving that column's tiling continuity.
   - Individual panels do not drift freely inside the depth column.

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
       │ whole-column offset     │ focus column                 │ whole-column offset
```

The stacks remain tiled: panel-to-panel continuity inside a column is preserved. A focus-context layout pass can offset the left and right stacks so the most relevant panels line up around the focused panel.

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
- Relative column offsets are computed render state, not persisted per-panel free coordinates.

## Projection and Layout

1. Select root: requested root if valid, else `node-root`, else first parentless node, else first node.
2. Build relations from `edges` plus `parentId` fallback.
3. Assign each node a primary depth by minimum reachable distance from root.
4. Create one column stack per depth.
5. Preserve persisted order for page ids that still belong to that depth.
6. Append new nodes at the end of their depth stack.
7. Compute base stack layout: each panel starts immediately after the previous panel.
8. Compute contextual column offsets from current focus:
   - focused column offset = 0;
   - compute a stable `deltaY` for every adjacent depth-column pair;
   - integrate those deltas left and right from the focused column.

### Adjacent-column offset formula

The invariant is pairwise: every adjacent column pair has a relative displacement computed by the same formula. Columns are not independently aligned to the focused panel.

For adjacent columns `L` and `R`:

```text
deltaY(L, R) = sourceBaseY + sourceAnchor - targetBaseY - targetAnchor
```

Where:

- `source` / `target` are the highest-scoring related panel pair across the adjacent columns under the current focus context.
- `sourceBaseY` and `targetBaseY` come from the current overall layout before contextual offsets.
- `sourceAnchor` is normally the source panel center; if source is the focused panel, it is derived from the focused panel's current visible interval.
- `targetAnchor` is the corresponding anchor in the target panel, clamped to that panel's height.

Absolute offsets are then integrated from the focused column as anchor:

```text
offsetY(focusColumn) = 0
offsetY(column[i + 1]) = offsetY(column[i]) + deltaY(column[i], column[i + 1])
offsetY(column[i - 1]) = offsetY(column[i]) - deltaY(column[i - 1], column[i])
```

So the whole workspace satisfies a deterministic adjacent-column formula whose parameters are:

```text
current overall layout + focused panel id + focused panel visible interval position
```

The result can change while the user scrolls the workspace, but it should be recomputed by patching positions, not by rebuilding Markdown content. Position changes should animate so the user can perceive continuity in the relation field.

## Relationship Tension

Relations should be visible as a dynamic field over the tiled stacks.

Structural relations:

- Parent-child edges use neutral/primary curves.
- Focused panel strengthens parent and child paths.
- Used for left/right navigation and context offset scoring.

Annotation relations:

- Annotation source/target lines inherit annotation color.
- Prefer exact highlighted mark as source anchor when visible.
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
- `Shift + primary-button drag` on a panel: resize the panel and its depth column together; horizontal drag changes column width, vertical drag changes panel height.
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
- render each panel at its computed stack y plus contextual column offset;
- add viewport-sized vertical slack above and below the field, so over-scroll can move every panel out of view;
- draw relation SVG paths from measured DOM anchors;
- recalculate offsets and relation paths when focus, order, height, workspace scroll, or annotations change;
- when only offsets change because of workspace scroll, patch section positions instead of rebuilding Markdown DOM;
- animate patched `left/top/width/height` changes and redraw relation paths during the transition.

A future renderer island may own the tiled workspace once interactions grow, but the pure projection/order rules should remain shared TypeScript.

## Implementation Phases

### Phase A: Correct MVP semantics

- Keep depth-derived columns.
- Reject cross-depth membership as a layout override.
- Render columns as contiguous tiling stacks.
- Add relation overlay.
- Make left/right graph-aware.
- Make up/down stack-aware.
- Add Shift+Up/Down stack swapping.
- Add computed focus-context offsets for neighboring columns.

### Phase B: Better context scoring

- Score annotation source/target strongest.
- Score parent/child next.
- Score siblings/backlinks/semantic search lower.
- Add tie-breaking based on recency, current viewport, and node generation source.

### Phase C: Offscreen and relaxation cues

- Add offscreen indicators for related panels.
- Add hover/focus line emphasis.
- Add optional “optimize current context” command that reorders stacks, but never silently changes graph depth.

### Phase D: Search and workspace features

- Search-generated viewpoints.
- Floating scratchpad with relation lines back to depth stacks.
- Workspace duplicate/rename/manage UI.
- Chinese fuzzy search and command palette.
