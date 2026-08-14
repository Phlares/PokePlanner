# PokéPlanner Workbench UX Overhaul Design

**Date:** 2026-08-14

**Status:** Approved for implementation planning

**Depends on:** `2026-08-13-milestone-team-timeline-design.md`

## 1. Purpose

Reshape the FireRed workbench around the milestone team timeline and the user journeys exposed by manual usability testing. The current application is internally coherent and functionally complete, but its primary team surface falls below the fold, import/export occupies prime space, progression requires excessive scrolling, search and route detail can become unsynchronized, and the inspector mixes species browsing with temporary team editing.

The overhaul makes the team, planning target, search scope, route evidence, and candidate comparison parts of one explicit workspace. It uses the supplied `Pokeplanner UI mockups` as the hierarchy and visual-language baseline while retaining PokePlanner's monochrome, square, text-forward ledger style.

## 2. Goals

- Keep the current milestone party visible in the first viewport rung.
- Initialize every run at its starter gate and first meaningful target.
- Replace the permanent progression rail with foldable milestone route groups.
- Scope route results to the planning target by default.
- Make Routes and Pokémon two synchronized views over the same search state.
- Prevent stale combinations of search, route detail, inspector, and party selection.
- Separate read-only species inspection from owned-member timeline editing.
- Compare an inspector candidate automatically against a selected party member.
- Warn when a replacement removes active-party HM utility.
- Surface milestone requirements and unlocks as terse interactive search tokens.
- Move run-data controls into a compact menu.
- Make desktop, laptop, mobile, keyboard, and zoomed layouts practically usable.

## 3. Non-goals

- Replacing the timeline/member editor specified in the milestone team timeline design.
- Building battle simulation, damage calculation, or opponent exposure scoring.
- Modeling IVs, EV plans, characteristics, or exact battle stats.
- Blocking replacement because of utility or legality findings.
- Final visual polish independent of live browser iteration.
- Adding hosted share IDs.
- Implementing every future item, traversal, or challenge rule before its game data exists.

## 4. Architectural approach

Use a **unified workbench controller with derived view models**.

The timeline domain is the single source of truth for the resolved party, reserve, findings, current progress, and planning target. The workbench controller reads those values, changes them through timeline commands, and owns only ephemeral navigation state. Pure game-pack selectors produce grouped milestone results, selected route evidence, Pokémon acquisition locations, inspector content, and member comparisons.

```text
timeline state + game pack + game rules
                    ↓
          workbench controller
                    ↓
 grouped results / detail / inspector / comparison
                    ↓
       navigation action or timeline command
```

The controller owns or coordinates:

- Planning-target commands against the timeline domain
- Routes/Pokémon mode
- Milestone filter state
- Search filters
- Open milestone groups
- Selected route
- Inspector candidate
- Selected party member
- Comparison state
- Mobile sheet state

Components never synchronize each other through incidental effects. They dispatch focused actions and receive resolved view models. Persistent edits continue through the timeline domain.

## 5. Component boundaries

- `WorkbenchShell`: viewport hierarchy and responsive presentation.
- `TeamStrip`: party, reserve summary, findings, selected member, and context actions.
- `WorkbenchToolbar`: search fields, mode toggle, milestone scope, totals, and clear action.
- `MilestoneResults`: milestone groups, future teaser, and no-match summary.
- `RouteDetail`: complete encounter and acquisition evidence for a route.
- `PokemonLocations`: chronological Where & When acquisition evidence.
- `PokemonInspector`: species browsing and candidate actions.
- `MemberComparison`: current member versus candidate differences and HM utility warning.
- `MemberContextMenu`: Edit, Compare/Replace, Reserve, and Release actions.
- `RunMenu`: save state, JSON, plan codes, import, duplicate, rename, reset, and theme.
- `MobileInspectorSheet`: mobile presentation of inspector and comparison view models.

The inspector no longer creates a temporary mutable team draft. It selects a candidate and may create a new persistent member only through an explicit Add action. Owned-member editing belongs to the timeline member editor.

## 6. Initial run journey

Game rules provide one or more required starter acquisitions. Selecting a starter creates the first persistent member automatically and places it in the first party slot at the Starter keyframe. The user never needs to click Pallet Town to make the application meaningful.

FireRed opens with:

- Current progress: Starter
- Planning target: Brock
- Party slot P1: selected starter
- Filter by milestone: enabled
- Starter → Brock segment: expanded
- Routes ordered closest to Brock first
- A nonempty primary heading and an actionable result view

The shared rule contract supports games with multiple starters without hard-coding FireRed's exact setup.

## 7. Layout hierarchy

Desktop uses the viewport as a planning frame.

1. **Header:** product/run identity, save state, theme, and run menu.
2. **Sticky team rung:** selected target, six party slots, reserve summary, finding count, auto-level policy, and Timeline entry.
3. **Sticky search rung:** filters, Routes/Pokémon toggle, Filter by milestone, totals, and clear action.
4. **Workspace:** approximately two-thirds primary results/detail and one-third inspector.

The old permanent progression rail is removed. Milestone groups provide progression navigation inside the primary workspace.

The primary workspace owns the main vertical scroll. The inspector keeps a sticky heading and actions and avoids one long narrow document through a two-column summary plus compact Overview, Moves, Where, and Compare sections.

The primary heading always identifies context, for example:

- `ROUTES TO BROCK`
- `ROUTE 22`
- `MANKEY · WHERE & WHEN`

Import/export never occupy the main rungs.

## 8. Workbench navigation state

Selection rules are deterministic:

- Selecting a milestone changes the planning target and route scope, not current progress.
- Selecting a route opens Route Detail.
- Selecting a species opens Pokémon mode, Where & When, and the inspector.
- Selecting a location from Where & When opens its route evidence while preserving the candidate.
- Switching modes restores each mode's last meaningful valid selection.
- Clearing filters preserves the planning target.
- Changing the target recalculates availability and findings without moving current progress.
- Invalid selections are cleared deliberately; the UI never shows a route hidden by its own active scope.

Ephemeral navigation does not persist a stale comparison or open context menu across refresh.

## 9. Milestone groups

Milestones are foldable super-categories. A group contains the routes, towns, dungeons, acquisitions, and relevant events after the previous major milestone and through its own encounter.

Without active search:

- Target milestone is expanded.
- Earlier groups are collapsed.
- Routes within a group are reverse chronological: closest to the target encounter first.
- Disabling milestone filtering reveals future groups with distinct locked/future styling.

Group summaries may show route count, match count, acquisition count, access findings, and timeline findings.

## 10. Search ordering and grouping

Search is a persistent filter bar beneath the team strip. FireRed initially supports name, type, ability, and move. Held-item, acquisition, and capability filters use the same query contract when their canonical data becomes available.

With active search, the milestone list becomes a result list in this exact order:

1. **Future-match teaser:** one subdued collapsed row such as `3 matching Pokémon after Brock`.
2. **Eligible matching milestones:** auto-expanded and ordered newest first.
3. **No-match summary:** one collapsed row such as `Milestones 2–10 hidden · no matches`.

Individual eligible milestone groups without matches are not rendered. Expanding the no-match summary is an explicit escape hatch. Opening the future teaser reveals future matching groups but does not change current progress or planning target.

Milestone scope and grouping replace the current arbitrary first-50-result presentation. Exceptionally large matching groups may progressively reveal more routes while keeping accurate totals.

## 11. Routes mode

Routes is the default mode.

Each route result shows:

- Route name and milestone group
- Current, future, locked, optional, or postgame state
- Matching level range
- Match count
- Access gates such as Flash, Surf, Strength, or story prerequisites
- Matching Pokémon beneath the route as `Name | acquisition method`

Exact query matches receive strong underline or highlight treatment. Selecting a route loads complete encounter/acquisition evidence while preserving the active filters and highlighting matching rows.

Version-exclusive, unavailable, and future encounters use a secondary visual state and an accessible textual label.

## 12. Pokémon mode

Selecting a species automatically enters Pokémon mode. The center pane becomes **Where & When** and lists all acquisition paths chronologically with:

- Route, location, or source
- Wild, gift, starter, trade, fossil, static, event, transfer, or other method
- Encounter level or received level where known
- Current, future, conditional, or unavailable status
- Access milestone and prerequisite

The inspector shows the same candidate. Selecting a location opens its detailed route evidence while retaining the candidate, so party comparison remains available. Returning to Routes restores the prior route rather than an unrelated stale view.

## 13. Team strip interactions

Primary click selects and highlights a party member. It never mutates the team.

