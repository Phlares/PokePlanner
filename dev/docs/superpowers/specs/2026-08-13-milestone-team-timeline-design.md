# PokéPlanner Milestone Team Timeline Design

**Date:** 2026-08-13

**Status:** Approved for implementation planning

**Depends on:** FireRed V1 Plan 2 data pack, playthrough persistence, workbench, search, availability, and team domains

## 1. Purpose

Replace the current single-state 6+6 team manifest with a milestone-aware team planner. A playthrough should describe how individually owned Pokémon move through the active party, reserve pool, and released archive over the game's progression. Major-event planning remains approachable by default; detailed route planning expands the same model without duplicating state.

The planner is permissive. It never blocks a save because a team is unusual or illegal. Instead, a version-specific ruleset explains ordinary, conditional, impossible, and not-yet-verifiable configurations. This supports normal play, trades, events, mods, and future challenge modes without conflating them.

This specification is the first of two back-to-back UX specifications. A separate workbench-overhaul specification will consume the resolved timeline state and define the route/search/inspector layout.

## 2. Goals

- Keep the team visible and central to planning.
- Represent team state at major FireRed encounters and at optional route-level detail.
- Preserve individual identity when multiple members share a species.
- Infer intermediate route states from sparse user-authored milestones.
- Prevent inferred members from appearing before their acquisition gate.
- Freeze boxed Pokémon until the user explicitly levels, evolves, or returns them.
- Support party, unbounded reserve, and released/knocked-out lifecycle states.
- Permit scoped propagation of changes across existing milestones.
- Explain legality and special conditions without blocking edits or persistence.
- Separate shared timeline mechanics from game-version rules.
- Migrate current saves without losing member configuration.
- Export downloadable JSON and deterministic, self-contained plan codes.

## 3. Non-goals

- Simulating experience gain, battles, damage, or encounter outcomes.
- Automatically performing item, trade, friendship, location, or choice evolutions.
- Enforcing Nuzlocke or challenge rules in the first Standard implementation.
- Claiming held-item or finite-resource legality where canonical data is absent.
- Hosting plans or resolving short server-backed share IDs.
- Defining the final workbench layout; that belongs to the following specification.
- Generalizing for hypothetical games beyond the boundaries required for an injectable ruleset. New rule capabilities will be added when a supported game demonstrates the need.

## 4. Core architecture

Use **persistent planned members, sparse explicit keyframes, and derived interpolation**.

The saved playthrough contains individual members, lifecycle history, explicit major-event keyframes, and user-created detailed-node overrides. It does not persist generated route snapshots or validation results. A pure resolver combines the nearest explicit states with progression, acquisition, level, evolution, and local-override rules to calculate any node's resolved state.

```text
previous explicit keyframe
+ next explicit keyframe
+ progression segment
+ acquisition gates
+ active-party auto-level policy
+ optional level-based auto-evolution
+ local detailed-node overrides
-----------------------------------
= resolved node state + findings
```

Intermediate nodes remain derived until edited. Editing one promotes that node to an explicit override. Derived state is deterministic and never mutates the saved playthrough.

## 5. Planning resolution

The timeline supports two zoom levels over one progression graph.

### 5.1 Major Events

This is the default Standard view. FireRed major events include starter selection, significant Rival encounters, Gyms, major Rocket/story confrontations such as Silph Co. and Giovanni, Elite Four, Champion, and relevant postgame gates.

Each populated major event is an explicit keyframe. A user may start the next milestone with one **Copy previous (+)** action. Copying can include both party and reserve and can optionally:

- Apply Under, Match, or Over active-party levels.
- Apply eligible level-based evolutions.
- Preserve moves and held items while marking them for review.

### 5.2 Detailed Planning

Detailed Planning expands the routes, towns, dungeons, and relevant encounters between major events. Those nodes are auto-filled from the surrounding keyframes.

Interpolation must respect acquisition timing. If Mankey appears in the target Gym team but is first obtainable at the third route in the segment, it cannot appear in the first two route states. Auto-filled nodes carry a visible **Auto-filled** label. Selecting and editing one creates an explicit local override.

Future challenge modes may attach completion and encounter-consumption state to detailed nodes without changing Standard timeline semantics.

