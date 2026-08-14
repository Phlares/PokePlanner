# Workbench UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the planner around a sticky milestone team strip, synchronized Routes/Pokémon navigation, milestone-scoped grouped search, a read-only inspector, automatic member comparison, capability tokens, and usable desktop/mobile layouts.

**Architecture:** A unified workbench controller owns ephemeral navigation while the completed timeline domain remains the sole durable source for progress, planning target and team state. Pure selectors create grouped results, acquisition evidence, capability highlights and comparisons; focused React components render those view models without coordinating each other through effects.

**Tech Stack:** Node.js 22.17.1, npm 11.5.1, React 19.2.7, TypeScript 7.0.2, Vite 8.1.5, Vitest 4.1.10, Testing Library 16.3.2, Zod 4.4.3, Playwright Test 1.62.1.

**Spec:** `dev/docs/superpowers/specs/2026-08-14-workbench-ux-overhaul-design.md`

## Global Constraints

- Read this spec and `2026-08-13-milestone-team-timeline-design.md` before Task 1.
- Start only after every handoff gate in `2026-08-14-milestone-team-timeline.md` passes.
- Use TDD for every behavior and keep each task independently reviewable.
- Timeline state is durable; search, folds, selections, comparison and sheets are ephemeral.
- The inspector browses species and candidates; it never edits an owned member directly.
- Search results, route detail, inspector and comparison derive from one controller state.
- Replacement sends the outgoing member to reserve; release is explicit and separate.
- Utility comparison is advisory and limited to field-move/capability loss.
- Preserve the static production architecture and immutable pack boundary.
- Preserve the monochrome, square, text-forward wireframe language.
- Essential information and interactions must work without hover.
- Do not add IV/EV planning, exact stats, battle simulation or hosted sharing.
- Commit each task only after focused tests and its required full check pass.
- After Task 11, run `/simplify` as one combined inline pass and one inline `/code-review` medium pass. Address findings, rerun verification, then make one final review-fix commit if needed. Do not launch workflow review.

## Locked file structure

```text
dev/src/features/workbench/
  controller.ts                 # Ephemeral state reducer and explicit actions.
  controller.test.ts
  selectors.ts                  # Milestone grouping and selection-safe view models.
  selectors.test.ts
  WorkbenchShell.tsx
  WorkbenchShell.test.tsx
  TeamStrip.tsx
  TeamStrip.test.tsx
  WorkbenchToolbar.tsx
  WorkbenchToolbar.test.tsx
  MilestoneResults.tsx
  MilestoneResults.test.tsx
  RouteDetail.tsx
  RouteDetail.test.tsx
  PokemonLocations.tsx
  PokemonLocations.test.tsx
  PokemonInspector.tsx
  PokemonInspector.test.tsx
  MemberComparison.tsx
  MemberComparison.test.tsx
  MemberContextMenu.tsx
  MemberContextMenu.test.tsx
  RunMenu.tsx
  RunMenu.test.tsx
  MobileInspectorSheet.tsx
  MobileInspectorSheet.test.tsx
dev/src/domain/workbench/
  search.ts
  search.test.ts
  comparison.ts
  comparison.test.ts
dev/e2e/workbench.spec.ts
dev/playwright.config.ts
```

---

### Task 1: Create the unified workbench controller

**Files:**
- Create: `dev/src/features/workbench/controller.ts`
- Create: `dev/src/features/workbench/controller.test.ts`
- Modify: `dev/src/features/workbench/Workbench.tsx`
- Modify: `dev/src/features/workbench/Workbench.test.tsx`

**Interfaces:**
- Consumes: durable planning target/current progress and pack node IDs.
- Produces: `WorkbenchState`, `WorkbenchAction`, `createWorkbenchState`, `reduceWorkbench`, `sanitizeWorkbenchState`.

- [ ] **Step 1: Write failing synchronization tests**

