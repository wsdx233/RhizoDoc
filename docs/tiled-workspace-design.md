# Bottomless Tiled Workspace Design

## Purpose

The second RhizoDoc frontend is not a conventional tiled window manager. It is a **bottomless relation field** over the same document graph.

The infinite canvas remains the free spatial map. The bottomless tiled workspace is a dense reading/synthesis field: pages are constrained into depth/lane columns, but the vertical dimension has no bottom. Parent-child edges and annotation links create visible and interactive tension between panels.

This replaces the earlier assumption that the view should simply fill the screen with a finite set of columns. Columns are still useful, but they are not the core idea. The core idea is:

> A graph-projected, bottomless, keyboardable document field whose panels are shaped by relationship tension.

## Revised Core Principles

1. **Bottomless, not screen-fitted**
   - The workspace is allowed to grow downward indefinitely.
   - A viewport reveals a moving window over this field.
   - The goal is not to pack everything into the current screen height.
   - The current screen is only a lens over a larger relation surface.

2. **Columns are lanes, not containers with bottoms**
   - Depth columns still provide left-to-right structure.
   - Each column is a vertical lane with unbounded length.
   - A panel has a lane/depth, y position, height, display mode, and scroll position.
   - Page order can be derived from y positions, but order is not the whole layout.

3. **Relationships create tension**
   - Parent-child edges, annotation links, and future semantic links should pull related panels toward meaningful vertical alignment.
   - The field should show these pulls visually: spring curves, glow, focus halos, offscreen indicators.
   - The layout can offer automatic/soft relaxation, but user positioning remains authoritative.

4. **Left/right navigation follows graph structure**
   - Left/right should not mean “adjacent column item.”
   - Left means parent / strongest incoming structural relation.
   - Right means child / strongest outgoing structural relation.
   - Up/down navigate local vertical neighborhood within the current lane.
   - Explicit reparenting or cross-lane layout movement should be separate commands, not basic navigation.

5. **Annotations are first-class spatial relations**
   - An annotation is not just highlighted text plus a child node.
   - It is a relation with a source anchor inside one page and a target panel elsewhere.
   - In the tiled workspace, annotation links should create stronger visual tension than ordinary structural edges because they point to exact text spans.

6. **Content and viewpoint remain separate**
   - Nodes, edges, annotations, and LLM metadata remain content.
   - Lane choice, y position, height, title-only state, scroll position, floating state, and focus are viewpoint state.
   - Workspaces are saved viewpoints over the same graph.

7. **Manual layout beats automatic layout**
   - Automatic projection places panels and suggests alignment.
   - User changes become persistent overrides.
   - A relation-field relaxer may propose movement, but should not destroy carefully arranged viewpoints.

## Product Shape

A bottomless tiled workspace has horizontal lanes and an unbounded vertical field.

```text
viewport top
┌──────────── depth 0 lane ────────────┬──────────── depth 1 lane ────────────┬──────────── depth 2 lane ────────────┐
│ y=0    Root page                     │ y=16   Child from intro              │ y=40   Grandchild                    │
│        ┌──────────────────────┐      │        ┌──────────────────────┐      │        ┌──────────────────────┐      │
│        │ scrollable section   │╲     │        │ title-only / compact │╲     │        │ scrollable section   │      │
│        └──────────────────────┘ ╲    │        └──────────────────────┘ ╲    │        └──────────────────────┘      │
│                                  ╲   │       annotation tension         ╲   │                                      │
│ y=520  Another root-adjacent      ╲  │ y=470 Child aligned to quote      ╲  │ y=500 Result page                    │
│        ┌──────────────────────┐    ╲ │        ┌──────────────────────┐    ╲ │        ┌──────────────────────┐      │
│        └──────────────────────┘     ╲│        └──────────────────────┘     ╲│        └──────────────────────┘      │
│                                      │                                      │                                      │
│                                      │                                      │                                      │
│                                      ▼                                      ▼                                      ▼
│                                  no bottom                              no bottom                              no bottom
```

The user should feel that related pages tug on each other. When a page is focused, its parents, children, annotation sources, and annotation targets become visually active. Offscreen related pages get directional indicators.

## Relationship Types and Tension

### Structural parent-child edges

Source: `edges` plus fallback `parentId`.

Use for:

- default lane/depth projection
- left/right keyboard navigation
- low/medium-strength relation lines
- default placement of generated child pages near parent y

Visual behavior:

- parent-child lines use neutral/primary color
- focused page strengthens its parent and children
- hovered edge or panel can pulse related panels

### Annotation relations

Source: `annotations`.

Use for:

- exact source text anchoring
- stronger visual tension line from source panel to target panel
- generating/placing child near source text vertical anchor, when available
- showing why a child page exists

Visual behavior:

- annotation lines inherit annotation color index
- line anchor should prefer the visible highlighted mark in the source panel
- if the mark is scrolled out of its section, fallback to section header/body midpoint and show an internal offscreen marker
- focused target should reveal source annotation highlight strongly

### Future semantic relations

Source: search, embeddings, tags, manual links, backlinks.

Use for:

- optional soft tension
- search result workspaces
- “related but not structural” visual hints

These should be lower priority than parent-child and annotation relations.

## Data Model Revisions

The earlier model treated `TiledColumn.pageIds` as primary. In a bottomless field, page identity and position should be primary.

```ts
export type RhizoWorkspace = {
  id: string;
  name: string;
  kind: 'bottomless-tiled'; // old 'tiled' can be normalized/migrated
  createdAt: string;
  updatedAt: string;
  projection: TiledProjection;
  lanes: TiledLane[];
  pages: Record<string, TiledPageState>;
  floating: TiledFloatingPage[];
  focus: TiledFocus | null;
  relationView: TiledRelationViewState;
  search?: TiledSearchState;
};

export type TiledLane = {
  id: string;
  depth: number;
  x: number;
  width: number;
  collapsed?: boolean;
};

export type TiledPageState = {
  nodeId: string;
  laneId: string;
  depth: number;
  y: number;
  height: number;
  display: 'title' | 'compact' | 'normal' | 'expanded';
  scrollTop: number;
  pinned?: boolean;
  userPlaced?: boolean;
};

export type TiledRelationViewState = {
  showStructural: boolean;
  showAnnotations: boolean;
  animateTension: boolean;
  tensionMode: 'focus' | 'hover' | 'always';
};
```

### Compatibility note

The current implementation already has `RhizoWorkspace.kind = 'tiled'`, `columns`, and `columns[].pageIds`. That is acceptable as a stepping stone, but it is not the final shape.

Migration path:

1. Treat old `columns` as lanes.
2. Convert `columns[].pageIds` into page states with increasing y positions.
3. Preserve `pages[nodeId].height`, `display`, and `scrollTop`.
4. Add default `relationView`.
5. Continue saving in the new shape once the bottomless renderer is implemented.

## Projection and Initial Layout

Projection still starts from graph depth, but placement is y-based.

1. Choose root:
   - Prefer `node-root`.
   - Else first parentless node.
   - Else first node.
2. Build graph relations from `edges` and `parentId`.
3. Assign primary depth by minimum reachable distance from root.
4. Create one lane per depth.
5. Place root near y=0.
6. Place each child near its parent’s y, with collision avoidance.
7. Place annotation-generated children near the source annotation anchor when known.
8. Place orphans in an orphan lane or depth 0 fallback.
9. If a saved page has `userPlaced`, do not auto-move it.

### Collision avoidance

The field has no bottom, so collision handling should push panels downward, not compress them into screen height.

A simple v1 algorithm:

```text
for page in preferred-y order:
  y = preferredY(page)
  while overlaps existing panel in same lane:
    y = nextBottom + gap
  place page at y
```

Later, we can add a relaxation pass that reduces relation line crossings and aligns connected anchors.

## Relation Field / Dynamic Tension

### Visual layer

Use an SVG or canvas overlay on top of the bottomless workspace.

Each visible relation line has:

- source node id
- target node id
- relation type: structural | annotation | semantic
- source anchor rect
- target anchor rect
- strength
- color
- active state

Preferred rendering:

- curved spring-like path between lanes
- low opacity when inactive
- stronger stroke and glow for focused/hovered relations
- slight animated dash/flow for active annotation relations
- CSS transitions for panel movement and relation line updates

### Tension strength

Suggested relative weights:

- focused annotation source/target: 1.0
- focused parent/child: 0.75
- visible annotation inactive: 0.45
- visible structural inactive: 0.25
- semantic suggestion: 0.15

### Dynamic effects

When focusing a panel:

- strengthen relation lines touching it
- gently highlight related panels
- show offscreen arrows for related panels outside viewport
- optionally scroll nearby parent/child into view if requested by keyboard navigation

When hovering annotation highlight:

- pulse exact target panel
- strengthen source-to-target line
- optionally show mini label with target title

When a generated node streams:

- create a temporary tension line from source annotation/parent to generating panel
- pulse while loading
- settle after completion

## Keyboard Model Revisions

The previous keyboard model treated columns as neighboring lists. That is wrong for this design.

### Navigation

- `ArrowLeft`: focus parent / strongest incoming structural relation.
- `ArrowRight`: focus first child / strongest outgoing structural relation.
- `ArrowUp`: focus nearest previous panel in the same lane by y.
- `ArrowDown`: focus nearest next panel in the same lane by y.
- `Alt+Left` / `Alt+Right`: move viewport horizontally between lanes without changing graph focus.
- `Home`: focus root.
- `Backspace`: focus previous focus history entry.