## 6. Persistent member identity

Every planned Pokémon is an individual member instance rather than a species entry.

```text
memberId             stable UUID or migrated legacy member ID
species lineage      current stage plus explicit evolution history
sequence number      acquisition order among members of the same species
nickname             optional user-facing name
origin               inferred method/node plus optional override
acquiredAtNodeId      earliest node where this instance joins ownership
lifecycle history    party/reserve/release/restore transitions
member notes          identity-wide notes
```

A milestone configuration references `memberId` and stores milestone-specific level, species stage, ability, moves, held item, placement, slot, review state, and manual overrides.

The UI displays the bare species name when unambiguous. Duplicate species use acquisition-order labels such as `Mankey #1` and `Mankey #2`. Hover and keyboard focus expose origin and acquisition node. A nickname leads visually while species and sequence remain available as metadata.

Adding another instance of an existing species creates a new member and sequence number. Returning a member from reserve always references the existing member and cannot accidentally clone it.

## 7. Placement and lifecycle

At any resolved node, an acquired member occupies exactly one lifecycle placement:

- **Party:** one of six active slots.
- **Reserve:** an unbounded owned pool.
- **Released:** an unbounded historical archive, relabelable as Knocked Out or Fallen by challenge rules.

Removing a party member sends the same instance to reserve at its current state. A member can also be acquired directly into reserve.

Reserve members do not auto-level, auto-evolve, learn moves, or change items during interpolation. Their state freezes when they leave the party. Returning one preserves that state and may offer explicit catch-up leveling.

Release never deletes history. It records node, ordering metadata, prior placement, and an optional reason. Restore returns the same member to reserve and appends a restore event. A restored member permanently carries a yellow **Restored Pokémon** finding. Challenge rules may independently report that restoration conflicts with the chosen challenge, but saving remains allowed.

## 8. Levels and evolution

Auto-level is a planning suggestion for active party members, not an experience simulation.

- **Under:** target challenge level minus five.
- **Match:** target challenge level.
- **Over:** target challenge level plus five.
- Manual levels always override generated values.

The ruleset defines the target level and obedience context for each node. Reserve members are excluded from automatic level changes.

Auto-evolve is an option attached to auto-level and applies only deterministic level-based evolutions whose required level has been reached. Item, friendship, trade, location, time, and choice-based evolutions remain explicit user actions. Manual leveling and evolution are available at any checkpoint and immediately recalculate findings.

## 9. Moves, held items, and review state

Moves and held items are configured independently at every explicit milestone or detailed-node override. A member may learn a move for one challenge and replace it later.

Copying or propagating a member preserves the four-move loadout and held item, then adds neutral **Review required** markers at later milestones. These markers remind the user to consider newly available options without claiming that the copied configuration is illegal.

Move validation considers species stage, planned level, acquisition method, acquisition milestone, and inferred origin. A conditional move may prompt for an origin override, for example:

> This move is available here only as an egg move. Mark this Pokémon as hatched?

Accepting changes origin provenance and recalculates findings. Declining leaves the configured move and its conflict visible.

Held-item and one-copy TM/resource validation use the same interface. Where the pack lacks canonical inventory data, the engine reports **Unverified** rather than guessing.

## 10. Editing and propagation

Every edit is explicit and permissive. Core operations include:

- Acquire a member.
- Add to party or reserve.
- Change party slot.
- Move to reserve.
- Release or restore.
- Replace a slot occupant.
- Change level, species stage, ability, moves, held item, origin, or notes.

When an edit can affect existing timeline state, the UI offers:

- **Only here**
- **Here and future populated nodes** (recommended default)
- **All populated nodes**

Propagation targets the same `memberId` or the same party slot, not every member of the species. A forward replacement stops at a later explicit override that already changes the slot unless the user deliberately chooses to overwrite it.

Replacing an occupant in a detailed override asks whether the replacement should continue into future states. Field-level **Change all** operations propagate only the selected field. **Replace all** changes the slot occupant while preserving each target milestone's independent level policy where possible.

## 11. Origin inference

The planner infers the earliest ordinary acquisition path valid for the species and selected node, such as starter, gift, wild encounter and method, in-game trade, static encounter, or fossil.