```ts
it('selecting a species switches modes and clears stale route detail', () => {
  const state = reduceWorkbench(initial, { type: 'candidate-selected', pokemonId: 56 });
  expect(state.mode).toBe('pokemon');
  expect(state.candidatePokemonId).toBe(56);
  expect(state.detail.kind).toBe('pokemon-locations');
});

it('retains a candidate when its location opens', () => {
  const state = reduceWorkbench(withCandidate(56), { type: 'candidate-location-selected', nodeId: 'route-22' });
  expect(state.candidatePokemonId).toBe(56);
  expect(state.detail).toEqual({ kind: 'route', nodeId: 'route-22' });
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/features/workbench/controller.test.ts src/features/workbench/Workbench.test.tsx`

Expected: FAIL because the controller does not exist.

- [ ] **Step 3: Implement reducer-only navigation**

```ts
export interface WorkbenchState {
  mode: 'routes' | 'pokemon';
  milestoneFilter: boolean;
  query: SearchQuery;
  openMilestoneIds: ReadonlySet<string>;
  lastRouteId: string | null;
  candidatePokemonId: number | null;
  selectedMemberId: string | null;
  detail: { kind: 'route'; nodeId: string } | { kind: 'pokemon-locations' } | { kind: 'empty' };
  sheet: 'closed' | 'inspector' | 'comparison';
}
```

Use one `useReducer` in `Workbench`. Remove local route, candidate, search-active and temporary member-draft state. Planning-target changes call the timeline domain and then sanitize ephemeral selections.

- [ ] **Step 4: Run focused tests**

Run: `npm run test -- src/features/workbench/controller.test.ts src/features/workbench/Workbench.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/features/workbench/controller.ts dev/src/features/workbench/controller.test.ts dev/src/features/workbench/Workbench.tsx dev/src/features/workbench/Workbench.test.tsx
git commit -m "refactor: unify workbench navigation"
```

---

### Task 2: Group routes by milestone and search state

**Files:**
- Create: `dev/src/features/workbench/selectors.ts`
- Create: `dev/src/features/workbench/selectors.test.ts`
- Create: `dev/src/domain/workbench/search.ts`
- Create: `dev/src/domain/workbench/search.test.ts`
- Modify: `dev/src/domain/search.ts`
- Modify: `dev/src/domain/search.test.ts`

**Interfaces:**
- Produces: `MilestoneResultGroup`, `GroupedWorkbenchResults`, `selectMilestoneResults`, `searchWorkbench`.

- [ ] **Step 1: Write failing exact-order tests**

```ts
it('orders future teaser, matching groups, then one no-match summary', () => {
  const result = selectMilestoneResults(fixture({ target: 10, matches: [1, 11] }));
  expect(result.sections.map((section) => section.kind)).toEqual([
    'future-teaser', 'matching-milestone', 'no-match-summary',
  ]);
  expect(result.sections[1]).toMatchObject({ milestoneIndex: 1, expanded: true });
});

it('sorts routes closest to the milestone first', () => {
  expect(groupToBrock.routes.map((route) => route.nodeId)).toEqual(['pewter-city', 'viridian-forest', 'route-2']);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/features/workbench/selectors.test.ts src/domain/workbench/search.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement grouped view models**

```ts
export interface GroupedWorkbenchResults {
  sections: readonly (
    | { kind: 'future-teaser'; matchCount: number; milestoneIds: readonly string[]; expanded: boolean }
    | { kind: 'matching-milestone'; milestoneId: string; expanded: true; routes: readonly RouteResult[] }
    | { kind: 'no-match-summary'; hiddenMilestoneIds: readonly string[]; expanded: boolean }
  )[];
  totalPokemon: number;
  totalRoutes: number;
}
```

Apply milestone scope first, query indexes second, grouping third, and reverse chronological order last. Do not globally truncate at 50. Route rows include matching Pokémon, acquisition method and exact-match state.

- [ ] **Step 4: Run selector/search tests**

Run: `npm run test -- src/features/workbench/selectors.test.ts src/domain/workbench/search.test.ts src/domain/search.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/features/workbench/selectors.ts dev/src/features/workbench/selectors.test.ts dev/src/domain/workbench dev/src/domain/search.ts dev/src/domain/search.test.ts
git commit -m "feat: group milestone search results"
```

---

### Task 3: Resolve milestone briefings and capability search

**Files:**
- Modify: `dev/src/domain/workbench/search.ts`
- Modify: `dev/src/domain/workbench/search.test.ts`
- Modify: `dev/src/domain/timeline/capabilities.ts`
- Modify: `dev/src/domain/timeline/capabilities.test.ts`
- Modify: `dev/src/domain/rules/game-rules.ts`
- Modify: `dev/src/domain/rules/firered-rules.ts`

**Interfaces:**
- Produces: `MilestoneBriefing`, `CapabilityHighlight`, `selectMilestoneBriefing`, capability queries.

- [ ] **Step 1: Write failing evidence tests**

```ts
it('keeps milestone briefings terse and searchable', () => {
  expect(selectMilestoneBriefing('koga-gym', context)).toEqual({
    requires: expect.arrayContaining([expect.objectContaining({ id: 'surf', label: 'Surf' })]),
    unlocks: expect.arrayContaining([expect.objectContaining({ id: 'safari-zone', label: 'Safari Zone' })]),
  });
});