The same compact action menu opens through:

- Right-click
- Menu key or Shift+F10
- Visible overflow button
- Long-press on touch

Actions include:

- Edit at selected milestone
- Compare/Replace
- Move to reserve
- Release

Release is separate and confirmed. Replacing a party member always moves the outgoing persistent member to reserve by default. Challenge workflows may choose direct Release from the context menu without performing a two-step reserve transition.

When adding an inspector candidate:

- If a party slot is empty, Add to party uses the next open slot.
- Add to reserve is always available.
- If the party is full and no member is selected, the primary action asks the user to choose a party member to compare.
- Selecting a party member opens automatic comparison.

## 14. Automatic comparison

Comparison activates whenever a candidate is surfaced in the inspector and a party member is selected. Selecting a different party member retargets the same candidate. Clearing the candidate returns the party slot to ordinary selected state.

Comparison supports newly encountered species and existing reserve members and shows:

- Type and ability changes
- Base-stat values and deltas
- Prominent Attack and Sp. Attack differences
- Optional nature differences
- Physical, Special, and Status labels under the selected game rules
- Relevant attacking stat beside damaging moves
- Exact moves leaving and entering
- Existing timeline/legality findings

No replacement occurs until confirmation.

## 15. HM utility comparison

The utility section is intentionally narrow and advisory. It reports:

- Which configured HMs leave the active party
- Whether another active member still knows each HM
- Whether the candidate can learn the missing HM now or conditionally
- Whether a matching reserve member is available

Reserve members do not count as active coverage. HM loss produces a yellow warning and never blocks replacement. The shared rules interface may map later games to field techniques or ride capabilities without changing the comparison contract.

## 16. Stats and nature

Base stats are the default comparison because they are canonical and assumption-free. Show HP, Attack, Defense, Sp. Attack, Sp. Defense, and Speed with direct deltas. Attack and Sp. Attack receive additional emphasis beside the candidate's move damage classes.

A collapsed reference section may show standard level-50 and level-100 hindering, neutral, and beneficial ranges. It must label them as reference ranges rather than the member's exact values because IVs and EVs are not planned.

Nature is optional persistent member metadata:

- Default: Unspecified
- Neutral or `+10% stat / −10% stat`
- Stable across milestones
- Visible in member editing and comparison
- Supplied by the game-version rules adapter

Do not add IV, EV, characteristic, or exact-stat editing in this overhaul.

## 17. Inspector

The desktop inspector uses a wider, denser two-column structure:

- Large species title, Dex number, types, and candidate action
- Base stats and optional nature target
- Abilities with concise descriptions
- Full evolution chain with evolves-from and evolves-to gates
- Acquisition summary
- Overview, Moves, and Where sections
- Sticky heading/actions

Move rows include name, type, Physical/Special/Status class, relevant attacking stat, availability state, and level/item/origin/milestone requirement.

Essential information remains visible without hover. Tooltips and focusable disclosures provide supporting details.

## 18. Milestone briefing and capability search

The selected milestone header remains terse:

```text
REQUIRES  SURF  STRENGTH
UNLOCKS   SUPER ROD  FLY  SAFARI ZONE
```

The terms are visually interactive tokens; brackets are not rendered. Each token has an accessible action label such as `Search for Surf`.

Selecting a token applies a capability/acquisition search and highlights consistent evidence across party, reserve, and results:

- **Knows**
- **Can learn now**
- **Can learn with condition**

Conditional explanations include level, future TM/HM, egg origin, trade, event, evolution, and other version rules.

Party slots display individual states. The collapsed reserve box shows an aggregate match indicator; opening it reveals member-level states. Search results show the same symbols and tooltip/focus explanations. Selecting a matching member opens normal evidence and comparison flows.

The rules adapter supplies milestone requirements and unlocks. FireRed maps these to HMs, rods, bicycles, key items, services, story gates, and route access. Later games can provide equivalent capabilities.

## 19. Run menu and recovery

The compact run menu contains:

- Save status
- Download JSON
- Copy plan code
- Import JSON file or plan code
- Duplicate run
- Rename run
- Reset/delete run with confirmation
- Theme

Durable state includes current progress, planning target, timeline, and run preferences. Search text, open folds, selected route, candidate, party selection, comparison, and context menus remain ephemeral.