It asks for an origin choice only when the configuration requires a materially different path or would otherwise be impossible. Supported override categories include hatched, external trade/transfer, event, and other version-specific origins.

Origin overrides are editable, evidence-backed, and propagated only with explicit user approval.

## 12. Validation and findings

Validation is a pure overlay:

```text
resolved member configuration
+ inferred or overridden origin
+ progression context
+ game rules
+ shared-resource assignments
--------------------------------
= evidence-backed findings
```

Findings never block saving.

### 12.1 Finding classes

- **Review:** copied moves or items have not been reconsidered.
- **Yellow:** officially possible but conditional or complicated, including egg moves, trade evolutions, external transfers, events, finite-resource contention, or restored members.
- **Red:** impossible at the selected state through supported official rules, including appearance before any valid acquisition path, trade before trading unlocks, impossible evolution or move/stage combinations, or applicable obedience failure.
- **Unverified:** the current pack or rule adapter cannot establish legality.

Every finding contains a stable code, severity, short message, full explanation, affected member and field, rule/acquisition evidence, and suggested resolutions. Findings roll up from member to slot, node, and timeline ruler. Tooltips and focusable details provide equivalent pointer and keyboard access.

Obedience validation must distinguish self-obtained members from externally traded members. Badge state, level, ownership origin, and version rules participate in the calculation.

## 13. Game-version rules

The timeline engine is game-agnostic. A version-specific rules adapter supplies:

- Progression graph and major-event classification.
- Detailed-node reachability and branch context.
- Acquisition paths and trade unlocks.
- Challenge level targets.
- Obedience rules.
- Evolution eligibility and eligible automated transitions.
- Move legality and acquisition timing.
- Held-item availability.
- Finite-resource inventory.
- Challenge-mode extensions.

The shared engine owns member identity, lifecycle, keyframes, interpolation, propagation, finding presentation, persistence, and sharing.

Rules receive a normalized context rather than assuming a fixed badge sequence. FireRed may use specific badge identities and ordered milestones. A later game with flexible Gym order may expose badge count, completed Gym set, world flags, and branch choices; obedience can depend on count while acquisitions depend on particular completions.

Rule adapters return suggestions and findings and never mutate timeline state. The interface should remain narrow and grow only when an implemented game demonstrates a concrete need.

## 14. Timeline interface

The dedicated timeline surface follows the approved desktop and mobile wireframes under `Pokeplanner UI mockups`.

### 14.1 Shared header

- Major Events / Detailed Planning toggle.
- Sticky milestone ruler.
- Selected-node title and progression state.
- Under / Match / Over control.
- Optional level-based Auto-evolve control.
- Set current to selected node.
- Compact run menu with save state, import, export, and sharing.

### 14.2 Selected node

- Six active party slots.
- Unbounded reserve pool.
- Released/knocked-out archive.
- Node validation summary.
- Explicit, Auto-filled, and Overridden state labels.

Selecting a member opens a milestone editor for level, evolution stage, ability, moves, held item, origin, notes, lifecycle actions, and findings. The propagation scope is chosen before a change applies.

Acquisition markers show where a member enters ownership. Party, reserve, release, and restore transitions remain traceable across the member's history.

### 14.3 Mobile

- Sticky compact party strip and milestone ruler.
- One member or slot lane per row.
- Collapsible reserve and released groups.
- Full-height member editor sheet.
- No compressed reproduction of the desktop keyframe grid.

The separate workbench specification will define how its compact party strip, route view, Pokémon view, search, and inspector consume resolved timeline state.

## 15. Persistence and migration

The playthrough schema receives a version bump. Persist only explicit member, keyframe, override, lifecycle, preference, provenance, and acknowledgement data. Recalculate derived routes and findings.

Migration from the current schema is deterministic and non-destructive:

- Reuse every legacy team-member ID as `memberId`.
- Move legacy primary members into the active party.
- Move legacy reserve members into the unbounded reserve pool.
- Use the current or preview milestone as the initial explicit keyframe.
- Preserve levels, abilities, moves, nicknames, notes, and future-move labels.
- Do not invent release history or origin overrides.
- Validate the migrated candidate before replacing the old record.