it('uses one capability state across party, reserve and candidates', () => {
  const result = searchCapability('surf', resolvedNode, pack, rules);
  expect(result.party.m1.state).toBe('knows');
  expect(result.reserve.m2.state).toBe('can-now');
  expect(result.candidates[56].state).toBe('conditional');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/domain/workbench/search.test.ts src/domain/timeline/capabilities.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement reusable evidence**

Briefing tokens contain `{ id, label, kind, searchQuery }`. All surfaces reference shared `CapabilityEvidence`; UI components never recalculate state. Reserve summary exposes aggregate counts and matching member IDs.

- [ ] **Step 4: Run capability/rules tests**

Run: `npm run test -- src/domain/workbench/search.test.ts src/domain/timeline/capabilities.test.ts src/domain/rules/firered-rules.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/domain/workbench/search.ts dev/src/domain/workbench/search.test.ts dev/src/domain/timeline/capabilities.ts dev/src/domain/timeline/capabilities.test.ts dev/src/domain/rules
git commit -m "feat: search milestone capabilities"
```

---

### Task 4: Build viewport shell, team strip and run menu

**Files:**
- Create: `dev/src/features/workbench/WorkbenchShell.tsx`
- Create: `dev/src/features/workbench/WorkbenchShell.test.tsx`
- Create: `dev/src/features/workbench/TeamStrip.tsx`
- Create: `dev/src/features/workbench/TeamStrip.test.tsx`
- Create: `dev/src/features/workbench/RunMenu.tsx`
- Create: `dev/src/features/workbench/RunMenu.test.tsx`
- Modify: `dev/src/App.tsx`
- Modify: `dev/src/App.test.tsx`
- Modify: `dev/src/features/workbench/Workbench.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- Consumes: controller, resolved timeline node, save status, JSON and plan-code actions.
- Produces: header/team/search/workspace hierarchy and party selection events.

- [ ] **Step 1: Write failing shell tests**

```tsx
it('places the team before workspace content', () => {
  renderShell();
  const regions = screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'));
  expect(regions.indexOf('Team at Brock')).toBeLessThan(regions.indexOf('Workbench results'));
});

it('moves run data into one menu', async () => {
  renderShell();
  expect(screen.queryByLabelText('Playthrough export JSON')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Run menu' }));
  expect(screen.getByRole('menuitem', { name: 'Download JSON' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Copy plan code' })).toBeInTheDocument();
});

it('previews file, code and share-url imports before replacing a run', async () => {
  renderShell();
  await openRunMenuAndPaste(planCodeShareUrl);
  expect(screen.getByRole('dialog', { name: 'Import FireRed Run?' })).toHaveTextContent('12 Pokémon');
  expect(onImport).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/features/workbench/WorkbenchShell.test.tsx src/features/workbench/TeamStrip.test.tsx src/features/workbench/RunMenu.test.tsx src/App.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement semantic shell**

Use header, menu, regions and real buttons. TeamStrip emits selection only. RunMenu uses plan-1 persistence helpers, accepts JSON files, plan codes and share URLs, always shows an import preview before confirmation, and shows temporary/unsaved status. Remove the current `app-tools` rungs.

- [ ] **Step 4: Run shell and full checks**

Run: `npm run test -- src/features/workbench/WorkbenchShell.test.tsx src/features/workbench/TeamStrip.test.tsx src/features/workbench/RunMenu.test.tsx src/App.test.tsx && npm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/features/workbench dev/src/App.tsx dev/src/App.test.tsx dev/src/styles.css
git commit -m "feat: center workbench on team planning"
```

---

### Task 5: Render toolbar and milestone result groups

**Files:**
- Create: `dev/src/features/workbench/WorkbenchToolbar.tsx`
- Create: `dev/src/features/workbench/WorkbenchToolbar.test.tsx`
- Create: `dev/src/features/workbench/MilestoneResults.tsx`
- Create: `dev/src/features/workbench/MilestoneResults.test.tsx`
- Modify: `dev/src/features/search/FireRedSearch.tsx`
- Modify: `dev/src/features/search/FireRedSearch.test.tsx`
- Modify: `dev/src/features/workbench/Workbench.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- Consumes: grouped results and controller actions.
- Produces: controlled filters, mode toggle, milestone filter, future teaser, matches and no-match summary.

- [ ] **Step 1: Write failing interaction tests**

```tsx
it('renders matches without individual no-match milestones', () => {
  renderResults(searchFixture());
  expect(screen.getByRole('button', { name: '1 match after milestone 10' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Milestone 1 · 1 match' })).toBeInTheDocument();
  expect(screen.getByText('Milestones 2–10 hidden · no matches')).toBeInTheDocument();
  expect(screen.queryByText('Milestone 5')).not.toBeInTheDocument();
});

it('turns a briefing token into search', async () => {
  renderToolbar();
  await user.click(screen.getByRole('button', { name: 'Search for Surf' }));
  expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ query: { capability: 'surf' } }));
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/features/workbench/WorkbenchToolbar.test.tsx src/features/workbench/MilestoneResults.test.tsx src/features/search/FireRedSearch.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement controlled search/results**

Refactor `FireRedSearch` into controlled fields; it no longer owns results or hides progression. Use buttons/details with accurate `aria-expanded`. Exact matches have text plus styling. Announce totals with `aria-live="polite"` without moving focus.

- [ ] **Step 4: Run search and workbench tests**

Run: `npm run test -- src/features/workbench/WorkbenchToolbar.test.tsx src/features/workbench/MilestoneResults.test.tsx src/features/search src/features/workbench/Workbench.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/features/workbench dev/src/features/search dev/src/styles.css
git commit -m "feat: navigate grouped route results"
```

---

### Task 6: Synchronize Route Detail and Pokémon Where & When

**Files:**
- Create: `dev/src/features/workbench/RouteDetail.tsx`
- Create: `dev/src/features/workbench/RouteDetail.test.tsx`
- Create: `dev/src/features/workbench/PokemonLocations.tsx`
- Create: `dev/src/features/workbench/PokemonLocations.test.tsx`
- Modify: `dev/src/features/workbench/EncounterTable.tsx`
- Modify: `dev/src/features/workbench/EncounterTable.test.tsx`
- Modify: `dev/src/features/workbench/Workbench.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- Consumes: selected detail/candidate and route/acquisition selectors.
- Produces: route evidence and chronological acquisition locations without losing candidate context.

- [ ] **Step 1: Write failing cross-mode tests**

```tsx
it('opens Where & When for a selected species', async () => {
  renderWorkbench();
  await user.click(screen.getByRole('button', { name: 'Mankey' }));
  expect(screen.getByRole('heading', { name: 'Mankey · Where & When' })).toBeInTheDocument();
  expect(screen.getByText('Route 22')).toBeInTheDocument();
});

it('opens route evidence and retains the candidate', async () => {
  renderLocations(56);
  await user.click(screen.getByRole('button', { name: 'Inspect Mankey at Route 22' }));
  expect(screen.getByRole('heading', { name: 'Route 22' })).toBeInTheDocument();
  expect(screen.getByRole('complementary', { name: 'Mankey inspector' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/features/workbench/RouteDetail.test.tsx src/features/workbench/PokemonLocations.test.tsx src/features/workbench/EncounterTable.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement synchronized details**

RouteDetail renders access state, gates, acquisitions and encounter areas. PokemonLocations combines reverse-route index and special acquisitions in progression order. Encounter rows receive match/capability evidence and remain semantic tables.

- [ ] **Step 4: Run detail/workbench tests**

Run: `npm run test -- src/features/workbench/RouteDetail.test.tsx src/features/workbench/PokemonLocations.test.tsx src/features/workbench/EncounterTable.test.tsx src/features/workbench/Workbench.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/features/workbench dev/src/styles.css
git commit -m "feat: connect routes and pokemon locations"
```

---

### Task 7: Rebuild the inspector as a candidate surface

**Files:**
- Modify: `dev/src/features/workbench/PokemonInspector.tsx`
- Modify: `dev/src/features/workbench/PokemonInspector.test.tsx`
- Modify: `dev/src/features/workbench/MoveAvailability.tsx`
- Modify: `dev/src/features/workbench/MoveAvailability.test.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- Produces: read-only Overview/Moves/Where presentation and Add/Compare actions; removes `MemberDraft`.

- [ ] **Step 1: Write failing inspector tests**

```tsx
it('shows both directions of the evolution chain', () => {
  renderInspector(5);
  expect(screen.getByText('Evolves from Charmander')).toBeInTheDocument();
  expect(screen.getByText('Evolves to Charizard · Level 36')).toBeInTheDocument();
});

it('labels move class and attacking stat', () => {
  renderInspector(56);
  expect(screen.getByText('Karate Chop')).toHaveAccessibleDescription('Physical move · uses Attack');
});

it('does not edit owned-member level', () => {
  renderInspector(56);
  expect(screen.queryByLabelText('Planned level')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/features/workbench/PokemonInspector.test.tsx src/features/workbench/MoveAvailability.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement the two-column inspector**

Remove local draft state. Use target context for availability. Show base stats and optional nature metadata; keep level-50/100 ranges collapsed and labeled as reference ranges. Render historical move damage class and relevant attacking stat.

- [ ] **Step 4: Run inspector tests**

Run: `npm run test -- src/features/workbench/PokemonInspector.test.tsx src/features/workbench/MoveAvailability.test.tsx src/domain/availability.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/features/workbench/PokemonInspector.tsx dev/src/features/workbench/PokemonInspector.test.tsx dev/src/features/workbench/MoveAvailability.tsx dev/src/features/workbench/MoveAvailability.test.tsx dev/src/styles.css
git commit -m "refactor: separate pokemon inspection"
```

---

### Task 8: Compare candidates and warn about capability loss

**Files:**
- Create: `dev/src/domain/workbench/comparison.ts`
- Create: `dev/src/domain/workbench/comparison.test.ts`
- Create: `dev/src/features/workbench/MemberComparison.tsx`
- Create: `dev/src/features/workbench/MemberComparison.test.tsx`
- Modify: `dev/src/features/workbench/Workbench.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- Produces: `compareMemberCandidate`, `MemberComparisonView`, `CapabilityLoss`.

- [ ] **Step 1: Write failing comparison tests**

```ts
it('shows stat and move-class differences', () => {
  const diff = compareMemberCandidate(nidorinoMember(), pikachuCandidate(), context);
  expect(diff.stats.attack).toEqual({ before: 72, after: 55, delta: -17 });
  expect(diff.moveClasses.after).toEqual({ physical: 0, special: 1, status: 3 });
});

it('warns when replacement removes the only active Cut user', () => {
  expect(compareCutUser().capabilityLosses).toContainEqual(expect.objectContaining({
    capabilityId: 'cut', severity: 'yellow', retainedByParty: false, candidateState: 'none',
  }));
});

it('identifies reserve help without counting it as active', () => {
  expect(compareWithReserveSolution().capabilityLosses[0]).toMatchObject({
    retainedByParty: false, reserveMemberIds: ['farfetchd-1'],
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/domain/workbench/comparison.test.ts src/features/workbench/MemberComparison.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement pure diff and confirmation UI**

Include types, abilities, base stats, nature, exact moves, damage classes and existing findings. Utility includes only capabilities known by the outgoing member and missing from remaining party. Confirmation uses timeline `placeInParty`, sending the outgoing member to reserve. Never block.

- [ ] **Step 4: Run comparison/workbench tests**

Run: `npm run test -- src/domain/workbench/comparison.test.ts src/features/workbench/MemberComparison.test.tsx src/features/workbench/Workbench.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/domain/workbench/comparison.ts dev/src/domain/workbench/comparison.test.ts dev/src/features/workbench/MemberComparison.tsx dev/src/features/workbench/MemberComparison.test.tsx dev/src/features/workbench/Workbench.tsx dev/src/styles.css
git commit -m "feat: compare party replacements"
```

---

### Task 9: Add accessible party context actions

**Files:**
- Create: `dev/src/features/workbench/MemberContextMenu.tsx`
- Create: `dev/src/features/workbench/MemberContextMenu.test.tsx`
- Modify: `dev/src/features/workbench/TeamStrip.tsx`
- Modify: `dev/src/features/workbench/TeamStrip.test.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- Produces: Edit/Compare/Reserve/Release through mouse, keyboard, visible overflow and touch-compatible entry.

- [ ] **Step 1: Write failing input-equivalence tests**

```tsx
it.each(['contextmenu', 'Shift+F10'])('opens identical actions through %s', async (gesture) => {
  renderTeamStrip();
  await openMenu(gesture, 'Mankey #1');
  expect(screen.getByRole('menuitem', { name: 'Edit at Misty' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Move to reserve' })).toBeInTheDocument();
  expect(screen.getByRole('menuitem', { name: 'Release…' })).toBeInTheDocument();
});

it('confirms release', async () => {
  renderTeamStrip();
  await openOverflow('Mankey #1');
  await user.click(screen.getByRole('menuitem', { name: 'Release…' }));
  expect(screen.getByRole('dialog', { name: 'Release Mankey #1?' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/features/workbench/MemberContextMenu.test.tsx src/features/workbench/TeamStrip.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement menu and focus behavior**

Use a menu button and dialog/menu primitives built with React DOM; add no UI library. Right-click and Shift+F10 call the same action. Long-press is an enhancement; overflow is always visible. Escape closes and restores slot focus.

- [ ] **Step 4: Run team/action tests**

Run: `npm run test -- src/features/workbench/MemberContextMenu.test.tsx src/features/workbench/TeamStrip.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/features/workbench/MemberContextMenu.tsx dev/src/features/workbench/MemberContextMenu.test.tsx dev/src/features/workbench/TeamStrip.tsx dev/src/features/workbench/TeamStrip.test.tsx dev/src/styles.css
git commit -m "feat: add party context actions"
```

---

### Task 10: Finish mobile sheets and responsive layout

**Files:**
- Create: `dev/src/features/workbench/MobileInspectorSheet.tsx`
- Create: `dev/src/features/workbench/MobileInspectorSheet.test.tsx`
- Modify: `dev/src/features/workbench/WorkbenchShell.tsx`
- Modify: `dev/src/features/workbench/WorkbenchShell.test.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- Produces: 390px single-scroll results, sticky compact controls, focus-managed full-height inspector/comparison sheet.

- [ ] **Step 1: Write failing mobile tests**

```tsx
it('uses one sheet for inspector and comparison', async () => {
  renderMobileWorkbench();
  await user.click(screen.getByRole('button', { name: 'Inspect Mankey' }));
  expect(screen.getByRole('dialog', { name: 'Mankey inspector' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Compare' })).toBeInTheDocument();
});

it('restores trigger focus on close', async () => {
  const trigger = openMobileInspector();
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/features/workbench/MobileInspectorSheet.test.tsx src/features/workbench/WorkbenchShell.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement responsive presentation**

Desktop keeps one primary workspace scroll plus inspector column. Mobile keeps one page results scroll and a modal sheet; do not nest desktop panes. Honor reduced motion and keep sticky controls usable at 200% zoom.

- [ ] **Step 4: Run UI and full checks**

Run: `npm run test -- src/features/workbench src/features/search && npm run check`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/features/workbench/MobileInspectorSheet.tsx dev/src/features/workbench/MobileInspectorSheet.test.tsx dev/src/features/workbench/WorkbenchShell.tsx dev/src/features/workbench/WorkbenchShell.test.tsx dev/src/styles.css
git commit -m "feat: make workbench responsive"
```

---

### Task 11: Add browser acceptance and finish the branch

**Files:**
- Modify: `dev/package.json`
- Modify: `dev/package-lock.json`
- Create: `dev/playwright.config.ts`
- Create: `dev/e2e/workbench.spec.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `dev/README.md`

**Interfaces:**
- Produces: Chromium desktop/mobile acceptance and final reviewed branch.

- [ ] **Step 1: Install pinned Playwright**

Run: `npm install -D @playwright/test@1.62.1`

Add scripts `e2e: playwright test` and `e2e:install: playwright install chromium`. Configure a Vite web server at `127.0.0.1:4173` plus Chromium projects at 1366×768 and 390×844.

- [ ] **Step 2: Write browser acceptance tests**

```ts
test('plans and compares a milestone-scoped FireRed team', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Charmander' }).click();
  await page.getByRole('button', { name: 'Start FireRed' }).click();
  await expect(page.getByText('Current: Starter')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Routes to Brock/i })).toBeVisible();
  await page.getByLabel('Type').selectOption('fighting');
  await page.getByRole('button', { name: 'Mankey' }).click();
  await expect(page.getByRole('heading', { name: /Mankey · Where & When/i })).toBeVisible();
  await page.getByRole('button', { name: /Party slot 1/i }).click();
  await expect(page.getByRole('region', { name: /Compare .* with Mankey/i })).toBeVisible();
});
```

Add a second test for Surf capability states and a non-blocking HM-loss warning.

- [ ] **Step 3: Run E2E and regress every fix**

Run: `npm run e2e`

Expected: both viewport projects PASS. Use trace/screenshots for failures and add a focused unit/component RED before changing production code.

- [ ] **Step 4: Update CI and README**

CI installs Chromium, runs `npm run check`, then `npm run e2e`. Document local setup, grouped navigation, comparison, capability tokens and viewport targets.

- [ ] **Step 5: Run `/simplify` once**

Run one combined inline simplify pass over `origin/master...HEAD`. Review reuse, clarity, unnecessary state and component boundaries. Apply behavior-preserving changes and rerun affected tests.

- [ ] **Step 6: Run one inline medium `/code-review`**

Review `origin/master...HEAD` once. Focus on migration safety, resolver determinism, propagation boundaries, permissive validation, import limits, accessibility and controller synchronization. Do not invoke workflow review. Add regression tests for every confirmed finding.

- [ ] **Step 7: Run final verification**

Run: `npm run check`

Run: `npm run e2e`

Run: `git diff --check`

Run: `git status --short`

Expected: all tests, typechecks, data verification, production build and browser projects PASS; no whitespace errors; only intended files changed.

- [ ] **Step 8: Commit acceptance and review fixes**

```powershell
git add .github/workflows/ci.yml dev/package.json dev/package-lock.json dev/playwright.config.ts dev/e2e/workbench.spec.ts dev/README.md dev/src
git commit -m "test: verify workbench ux journey"
```

## Final execution handoff

The fresh session should:

1. Use `superpowers:using-git-worktrees` if the checkout is not already isolated.
2. Use `superpowers:subagent-driven-development`.
3. Execute the timeline plan through its handoff gate.
4. Execute this plan Task 1 through Task 11.
5. Use one fresh implementation subagent per task and the review gates required by that skill.
6. Preserve the user's inline-only simplify/code-review cost controls at the final branch gate.