On refresh, restore the most recent run, current progress, and planning target, then rebuild the default milestone-scoped view. Restore a prior route only when it remains valid. Never restore a stale comparison or half-open menu.

Temporary-memory mode displays a persistent header warning and keeps JSON and plan-code export immediately available. A failed save preserves the last durable record, retains unsaved edits in memory, and offers Retry and Export.

Panel-level failures preserve the surrounding workbench and show local actionable errors. Only canonical pack boot failure replaces the whole application.

## 20. Accessibility

- All pointer shortcuts have keyboard, visible-control, and touch equivalents.
- Search tokens, capability states, warnings, comparison deltas, and tooltips expose the same information without hover.
- Selection, focus, future, disabled, and finding states never rely on color alone.
- Selecting a route focuses its main heading.
- Selecting a species focuses the inspector heading.
- Opening a sheet or comparison moves focus inside it; closing restores the trigger.
- Filtered result counts are announced without interrupting typing.
- Auto-expanded milestone groups never steal focus.
- Focused content is deliberately scrolled into view, preventing offscreen focus ambiguity.

## 21. Responsive behavior

Validation targets:

- 1440×900 and larger desktop
- 1366×768 laptop
- Tablet portrait and landscape
- 390px mobile
- 200% browser zoom

At 1366×768, the party strip, search toolbar, selected title, useful result area, and inspector heading remain in frame.

Mobile uses:

- Sticky compact party strip
- Sticky planning target and compact search controls
- One page-scrolling result surface
- Full-height inspector/comparison sheet
- Long-press and visible overflow actions
- Dedicated timeline navigation rather than a compressed desktop grid

Tables may scroll horizontally, but the whole page must not. Mobile must not stack multiple independent desktop scroll regions.

The wireframes establish hierarchy, not final pixel values. Live browser passes determine density, sticky heights, and column proportions before acceptance.

## 22. Testing

All behavior changes use test-driven development.

### 22.1 Controller and selector tests

- Starter-to-first-target initialization
- Current progress versus planning target
- Routes/Pokémon transitions and selection restoration
- Milestone-scoped grouping
- Reverse-chronological route ordering
- Matching-group auto-expansion
- Future-match teaser
- Compressed no-match summary
- Route/candidate/inspector/comparison synchronization
- Capability search states
- HM-loss utility findings
- Replacement-to-reserve behavior
- Rules-provided starters, milestones, requirements, and unlocks

### 22.2 Component tests

- Sticky party and search rungs
- Foldable milestone groups
- Interactive search tokens
- Exact-match highlighting
- Route and Where & When selection
- Inspector sections and two-column summary
- Context menu across pointer, keyboard, visible control, and touch-compatible action
- Automatic comparison
- Nature and move-class presentation
- Run menu and temporary-session warning
- Focus placement and live announcements
- Mobile sheets and collapsed pools

### 22.3 Browser acceptance journeys

1. Create FireRed with Charmander and land at Starter progress targeting Brock.
2. Search Fighting and see only eligible matching groups, a future teaser, and one no-match summary.
3. Select Mankey and inspect chronological Where & When evidence.
4. Select a party slot and automatically compare Mankey.
5. Confirm replacement and verify the outgoing member enters reserve.
6. Search Surf from a milestone token and inspect Knows, Can learn now, and Conditional states across party, reserve, and candidates.
7. Attempt a replacement that removes the party's only HM coverage and receive a non-blocking warning.
8. Refresh and confirm durable timeline state without stale transient UI.
9. Complete the core flow at 1366×768, 390px, keyboard-only, and 200% zoom.

## 23. References

- Approved wireframes: `C:\Users\Ryon\Downloads\Pokeplanner UI mockups`
- Timeline dependency: `dev/docs/superpowers/specs/2026-08-13-milestone-team-timeline-design.md`
- PokéAPI base-stat and nature contracts: <https://pokeapi.co/docs/v2>
- Gen III reference range presentation: <https://www.serebii.net/pokedex-rs/005.shtml>

## 24. Delivery boundary

This specification requires the timeline domain from phase 1, a unified workbench controller, new grouped-result selectors, a rewritten workbench shell, read-only inspector separation, comparison and utility views, capability-token search, responsive surfaces, and browser-level acceptance coverage.

The timeline and workbench specifications must receive implementation plans before either build begins. Their plans may share foundational tasks, but timeline domain contracts precede workbench integration.