### Layout commands

- `[` / `]`: shorten/tallify focused panel.
- `Space`: title-only toggle.
- `Shift+Up` / `Shift+Down`: move focused panel y upward/downward in its lane.
- Explicit command palette actions for structural changes:
  - reparent focused page
  - make focused page child of selected parent
  - detach from parent
  - move to floating scratchpad

### Why left/right must be graph-aware

In this workspace, horizontal position encodes relation depth. If left/right merely moves to the adjacent lane at similar y, it breaks the graph mental model. Left/right should follow relation intent, not geometry alone.

## Panel Behavior

### Section height and internal scroll

A panel can have finite height and internal scroll, but the overall workspace is bottomless.

This creates two scroll axes:

1. Workspace scroll: moves through the bottomless relation field.
2. Section scroll: moves within one page.

Annotation anchors must account for both. If exact highlighted text is not visible inside a scrolled section, relation lines should fallback gracefully.

### Title-only pages

Title-only is not just collapsed UI. It is a low-mass panel in the relation field.

- It still participates in relation lines.
- It can receive focus.
- It can be dragged or moved.
- It can act as an offscreen/context marker.

### Floating

Floating remains a scratchpad, but in bottomless design it should feel like a temporary orbit, not a separate modal layer.

- Floating panels can still show relation lines back to lanes.
- They may have absolute viewport positions.
- They can be pinned or returned to their lane.

## Search Design Revisions

Search results should not only appear as a list. Search can generate a temporary viewpoint:

- result panels can be pulled into a search lane
- matched text can create temporary semantic tension
- accepting a result can add it to the current bottomless workspace
- search can spawn a new workspace/viewpoint

Chinese search remains important:

1. Normalize full-width/half-width variants and lowercase Latin.
2. Use `Intl.Segmenter('zh')` where available.
3. Add CJK bigram/trigram fallback tokens.
4. Add pinyin initials later.

## Rendering Strategy

The current DOM implementation can remain temporarily, but the bottomless relation field will probably need a cleaner renderer boundary.

Recommended direction:

- Keep current canvas app vanilla.
- Move bottomless tiled workspace toward a renderer island once interactions grow.
- The island owns:
  - lane/page layout
  - relation overlay
  - keyboard focus model
  - layout commands
- It still calls shared app actions for graph mutations and LLM generation.

Important: relation overlay and panel layout must share the same coordinate model. If layout remains imperative DOM, draw relation lines from measured DOM rects. If layout becomes React, use refs/layout effects but keep relation calculation pure where possible.

## Updated Implementation Plan

### Phase A: Reframe existing MVP

- Rename conceptual model from “tiled workspace” to “bottomless relation field.”
- Keep current basic UI as a stepping stone.
- Change left/right keyboard navigation to parent/child relation navigation.
- Add relation cues between visible panels.
- Stop treating cross-column movement as basic navigation.

### Phase B: Bottomless geometry model

- Add `lane` + `page.y` model.
- Migrate existing `columns/pageIds` into lane/page positions.
- Render panels at y positions in bottomless lanes.
- Workspace scroll becomes primary; section scroll remains internal.

### Phase C: Relation overlay

- Draw structural parent-child lines.
- Draw annotation lines using exact visible annotation marks when possible.
- Add focus/hover highlighting and offscreen indicators.
- Add lightweight tension animations.

### Phase D: Layout relaxation

- Initial relation-aware placement: children near parents, annotation children near source anchor.
- Collision avoidance with downward push.
- Optional “relax viewpoint” command.
- Preserve user-placed overrides.

### Phase E: Floating, workspace management, search

- Floating panels with relation lines.
- Workspace duplicate/rename/search-generated viewpoints.
- Chinese fuzzy search and command palette.

## Immediate Code Corrections Needed

The current implementation still has two wrong assumptions from the earlier design:

1. It uses flex columns and page order as primary layout.
2. Arrow left/right currently moves to adjacent columns, but it should navigate parent/child relations.

Before adding more UI features, fix left/right navigation semantics and add visible relation tension cues. Then migrate to bottomless y-positioned lanes.

## References

- i3 User Guide: https://i3wm.org/docs/userguide.html
- Zellij layouts: https://zellij.dev/documentation/layouts.html
- JSON Canvas: https://jsoncanvas.org/
- Logseq: https://github.com/logseq/logseq
- AFFiNE: https://github.com/toeverything/AFFiNE
- BlockSuite: https://github.com/toeverything/BlockSuite
- SiYuan: https://github.com/siyuan-note/siyuan
- Orama Mandarin tokenizer: https://docs.orama.com/docs/orama-js/supported-languages/using-chinese-with-orama
- FlexSearch: https://github.com/nextapps-de/flexsearch
- MiniSearch: https://lucaong.github.io/minisearch/
