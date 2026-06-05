# Research: Fixed-depth document graph/tree column layout under high fan-out

## Summary
For RhizoDoc’s tiled relation field, the strongest precedent is a hybrid of **Miller columns** for hard structural invariants and **focus+context / DOI lenses** for temporary attention management. The key design rule is directional: when a **child is focused**, its parent and active path should be kept near the child as context; when a **parent is focused**, its entire child fan-out must remain an ordered list/field, not become many equal strong springs pulling toward the parent. Treat depth, order, non-overlap, active-path visibility, and bounded whitespace as invariants; treat magnification, local alignment, level-of-detail, elision, and sticky context as focus lenses.

## Findings
1. **Use fixed depth columns as the hard spatial grammar.** Miller/column browsers show exactly one hierarchy level per vertical column: selecting a row in one column reveals its children in the next, preserving parent-child context across adjacent columns. Apple’s HIG describes column views as a hierarchy browser with root in the first column, child disclosure in the next column, resizable columns, and preview/detail when a leaf has no children. This is the right base for RhizoDoc because depth columns are semantic and high fan-out is handled as a list in a level-specific pane instead of as a sprawling node-link tree. [Apple HIG: Column views](https://developer.apple.com/design/human-interface-guidelines/column-views), [Miller columns overview](https://en.wikipedia.org/wiki/Miller_columns)

2. **Separate structural selection from visual interest.** Furnas’s generalized fisheye model defines interest as `DOI(x | focus) = API(x) - D(x, focus)`: intrinsic importance minus distance from the current focus. The design implication is that focus should alter what is enlarged, detailed, elided, or aligned, but it should not rewrite the tree’s structural relationships. In RhizoDoc terms: graph depth and per-column stack order remain content/viewpoint invariants; DOI only drives render-time attention such as expansion, label detail, opacity, sticky path context, and soft alignment weights. [Furnas, Generalized Fisheye Views](https://dl.acm.org/doi/pdf/10.1145/22627.22342)

3. **DOITrees support bounded, multi-focal, semantic focus+context—not free floating layout.** DOITrees and DOITrees Revisited use degree-of-interest to keep important nodes, ancestors, and selected branches visible while compressing or aggregating low-interest subtrees in bounded display space. Heer and Card’s TreeBlock work is especially relevant: sibling/subtree regions can be treated as blocks, and low-interest parts can be summarized instead of individually expanded. The principle for RhizoDoc is to allocate screen space to high-interest branches while keeping low-interest siblings as compact ordered context, never allowing weak relations to accumulate into unbounded whitespace. [DOITrees Revisited PDF](https://idl.cs.washington.edu/files/2004-DOITree-AVI.pdf), [Stanford Vis: DOITrees Revisited](http://vis.stanford.edu/papers/doitrees-revisited)

4. **Accordion/focus+context drawings argue for guaranteed visibility of landmarks.** TreeJuxtaposer’s accordion drawing uses rectilinear focus+context distortion and a “guaranteed visibility” idea for important landmarks even when the full tree is too large. RhizoDoc should adopt this as an invariant for the current focus, active ancestor path, search hits, and pinned/annotated landmarks: they may become compact markers, but they should not disappear merely because a high-fan-out sibling list is being browsed. [TreeJuxtaposer project page](https://www.cs.ubc.ca/~tmm/papers/tj/), [ACM entry](https://dl.acm.org/doi/10.1145/882262.882291)

5. **Table Lens gives the row/column lesson: distort level of detail, not scannability.** Table Lens merges symbolic detail in focused rows/columns with compressed graphical context elsewhere. The relevant transferable principle is orthogonality: rows and columns remain readable scan axes while focus changes row heights/details. For RhizoDoc, fixed depth columns and ordered vertical stacks should remain visually straight and sortable; the lens can expand the focused node, show richer content, or compress remote siblings, but it should not bend columns or scramble row order. [Rao & Card, The Table Lens PDF](https://www.cs.kent.edu/~jmaletic/cs63903/papers/Rao94.pdf)

6. **The central bug pattern is treating “focused parent” as N strong child-alignment constraints.** In a high-fan-out parent with 50 children, giving every child a strong attraction to the parent collapses the child column around the parent and destroys the sibling traversal field. The correct model distinguishes two relation modes: **active-path alignment** and **fan-out membership**. A focused child creates a strong active-path alignment to its parent; a focused parent creates a child-list context with bounded budget, not one full-strength alignment spring per child.

7. **Parent context should follow the focused child, but children should not all follow the focused parent.** When traversing siblings in a child column, the focused child is the active item; its parent is context. Therefore the parent column should apply a sticky/context lens so the parent’s visible center stays near the child’s screen center, preserving “where did this child come from?” When the parent itself is focused, the child column should show a stable ordered fan-out around either the previous active child cursor, the first/highest-interest child, or a neutral list start—not collapse all children to the parent’s y-coordinate.

8. **Whitespace is a scarce budget, not a relation-force byproduct.** RhizoDoc’s elastic ordered stacks already have the right mathematical shape: hard non-overlap/order constraints plus soft desired positions. The missing design principle is budget normalization. Each column should receive a limited whitespace/lens budget; each parent’s fan-out should receive a capped total influence regardless of degree. This prevents a node with many children from producing more total vertical force than a node with one child.

9. **Use elision and summary glyphs for remote fan-out instead of moving everything.** DOITrees and focus+context browsers commonly compress or aggregate low-interest subtrees. For RhizoDoc, remote siblings can remain in order as title-only rows, small markers, count bands, or virtualized compact rows. This is preferable to inserting huge gaps or stacking all children near a parent because it preserves both traversal and context.

10. **For knowledge-graph/DAG relations, keep tree columns primary and graph relations secondary.** RhizoDoc is a document DAG, not a pure tree. The column projection should still use primary depth/minimum reachable depth for the tiled view; backlinks, annotations, semantic matches, and non-tree DAG edges should add focus-lens pulls and landmarks with capped weights. Annotation edges can be stronger than ordinary structural edges because they refer to exact spans, but they should still be budgeted so they do not override depth/order invariants.

## Design principles for RhizoDoc

### Hard invariants
- **Depth is semantic:** a node’s tiled column is determined by projected graph depth; focus never moves a node across columns.
- **Stack order is stable:** each depth column has one deterministic ordered stack. Focus may add temporary spacing or level-of-detail changes but does not reorder siblings unless the user explicitly swaps/reorders.
- **No overlap:** panels obey `y[i+1] >= y[i] + height[i] + minGap`.
- **Bounded elastic whitespace:** automatic gaps are render-derived, capped, and recomputed from current focus/relations; they are not persisted manual coordinates.
- **Active path is visible:** current focus, ancestors, and selected landmarks/search hits remain visible as full panels or compact markers.
- **High fan-out does not multiply force:** a parent with many children has a capped total child-column influence.
- **Scrolling/traversal stays stable:** moving through siblings should not cause unrelated columns to thrash or cause all children to re-pack around a parent.

### Focus-lens behavior
- **Child-focused lens:** strong alignment from focused child to parent/active ancestors; parent column may add whitespace or sticky offset so the parent appears near the focused child.
- **Parent-focused lens:** child column enters fan-out browsing mode. Children receive visibility/list DOI, not equal strong alignment. The child list remains ordered and compact, with optional local expansion near a remembered child cursor or top-ranked child.
- **Annotation-focused lens:** source span and target node get stronger alignment than ordinary parent-child edges, but still within a per-relation-type budget.
- **Search/pin lens:** search hits and pinned nodes get guaranteed markers and moderate DOI boosts; they should not override the active path unless selected.
- **Level-of-detail lens:** focus controls panel display mode, label detail, preview expansion, and elision before it controls large geometric movement.

## Parent-child active path vs. all children

Use two distinct relation states:

1. **Active path relation** — a single chain or small set of selected/visited relations that answers “where am I?” Example: `Root → Parent → FocusedChild`. These relations may create strong alignment constraints across adjacent columns.
2. **Fan-out relation** — the complete child set of a parent that answers “what else is here?” These children should be shown as an ordered field/list with compact context, grouping, filtering, and local focus. They should not each create a full-strength alignment target.

This distinction resolves the core problem:
- If focus is `Child 37`, then `Parent` is part of the active path, so the parent column should stay near `Child 37`.
- If focus is `Parent`, then `Child 1..N` are fan-out context, not an active path. The child column should preserve list traversal, not collapse `Child 1..N` toward the parent.

## Whitespace allocation

Allocate whitespace in three layers:

1. **Base compact stack:** deterministic packed positions using measured heights and `minGap`.
2. **Lens budget:** a bounded extra vertical budget per column for active-path alignment, annotation spans, search/pin landmarks, and local focus expansion.
3. **Elision/LOD before geometry:** if the desired context does not fit, reduce detail, title-collapse, summarize, or virtualize remote siblings before increasing gaps.

Practical policies:
- Cap per-column extra whitespace, e.g. `extraGapBudget = min(viewportHeight * 0.75, columnContentHeight * 0.25)`.
- Cap per-parent fan-out influence, e.g. all children of a focused parent share one total weight budget.
- Use saturating weights: two strong relations should matter more than one, but 100 weak sibling relations should not create 100x force.
- Prefer keeping the active path near the viewport’s focus rail over perfectly aligning every edge.

## Concrete algorithm sketch

```text
Inputs:
  graph nodes/edges/annotations
  projected depth columns with ordered pageIds
  measured panel heights
  focus node f
  previous active child cursor per parent, optional
  viewport focus rail yFocus, e.g. 45%-55% viewport height

1. Project columns
  - compute primary depth from root/min reachable depth
  - keep persisted order only inside the matching depth
  - append new nodes deterministically

2. Compute base stack positions per column
  yBase[i+1] = yBase[i] + height[i] + minGap

3. Build relation state
  activePath = ancestors(root..f) plus f
  if f is a child: mark edge parent(f) -> f as ACTIVE_PATH
  if f is a parent: mark children(f) as FANOUT_CONTEXT, not ACTIVE_PATH
  mark annotation/search/pinned landmarks separately

4. Compute DOI/LOD scores
  doi(n) = api(n)
         + activePathBoost(n)
         + focusBoost(n == f)
         + annotationBoost(n)
         + searchPinBoost(n)
         - graphDistancePenalty(n, f)
         - depthDistancePenalty(n, f)
  Use DOI for display mode, elision, opacity, and marker priority.
  Do not directly convert every edge to an alignment spring.

5. Build alignment targets with budgets
  For each active-path edge parent -> child:
    add target: center(parent) ~= center(child) with strong weight
  For focused child f:
    add sticky target: parent(f) screen center ~= f screen center
  For focused parent f:
    choose child browsing anchor:
      previousActiveChild(f) if valid, else first visible/highest DOI child
    add only a weak/local target for that anchor or a small top-K window
    distribute remaining child interest as LOD/markers, not alignment
  For annotations:
    add span/node targets with capped annotation budget
  Normalize weights:
    totalWeightByColumn <= columnBudget
    totalFanoutWeight(parent) <= fanoutBudget, independent of child count

6. Solve each column as an elastic ordered stack
  For each panel i:
    desiredY[i] = weightedAverage(yBase[i], relationTargets[i], stickyTargets[i])
    weight[i] = baseWeight + cappedRelationWeight[i]
  Solve:
    minimize Σ weight[i] * (y[i] - desiredY[i])²
    subject to y[i+1] >= y[i] + height[i] + minGap
  Implementation fit: subtract cumulative heights/gaps and run weighted PAVA/isotonic regression.

7. Apply viewport/sticky context lens
  - If focused child is moving through siblings, allow adjacent parent column to scroll/offset or insert bounded whitespace so active parent remains near yFocus/focused child.
  - Do not persist this offset as manual gap state.
  - Animate transitions with ease-in/ease-out so users can track movement.

8. Render LOD and elision
  - focus/current path: full or normal panels
  - near siblings: compact/title panels
  - remote fan-out: title-only, count bands, or markers
  - guaranteed landmarks: at least visible marker/rail tick
```

## Implications for RhizoDoc's elastic ordered stacks

- The existing PAVA-style ordered-stack solver is appropriate and should remain the core; the design change is in **target construction and weight budgeting**, not in making panels free-floating.
- Add relation classes before layout: `ACTIVE_PATH`, `FANOUT_CONTEXT`, `ANNOTATION`, `SEARCH_PIN`, `SEMANTIC_WEAK`.
- Add per-parent fan-out budget normalization so a parent with many children cannot dominate the child column.
- Add a remembered `activeChildCursor[parentId]` or derive it from focus history. This lets a parent-focused view open its child fan-out near the child the user was just reading without treating all children as focused.
- Treat parent-context alignment as directional: child focus may pull/stick parent context; parent focus may reveal child list, but not pull all children.
- Prefer semantic zoom/LOD and compact markers over large gaps for remote siblings.
- Keep ordinary scrolling separate from canonical layout solving; recompute elastic gaps on focus, order, height/display, graph, and annotation changes, not on every scroll tick.

## Sources
- Kept: Apple Human Interface Guidelines — Column views (https://developer.apple.com/design/human-interface-guidelines/column-views) — official guidance for multi-column hierarchy browsing, selection, child disclosure, resizing, and preview columns.
- Kept: Miller columns (https://en.wikipedia.org/wiki/Miller_columns) — concise history and definition of adjacent-column hierarchy navigation for high fan-out/deep trees.
- Kept: Furnas, “Generalized Fisheye Views” (https://dl.acm.org/doi/pdf/10.1145/22627.22342) — original DOI model separating a priori importance from distance to focus.
- Kept: Heer & Card, “DOITrees Revisited” PDF (https://idl.cs.washington.edu/files/2004-DOITree-AVI.pdf) — scalable, bounded DOI tree layout and TreeBlock concepts.
- Kept: Stanford Vis page for DOITrees Revisited (http://vis.stanford.edu/papers/doitrees-revisited) — canonical project/publication page.
- Kept: Munzner et al., TreeJuxtaposer project page (https://www.cs.ubc.ca/~tmm/papers/tj/) — accordion drawing and guaranteed-visibility focus+context precedent.
- Kept: ACM TreeJuxtaposer entry (https://dl.acm.org/doi/10.1145/882262.882291) — publication record for scalable tree comparison with focus+context and guaranteed visibility.
- Kept: Rao & Card, “The Table Lens” PDF (https://www.cs.kent.edu/~jmaletic/cs63903/papers/Rao94.pdf) — focus+context row/column design with symbolic detail in focus and compressed context.
- Kept: Elastic Hierarchies PDF (https://profs.etsmtl.ca/mmcguffin/research/elasticHierarchies/elasticHierarchies.pdf) — useful background on mixing representations to reduce whitespace, though less directly applicable than column/fisheye sources.
- Dropped: Medium/SEO-style Miller column articles — useful illustrations but weaker than Apple HIG and established summaries.
- Dropped: Reddit/Quora/Dribbble design discussions — anecdotal and not load-bearing for layout principles.
- Dropped: Generic knowledge-graph visualization marketing pages — too broad; RhizoDoc’s problem is columnar tree/DAG projection with high fan-out, not general graph hairball layout.

## Gaps
- I did not find a single prior system with exactly RhizoDoc’s combination of fixed graph-depth columns, ordered elastic stacks, annotation-span relations, and PAVA layout. The brief therefore synthesizes from adjacent, well-established techniques.
- TreeJuxtaposer details should be checked directly from the PDF if exact algorithmic constraints are needed; the design-level concept of accordion focus+context and guaranteed visibility is sufficiently supported.
- The next validation step should be prototyping two interaction traces: (1) focus child 1→50 while parent column remains sticky nearby; (2) focus parent with 50 children and confirm children remain a traversable ordered list rather than collapsing.

## Supervisor coordination
No supervisor contact was needed; the task was research-only and not blocked.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Produced the requested design research brief only, focused on UI/layout principles and an algorithm sketch for fixed-depth high-fan-out document graph/tree columns. No implementation scope was widened."
    }
  ],
  "changedFiles": [
    "/home/disk/Projects/RhizoDoc/research.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "grok_search: DOITree/degree-of-interest tree focus context browser high fanout",
      "result": "passed",
      "summary": "Found DOI/DOITree sources including Heer & Card DOITrees Revisited and Card/Nation DOI Trees."
    },
    {
      "command": "grok_search: Miller columns column browser high fanout hierarchy",
      "result": "passed",
      "summary": "Found Miller columns and Apple column view sources for fixed-depth adjacent column navigation."
    },
    {
      "command": "grok_search: TreeJuxtaposer accordion drawing guaranteed visibility",
      "result": "passed",
      "summary": "Found TreeJuxtaposer project and ACM sources for accordion focus+context and guaranteed visibility."
    },
    {
      "command": "grok_search/gemini_search: Table Lens and Furnas generalized fisheye DOI",
      "result": "passed",
      "summary": "Extracted DOI formula and focus+context row/column principles."
    },
    {
      "command": "read: docs/tiled-workspace-design.md",
      "result": "passed",
      "summary": "Reviewed RhizoDoc tiled relation field assumptions and elastic ordered-stack/PAVA design."
    },
    {
      "command": "write: /home/disk/Projects/RhizoDoc/research.md",
      "result": "passed",
      "summary": "Wrote the requested research brief to the specified file."
    }
  ],
  "validationOutput": [
    "research.md contains Summary, Findings, Sources, Gaps, Supervisor coordination, concrete algorithm sketch, and acceptance report."
  ],
  "residualRisks": [
    "No shell tool was available to run git status; no files were intentionally staged by the available file-write tool.",
    "Some ACM PDFs may require institutional access; public project/PDF mirrors were included where available."
  ],
  "noStagedFiles": true,
  "notes": "Research-only task completed; no tests were applicable."
}
```