Autosave continues through IndexedDB. A failed write preserves the last durable record, retains unsaved edits in memory, and displays persistent Retry and Export actions. Temporary-memory sessions always show that they are non-durable.

Downloadable JSON is the primary file export. Copyable text remains a fallback. Import validates and migrates before the user confirms creating or replacing a run. A pack update preserves IDs and overrides where possible and reports affected state as findings rather than discarding it.

## 16. Portable plan codes

The static first release supports deterministic, self-contained plan codes rather than hosted short IDs.

Export:

1. Normalize persistent playthrough data into canonical field and array order.
2. Remove recalculable route states, pack data, and findings.
3. Encode a versioned compact representation.
4. Compress it.
5. Convert it to URL-safe text.
6. Attach format version and checksum.

Import verifies checksum before decompression, enforces compressed and expanded size limits, decodes the format version, migrates the playthrough schema, checks game and pack compatibility, and presents a preview. The preview includes run name, game, member count, milestone count, and warnings. Confirmation is required before local persistence changes.

The same code can be pasted or embedded in a share URL. Opening a share URL presents an import preview and never silently writes. Compression dictionaries and format versions remain stable so newer clients can read older codes.

## 17. Error handling

- Invalid edits remain visible with findings; they do not disappear or fail silently.
- Resolver failures produce an actionable node-level error and retain the last valid resolved view.
- Migration and import failures preserve the exact previous record.
- Unsupported newer schemas or plan-code formats explain the required client update.
- Missing rules produce Unverified findings rather than false legality.
- Propagation previews report affected milestones before confirmation.
- Save failures distinguish durable state from unsaved in-memory edits.

## 18. Testing

All behavior changes use test-driven development.

### 18.1 Domain tests

- Stable identity across duplicate species, evolution, reserve, release, and restore.
- Sparse keyframe resolution and detailed-node interpolation.
- Acquisition gates within interpolated segments.
- Frozen reserve state.
- Active-party auto-level and optional level-based auto-evolution.
- Manual route-override promotion.
- Here-only, forward, and all-populated propagation.
- Copy milestone options and review markers.
- Origin inference and conditional overrides.
- Permissive finding severity.
- Flexible progression contexts through injected game rules.
- Deterministic schema migration and plan-code round trips.

### 18.2 Invariants

- A resolved party never exceeds six members.
- A member occupies exactly one lifecycle placement at a node.
- Resolution does not mutate saved input.
- Resolution and export are deterministic.
- Propagation touches only requested targets.
- Duplicate species never collide.
- Import failure preserves current state.

### 18.3 Interface tests

- Keyboard and pointer milestone navigation.
- Major/Detailed zoom.
- Milestone copy options.
- Auto-filled versus explicit versus overridden labels.
- Party, reserve, release, and restore actions.
- Permanent Restored Pokémon marker.
- Warning rollups and focusable explanations.
- Propagation prompts and previews.
- Member editing and copied-configuration review state.
- Downloadable JSON, plan-code import/export, and temporary-session messaging.
- Mobile slot lanes, member sheet, and collapsible pools.

### 18.4 Acceptance journey

1. Create two distinct Mankey members and verify their identities never collide.
2. Place one Mankey at a later Gym keyframe and confirm it appears only after its acquisition route in Detailed Planning.
3. Move a member to reserve and confirm its state freezes across later milestones.
4. Release and restore it and confirm the permanent restored marker.
5. Add a conditional egg move, accept the hatched-origin override, and inspect the revised warning.
6. Propagate a party replacement forward while preserving a later explicit override.
7. Edit one auto-filled route and confirm only that route becomes explicit.
8. Export a plan code and reconstruct the same persistent state in a clean session.

## 19. Delivery boundary

This specification requires a new timeline domain, schema migration, game-rule adapter, resolver, finding engine, timeline UI, persistence updates, and sharing codec. FireRed is the first rules implementation.

Comprehensive held-item and finite-TM enforcement may ship incrementally as canonical inventories are compiled. The first timeline release must still expose the finding categories and return Unverified where evidence is incomplete.

No implementation begins until the subsequent workbench-overhaul specification is also approved, per the agreed sequencing.
