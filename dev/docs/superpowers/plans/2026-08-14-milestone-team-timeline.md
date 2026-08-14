# Milestone Team Timeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single-state 6+6 manifest with a persistent-member, sparse-keyframe timeline that resolves milestone and route states, reports permissive game-rule findings, migrates existing runs, and exports portable plan codes.

**Architecture:** The playthrough stores persistent member identities, lifecycle events, major keyframes, and explicit route overrides. Pure rules, resolver, propagation, validation, and sharing modules calculate derived states without mutating saved input; FireRed implements the first game-rule adapter. UI tasks consume only these domain interfaces and keep timeline editing separate from species inspection.

**Tech Stack:** Node.js 22.17.1, npm 11.5.1, React 19.2.7, TypeScript 7.0.2, Vite 8.1.5, Vitest 4.1.10, Testing Library 16.3.2, Zod 4.4.3, native IndexedDB, `fflate` 0.8.3.

**Spec:** `dev/docs/superpowers/specs/2026-08-13-milestone-team-timeline-design.md`

## Global Constraints

- Read the full spec before starting Task 1.
- Execute this plan before `2026-08-14-workbench-ux-overhaul.md`.
- Use TDD for every behavior: focused RED, confirm expected failure, minimum GREEN, then refactor.
- Keep production code and documentation under `dev/`; repository automation may remain under `.github/`.
- Keep the application static: no backend and no browser-time PokéAPI dependency.
- Preserve FireRed version ID `10`, version-group ID `7`, generation ID `3`, and the pinned pack revision.
- Persist user choices and IDs only; never copy canonical pack records into a playthrough.
- Findings are advisory and never prevent saving.
- Derived route states and findings are recalculated and never persisted as authoritative data.
- Reserve members never auto-level or auto-evolve.
- Auto-evolve applies only eligible level-triggered evolutions.
- Do not add IV, EV, damage, battle, or encounter simulation.
- Do not modify the workbench layout in this plan beyond the minimum adapter needed to render the new timeline entry point.
- Commit after each task only when its focused tests and required full check pass.
- Run `/simplify` and one inline `/code-review` medium pass once after both this plan and the workbench plan are complete; do not run workflow-backed review.

## Locked file structure

```text
dev/src/domain/rules/
  game-rules.ts                 # Shared version-rule contracts and normalized contexts.
  firered-rules.ts              # FireRed starter, milestone, level, nature, capability rules.
  firered-rules.test.ts
dev/src/domain/timeline/
  model.ts                      # Persistent member, keyframe, lifecycle and resolved-state types.
  model.test.ts
  commands.ts                   # Acquire/place/box/release/restore/edit operations.
  commands.test.ts
  resolver.ts                   # Sparse-keyframe interpolation and detailed-node overrides.
  resolver.test.ts
  propagation.ts                # Here/forward/all populated edit scopes.
  propagation.test.ts
  validation.ts                 # Finding engine and origin inference.
  validation.test.ts
  capabilities.ts               # Knows/can-now/conditional and shared-resource evidence.
  capabilities.test.ts
dev/src/persistence/
  plan-code.ts                  # Canonical compact payload, DEFLATE, base64url and checksum.
  plan-code.test.ts
  export-import.ts              # JSON/file/code preparation.
  export-import.test.ts
dev/src/features/timeline/
  TeamTimeline.tsx
  TeamTimeline.test.tsx
  MilestoneRuler.tsx
  MilestoneRuler.test.tsx
  TimelineMemberEditor.tsx
  TimelineMemberEditor.test.tsx
  MemberPool.tsx
  MemberPool.test.tsx
```

---

### Task 1: Define game-version rule contracts and FireRed planning metadata

**Files:**
- Create: `dev/src/domain/rules/game-rules.ts`
- Create: `dev/src/domain/rules/firered-rules.ts`
- Create: `dev/src/domain/rules/firered-rules.test.ts`
- Modify: `dev/src/domain/availability.ts`
- Test: `dev/src/domain/availability.test.ts`

**Interfaces:**
- Produces: `GameRules`, `ProgressionContext`, `PlanningMilestone`, `NatureRule`, `CapabilityRule`, `LevelPolicy`, `FIRE_RED_RULES`.
- Consumes: `FireRedPack`, progression nodes/events, evolution edges, acquisitions, and `MILESTONE_ORDER`.

- [ ] **Step 1: Write failing rule-contract tests**

```ts
import { describe, expect, it } from 'vitest';
import { FIRE_RED_RULES } from './firered-rules';

describe('FIRE_RED_RULES', () => {
  it('starts at Starter and targets Brock', () => {
    expect(FIRE_RED_RULES.initialProgress()).toEqual({
      currentNodeId: 'starter',
      targetMilestoneId: 'brock-gym',
    });
  });

  it('defines nature modifiers without timeline state', () => {
    expect(FIRE_RED_RULES.natures.find((n) => n.id === 'adamant')).toMatchObject({
      increasedStat: 'attack', decreasedStat: 'specialAttack', multiplier: 0.1,
    });
  });

  it('exposes Surf as a milestone-searchable capability', () => {
    expect(FIRE_RED_RULES.capabilities.get('surf')).toMatchObject({ kind: 'field-move', moveId: 57 });
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npm run test -- src/domain/rules/firered-rules.test.ts`

Expected: FAIL because the rules modules do not exist.

- [ ] **Step 3: Implement the shared contracts**

```ts
export type StatKey = 'hp' | 'attack' | 'defense' | 'specialAttack' | 'specialDefense' | 'speed';
export type LevelMode = 'manual' | 'under' | 'match' | 'over';

export interface ProgressionContext {
  currentNodeId: string;
  targetMilestoneId: string;
  completedMilestoneIds: ReadonlySet<string>;
  badgeIds: ReadonlySet<string>;
  badgeCount: number;
  branchChoices: Readonly<Record<string, string>>;
}

export interface GameRules {
  gameId: string;
  initialProgress(): { currentNodeId: string; targetMilestoneId: string };
  milestones: readonly PlanningMilestone[];
  natures: readonly NatureRule[];
  capabilities: ReadonlyMap<string, CapabilityRule>;
  targetLevel(milestoneId: string): number;
  canTrade(context: ProgressionContext): boolean;
}
```

Keep the adapter narrow. Move FireRed milestone order/level facts behind `FIRE_RED_RULES`; leave current availability exports as compatibility delegates until Task 9 switches callers.

- [ ] **Step 4: Run focused and compatibility tests**

Run: `npm run test -- src/domain/rules/firered-rules.test.ts src/domain/availability.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/domain/rules dev/src/domain/availability.ts dev/src/domain/availability.test.ts
git commit -m "feat: define game planning rules"
```

---

### Task 2: Model persistent members and schema-v2 playthroughs

**Files:**
- Create: `dev/src/domain/timeline/model.ts`
- Create: `dev/src/domain/timeline/model.test.ts`
- Modify: `dev/src/domain/playthrough.ts`
- Modify: `dev/src/domain/playthrough.test.ts`
- Modify: `dev/src/domain/team.ts`
- Modify: `dev/src/domain/team.test.ts`

**Interfaces:**
- Consumes: `GameRules`, legacy `TeamState`, and `PlaythroughPackIndex`.
- Produces: `PersistentMember`, `MemberSnapshot`, `TimelineKeyframe`, `LifecycleEvent`, `TimelineState`, `ResolvedTeamState`, playthrough schema version `2`, `migratePlaythroughV1`.

- [ ] **Step 1: Write failing identity and migration tests**

```ts
it('keeps duplicate species distinct by member id and sequence', () => {
  const state = parseTimelineState({
    members: {
      m1: member({ id: 'm1', speciesId: 56, speciesSequence: 1 }),
      m2: member({ id: 'm2', speciesId: 56, speciesSequence: 2 }),
    },
    keyframes: {}, overrides: {}, preferences: defaultTimelinePreferences(),
  }, packIndex);
  expect(state.members.m1.speciesSequence).toBe(1);
  expect(state.members.m2.speciesSequence).toBe(2);
});

it('migrates v1 primary and reserve members into one explicit keyframe', () => {
  const result = migratePlaythrough(legacyPlaythrough(), packIndex);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.playthrough.schemaVersion).toBe(2);
  expect(result.playthrough.timeline.keyframes['misty-gym'].party[0]).toBe('legacy-primary-1');
  expect(result.playthrough.timeline.keyframes['misty-gym'].reserve).toContain('legacy-reserve-1');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/domain/timeline/model.test.ts src/domain/playthrough.test.ts`

Expected: FAIL because timeline schemas and schema version 2 are missing.

- [ ] **Step 3: Implement strict timeline schemas**

Use Zod strict objects and these shapes:

```ts
export type MemberPlacement = 'party' | 'reserve' | 'released';
export interface PersistentMember {
  id: string;
  originalSpeciesId: number;
  speciesSequence: number;
  nickname: string | null;
  natureId: string | null;
  origin: MemberOrigin;
  acquiredAtNodeId: string;
  notes: string;
  lifecycle: LifecycleEvent[];
}
export interface MemberSnapshot {
  speciesId: number;
  level: number;
  abilityId: number;
  moves: PlannedMove[];
  heldItemId: number | null;
  placement: MemberPlacement;
  partySlot: SlotIndex | null;
  review: { moves: boolean; heldItem: boolean };
}
export interface TimelineKeyframe {
  nodeId: string;
  kind: 'major' | 'override';
  party: readonly [string | null, string | null, string | null, string | null, string | null, string | null];
  reserve: readonly string[];
  released: readonly string[];
  snapshots: Readonly<Record<string, MemberSnapshot>>;
}
```

Reuse legacy member IDs during migration. Use current milestone, then preview milestone, then Starter as the deterministic migration keyframe. Preserve legacy fields exactly; do not invent release/origin overrides.

- [ ] **Step 4: Run model, migration, repository and export tests**

Run: `npm run test -- src/domain/timeline/model.test.ts src/domain/playthrough.test.ts src/persistence/repository.test.ts src/persistence/indexeddb-repository.test.ts src/persistence/export-import.test.ts && npm run typecheck`

Expected: PASS after updating fixtures to schema v2 through shared builders.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/domain/timeline/model.ts dev/src/domain/timeline/model.test.ts dev/src/domain/playthrough.ts dev/src/domain/playthrough.test.ts dev/src/domain/team.ts dev/src/domain/team.test.ts dev/src/persistence
git commit -m "feat: model milestone team timelines"
```

---

### Task 3: Implement member lifecycle and placement commands

**Files:**
- Create: `dev/src/domain/timeline/commands.ts`
- Create: `dev/src/domain/timeline/commands.test.ts`
- Modify: `dev/src/domain/timeline/model.ts`

**Interfaces:**
- Consumes: `TimelineState`, `TimelineKeyframe`, `MemberSnapshot`, `MemberPackView`.
- Produces: `acquireMember`, `placeInParty`, `moveToReserve`, `releaseMember`, `restoreMember`, `editMemberSnapshot`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('numbers duplicate acquisitions independently', () => {
  const one = acquireMember(emptyTimeline(), acquisition({ memberId: 'm1', speciesId: 56 }), view);
  const two = acquireMember(one, acquisition({ memberId: 'm2', speciesId: 56 }), view);
  expect(two.members.m2.speciesSequence).toBe(2);
});

it('moves replaced party members to reserve', () => {
  const next = placeInParty(stateWithParty('old'), 'misty-gym', 'new', 0, view);
  expect(next.keyframes['misty-gym'].party[0]).toBe('new');
  expect(next.keyframes['misty-gym'].reserve).toContain('old');
});

it('restores the same identity and records a permanent audit event', () => {
  const restored = restoreMember(releasedState(), 'misty-gym', 'm1');
  expect(restored.keyframes['misty-gym'].reserve).toContain('m1');
  expect(restored.members.m1.lifecycle.at(-1)?.type).toBe('restored');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/domain/timeline/commands.test.ts`

Expected: FAIL because timeline commands do not exist.

- [ ] **Step 3: Implement immutable commands and invariants**

Each command clones only affected records, validates one-placement-per-member and six party slots, appends lifecycle events instead of deleting history, and returns a parsed `TimelineState`. Release records node and reason; restore defaults to reserve and never removes the prior release event.

- [ ] **Step 4: Run commands and model tests**

Run: `npm run test -- src/domain/timeline/commands.test.ts src/domain/timeline/model.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/domain/timeline/commands.ts dev/src/domain/timeline/commands.test.ts dev/src/domain/timeline/model.ts
git commit -m "feat: manage timeline member lifecycle"
```

---

### Task 4: Resolve sparse keyframes and detailed-route interpolation

**Files:**
- Create: `dev/src/domain/timeline/resolver.ts`
- Create: `dev/src/domain/timeline/resolver.test.ts`
- Modify: `dev/src/domain/rules/game-rules.ts`
- Modify: `dev/src/domain/rules/firered-rules.ts`

**Interfaces:**
- Consumes: `TimelineState`, target node ID, ordered progression nodes, `GameRules`, pack lookups.
- Produces: `resolveTimelineNode(input): ResolvedTimelineNode`, `interpolateLevel`, `eligibleLevelEvolution`.

- [ ] **Step 1: Write failing interpolation tests**

```ts
it('does not place a target member before its acquisition node', () => {
  const beforeRoute22 = resolveTimelineNode(inputAt('route-1', brockKeyframeWithMankey()));
  const atRoute22 = resolveTimelineNode(inputAt('route-22', brockKeyframeWithMankey()));
  expect(beforeRoute22.party).not.toContain('mankey-1');
  expect(atRoute22.party).toContain('mankey-1');
});

it('freezes reserve state while active members auto-level', () => {
  const result = resolveTimelineNode(inputAt('cerulean-city', timelineWithBoxedPidgey()));
  expect(result.snapshots['boxed-pidgey'].level).toBe(6);
  expect(result.snapshots['active-mankey'].level).toBe(20);
});

it('auto-evolves only level-triggered evolutions when enabled', () => {
  expect(resolveTimelineNode(autoEvolveInput()).snapshots.charmander.speciesId).toBe(5);
  expect(resolveTimelineNode(itemEvolutionInput()).snapshots.nidorino.speciesId).toBe(33);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/domain/timeline/resolver.test.ts`

Expected: FAIL because the resolver is missing.

- [ ] **Step 3: Implement deterministic resolution**

```ts
export interface ResolveTimelineInput {
  timeline: TimelineState;
  nodeId: string;
  progression: RouteProgression;
  rules: GameRules;
  pack: TimelinePackView;
}
export interface ResolvedTimelineNode {
  nodeId: string;
  source: 'explicit-major' | 'explicit-override' | 'auto-filled';
  party: TimelineKeyframe['party'];
  reserve: readonly string[];
  released: readonly string[];
  snapshots: Readonly<Record<string, MemberSnapshot>>;
}
```

Resolve exact override first, otherwise interpolate between surrounding explicit keyframes. Gate each member at `acquiredAtNodeId`. Apply level mode only while active. Apply only level-triggered evolution when `autoEvolveLevel` is true. Keep item/trade/friendship/choice stages explicit.

- [ ] **Step 4: Run resolver, evolution and progression tests**

Run: `npm run test -- src/domain/timeline/resolver.test.ts src/domain/progression.test.ts scripts/data/firered/evolutions.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/domain/timeline/resolver.ts dev/src/domain/timeline/resolver.test.ts dev/src/domain/rules
git commit -m "feat: resolve milestone team states"
```

---

### Task 5: Apply scoped timeline propagation

**Files:**
- Create: `dev/src/domain/timeline/propagation.ts`
- Create: `dev/src/domain/timeline/propagation.test.ts`
- Modify: `dev/src/domain/timeline/commands.ts`

**Interfaces:**
- Produces: `PropagationScope = 'here' | 'forward' | 'all-populated'`, `previewPropagation`, `applyPropagation`.
- Consumes: typed `TimelineEdit`, milestone order, explicit keyframes/overrides.

- [ ] **Step 1: Write failing propagation tests**

```ts
it('stops forward slot replacement at a later explicit slot override', () => {
  const preview = previewPropagation(timeline, replaceSlotEdit('misty-gym', 1, 'pikachu'), 'forward', order);
  expect(preview.targetNodeIds).toEqual(['misty-gym', 'erika-gym']);
  expect(preview.protectedNodeIds).toContain('koga-gym');
});

it('changes only the selected field for change-all', () => {
  const next = applyPropagation(timeline, editAbility('mankey-1', 72), 'all-populated', order);
  expect(next.keyframes['brock-gym'].snapshots['mankey-1'].moves).toEqual(originalMoves);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/domain/timeline/propagation.test.ts`

Expected: FAIL because propagation functions are missing.

- [ ] **Step 3: Implement preview-before-apply propagation**

`previewPropagation` returns affected, skipped, protected and conflict node IDs. `applyPropagation` requires the preview token/version so UI confirmation cannot apply against stale state. Replace-slot edits move displaced members to reserve at each target. Field edits preserve unrelated snapshot properties.

- [ ] **Step 4: Run propagation and command tests**

Run: `npm run test -- src/domain/timeline/propagation.test.ts src/domain/timeline/commands.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/domain/timeline/propagation.ts dev/src/domain/timeline/propagation.test.ts dev/src/domain/timeline/commands.ts
git commit -m "feat: propagate timeline edits safely"
```

---

### Task 6: Build permissive validation and origin inference

**Files:**
- Create: `dev/src/domain/timeline/validation.ts`
- Create: `dev/src/domain/timeline/validation.test.ts`
- Modify: `dev/src/domain/rules/game-rules.ts`
- Modify: `dev/src/domain/rules/firered-rules.ts`
- Modify: `dev/src/domain/availability.ts`

**Interfaces:**
- Produces: `TimelineFinding`, `FindingSeverity`, `inferMemberOrigin`, `validateResolvedNode`.
- Consumes: resolved node, progression context, pack acquisition/evolution/learnset data, game rules.

- [ ] **Step 1: Write failing severity tests**

```ts
it('reports conditional egg origin as yellow and never throws', () => {
  const findings = validateResolvedNode(nodeWithEggMove(), validationContext());
  expect(findings).toContainEqual(expect.objectContaining({ code: 'move.egg-origin', severity: 'yellow' }));
});

it('reports trading before trade unlock as red', () => {
  const findings = validateResolvedNode(nodeWithExternalTradeBeforeUnlock(), validationContext());
  expect(findings).toContainEqual(expect.objectContaining({ code: 'origin.trade-locked', severity: 'red' }));
});

it('keeps restored audit as a permanent yellow finding', () => {
  expect(validateResolvedNode(restoredNode(), validationContext())).toContainEqual(
    expect.objectContaining({ code: 'member.restored', memberId: 'm1', severity: 'yellow' }),
  );
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/domain/timeline/validation.test.ts`

Expected: FAIL because validation does not exist.

- [ ] **Step 3: Implement evidence-backed findings**

```ts
export type FindingSeverity = 'review' | 'yellow' | 'red' | 'unverified';
export interface TimelineFinding {
  code: string;
  severity: FindingSeverity;
  memberId: string | null;
  field: 'member' | 'origin' | 'level' | 'evolution' | 'ability' | 'move' | 'held-item' | 'resource';
  summary: string;
  explanation: string;
  evidenceIds: readonly string[];
  resolutions: readonly FindingResolution[];
}
```

Infer the earliest ordinary acquisition path valid at the node. Only request explicit hatched/external-trade/event overrides when configuration requires them. Distinguish self-obtained from traded obedience. Return `unverified` where pack data is absent. Never throw for an invalid user configuration; throw only for corrupt canonical inputs.

- [ ] **Step 4: Run validation, availability and pack tests**

Run: `npm run test -- src/domain/timeline/validation.test.ts src/domain/availability.test.ts src/domain/pack.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/domain/timeline/validation.ts dev/src/domain/timeline/validation.test.ts dev/src/domain/rules dev/src/domain/availability.ts
git commit -m "feat: explain timeline legality"
```

---

### Task 7: Evaluate capabilities, copied-state review and finite resources

**Files:**
- Create: `dev/src/domain/timeline/capabilities.ts`
- Create: `dev/src/domain/timeline/capabilities.test.ts`
- Modify: `dev/src/domain/timeline/validation.ts`
- Modify: `dev/src/domain/timeline/commands.ts`

**Interfaces:**
- Produces: `CapabilityState = 'knows' | 'can-now' | 'conditional' | 'none'`, `evaluateCapability`, `evaluateResourceAssignments`, `copyKeyframe`.

- [ ] **Step 1: Write failing capability and review tests**

```ts
it('distinguishes knows, can-now and conditional', () => {
  expect(evaluateCapability(memberKnowingSurf(), surfContext()).state).toBe('knows');
  expect(evaluateCapability(laprasWithoutSurf(), surfContext()).state).toBe('can-now');
  expect(evaluateCapability(futureLapras(), preSafariContext()).state).toBe('conditional');
});

it('marks copied moves and held item for review', () => {
  const next = copyKeyframe(timeline, 'brock-gym', 'misty-gym', { levelMode: 'match', autoEvolveLevel: true });
  expect(next.keyframes['misty-gym'].snapshots.m1.review).toEqual({ moves: true, heldItem: true });
});

it('returns unverified for resources missing canonical inventory', () => {
  expect(evaluateResourceAssignments(node, noItemInventory())).toContainEqual(
    expect.objectContaining({ severity: 'unverified', code: 'resource.inventory-missing' }),
  );
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/domain/timeline/capabilities.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement capability evidence and keyframe copy**

Capability evidence must include move/source IDs and a human explanation. `copyKeyframe` copies party and reserve, applies level mode only to active members, applies only level evolutions when enabled, and sets review markers. Resource validation consumes an optional rules inventory; absence yields `unverified` rather than a conflict.

- [ ] **Step 4: Run capability, resolver and validation tests**

Run: `npm run test -- src/domain/timeline/capabilities.test.ts src/domain/timeline/resolver.test.ts src/domain/timeline/validation.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/domain/timeline/capabilities.ts dev/src/domain/timeline/capabilities.test.ts dev/src/domain/timeline/validation.ts dev/src/domain/timeline/commands.ts
git commit -m "feat: evaluate planning capabilities"
```

---

### Task 8: Add deterministic JSON files and portable plan codes

**Files:**
- Modify: `dev/package.json`
- Modify: `dev/package-lock.json`
- Create: `dev/src/persistence/plan-code.ts`
- Create: `dev/src/persistence/plan-code.test.ts`
- Modify: `dev/src/persistence/export-import.ts`
- Modify: `dev/src/persistence/export-import.test.ts`

**Interfaces:**
- Produces: `encodePlanCode`, `decodePlanCode`, `preparePlanCodeImport`, `createPlaythroughDownload`.
- Consumes: schema-v2 playthrough and `migratePlaythrough`.

- [ ] **Step 1: Install the pinned zero-dependency codec**

Run: `npm install fflate@0.8.3`

Expected: `package.json` and lockfile pin `fflate` 0.8.3.

- [ ] **Step 2: Write failing round-trip and corruption tests**

```ts
it('encodes deterministic self-contained plan codes', () => {
  expect(encodePlanCode(playthrough)).toBe(encodePlanCode(deepClone(playthrough)));
  expect(decodePlanCode(encodePlanCode(playthrough), pack).playthrough).toEqual(playthrough);
});

it('rejects checksum errors before decompression', () => {
  expect(() => decodePlanCode(`${encodePlanCode(playthrough)}x`, pack)).toThrow('checksum');
});

it('rejects an expanded payload above the fixed limit', () => {
  expect(() => decodePlanCode(oversizedCode, pack)).toThrow('expanded size limit');
});
```

- [ ] **Step 3: Verify RED**

Run: `npm run test -- src/persistence/plan-code.test.ts src/persistence/export-import.test.ts`

Expected: FAIL because the codec is missing.

- [ ] **Step 4: Implement versioned plan codes**

Format: `PP1.<base64url(deflateRaw(canonicalCompactJson))>.<crc32hex>`. Use `fflate` synchronous raw DEFLATE and CRC32 over compressed bytes. Enforce 256 KiB compressed and 4 MiB expanded limits. Canonicalize keys and stable arrays; exclude pack records, derived nodes and findings. Decode checksum, size, format version, schema migration and pack references before returning an import preview.

`createPlaythroughDownload` returns `{ filename, blob }` using normalized run name and `.json`.

- [ ] **Step 5: Run persistence and full type checks**

Run: `npm run test -- src/persistence/plan-code.test.ts src/persistence/export-import.test.ts src/domain/playthrough.test.ts && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add dev/package.json dev/package-lock.json dev/src/persistence
git commit -m "feat: share portable team plans"
```

---

### Task 9: Integrate schema migration, starter creation and durable recovery

**Files:**
- Modify: `dev/src/App.tsx`
- Modify: `dev/src/App.test.tsx`
- Modify: `dev/src/features/setup/GameSetup.tsx`
- Modify: `dev/src/features/setup/GameSetup.test.tsx`
- Modify: `dev/src/persistence/repository.ts`
- Modify: `dev/src/persistence/repository.test.ts`
- Modify: `dev/src/persistence/indexeddb-repository.ts`
- Modify: `dev/src/persistence/indexeddb-repository.test.ts`

**Interfaces:**
- Consumes: `FIRE_RED_RULES.initialProgress`, schema-v2 creation/migration, file/code persistence helpers.
- Produces: starter member/keyframe on new run, migration-on-read, last-durable versus unsaved UI state.

- [ ] **Step 1: Write failing application integration tests**

```tsx
it('creates the starter member and targets Brock', async () => {
  render(<App {...fixtures()} />);
  await user.click(await screen.findByRole('button', { name: 'Charmander' }));
  await user.click(screen.getByRole('button', { name: 'Start FireRed' }));
  expect(await screen.findByText('Brock')).toBeInTheDocument();
  expect(saved().timeline.keyframes.starter.party[0]).toBe(saved().starterMemberId);
});

it('keeps unsaved edits in memory when a write fails', async () => {
  render(<App {...failingAfterFirstWrite()} />);
  await editTimeline();
  expect(await screen.findByRole('alert')).toHaveTextContent('not saved');
  expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/App.test.tsx src/features/setup/GameSetup.test.tsx src/persistence/repository.test.ts src/persistence/indexeddb-repository.test.ts`

Expected: FAIL against v1 creation and current save flow.

- [ ] **Step 3: Implement migration-on-read and starter boot**

Repository `get/list` migrates candidates, validates before write-back, and preserves previous raw data on failure. Setup uses the rules-provided starter gate and first target. App tracks `lastDurable` and `activeDraft`; failed `put` leaves the draft rendered with Retry/Export actions.

- [ ] **Step 4: Run application, persistence and setup tests**

Run: `npm run test -- src/App.test.tsx src/features/setup/GameSetup.test.tsx src/persistence && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/App.tsx dev/src/App.test.tsx dev/src/features/setup dev/src/persistence
git commit -m "feat: migrate and recover timeline runs"
```

---

### Task 10: Build desktop milestone timeline and pools

**Files:**
- Create: `dev/src/features/timeline/TeamTimeline.tsx`
- Create: `dev/src/features/timeline/TeamTimeline.test.tsx`
- Create: `dev/src/features/timeline/MilestoneRuler.tsx`
- Create: `dev/src/features/timeline/MilestoneRuler.test.tsx`
- Create: `dev/src/features/timeline/MemberPool.tsx`
- Create: `dev/src/features/timeline/MemberPool.test.tsx`
- Modify: `dev/src/features/workbench/Workbench.tsx`
- Modify: `dev/src/features/workbench/Workbench.test.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- Consumes: resolved nodes, findings, `copyKeyframe`, lifecycle commands, propagation previews.
- Produces: Major Events/Detailed Planning timeline, party slots, reserve/released pools, Auto-filled/Explicit/Overridden labels.

- [ ] **Step 1: Write failing timeline UI tests**

```tsx
it('copies the previous milestone with level and level-evolution options', async () => {
  renderTimeline();
  await user.click(screen.getByRole('button', { name: 'Copy previous' }));
  await user.click(screen.getByRole('checkbox', { name: 'Auto-level active party' }));
  await user.click(screen.getByRole('checkbox', { name: 'Auto-evolve level evolutions' }));
  await user.click(screen.getByRole('button', { name: 'Create Misty keyframe' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ keyframes: expect.any(Object) }));
});

it('shows reserve as an unbounded pool and released as a separate archive', () => {
  renderTimeline({ reserveCount: 12, releasedCount: 2 });
  expect(screen.getByRole('region', { name: 'Reserve · 12 Pokémon' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Released · 2 Pokémon' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/features/timeline src/features/workbench/Workbench.test.tsx`

Expected: FAIL because timeline components are missing.

- [ ] **Step 3: Implement semantic desktop timeline**

Use buttons/regions/lists, not clickable divs. Major Events is default; Detailed Planning resolves route nodes. Auto-filled nodes are visually lighter and editing promotes them to overrides. Keep styles monochrome, square and responsive to the supplied wireframe hierarchy.

- [ ] **Step 4: Run timeline and workbench tests**

Run: `npm run test -- src/features/timeline src/features/workbench/Workbench.test.tsx && npm run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/features/timeline dev/src/features/workbench/Workbench.tsx dev/src/features/workbench/Workbench.test.tsx dev/src/styles.css
git commit -m "feat: add milestone team timeline"
```

---

### Task 11: Add member editing, findings, propagation and mobile timeline

**Files:**
- Create: `dev/src/features/timeline/TimelineMemberEditor.tsx`
- Create: `dev/src/features/timeline/TimelineMemberEditor.test.tsx`
- Modify: `dev/src/features/timeline/TeamTimeline.tsx`
- Modify: `dev/src/features/timeline/TeamTimeline.test.tsx`
- Modify: `dev/src/features/timeline/MemberPool.tsx`
- Modify: `dev/src/features/timeline/MemberPool.test.tsx`
- Modify: `dev/src/styles.css`

**Interfaces:**
- Consumes: snapshot edit commands, findings, propagation preview/apply, capability evidence.
- Produces: level/evolution/ability/move/held-item/origin/nature editor, lifecycle confirmations, scope chooser, accessible finding details, mobile sheet.

- [ ] **Step 1: Write failing editor tests**

```tsx
it('previews forward propagation before applying', async () => {
  renderEditor();
  await user.selectOptions(screen.getByLabelText('Ability'), '72');
  await user.click(screen.getByRole('radio', { name: 'Here and future populated milestones' }));
  expect(screen.getByText('Affects 3 milestones')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Apply change' }));
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ scope: 'forward' }));
});

it('restores focus and retains the restored warning', async () => {
  renderReleasedMember();
  await user.click(screen.getByRole('button', { name: 'Restore Mankey #2' }));
  await user.click(screen.getByRole('button', { name: 'Confirm restore' }));
  expect(screen.getByText('Restored Pokémon')).toBeInTheDocument();
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run test -- src/features/timeline/TimelineMemberEditor.test.tsx src/features/timeline/MemberPool.test.tsx`

Expected: FAIL.

- [ ] **Step 3: Implement editor and mobile sheet**

Snapshot fields change only the selected milestone until a scope is chosen. Member-wide nature and notes changes use the same preview/apply flow but remain stable across milestones. Origin resolutions are explicit buttons. Findings have focusable summaries and explanations. Right-click actions also have visible buttons and keyboard equivalents. At 390px, render one member lane per row and the editor as a focus-trapped full-height dialog; restore trigger focus on close.

- [ ] **Step 4: Run timeline UI, accessibility and full checks**

Run: `npm run test -- src/features/timeline src/App.test.tsx && npm run check`

Expected: all tests, typecheck, data verification and build PASS.

- [ ] **Step 5: Commit**

```powershell
git add dev/src/features/timeline dev/src/styles.css
git commit -m "feat: edit milestone team plans"
```

---

### Task 12: Verify timeline acceptance boundary

**Files:**
- Modify: `dev/src/App.test.tsx`
- Modify: `dev/src/test/firered-pack.ts`
- Modify: `dev/README.md`

**Interfaces:**
- Consumes: all Task 1–11 public interfaces.
- Produces: one integration fixture/journey proving the timeline subsystem is ready for workbench consumption.

- [ ] **Step 1: Add the complete timeline acceptance test**

Create one integration test that:

```ts
// 1. Creates two Mankey members and asserts distinct IDs/sequence labels.
// 2. Targets Brock and verifies Mankey is absent before Route 22.
// 3. Boxes one member and confirms its level freezes through Misty.
// 4. Releases/restores it and checks the permanent finding.
// 5. Applies a hatched origin for an egg-only move.
// 6. Propagates a replacement forward without overwriting a later explicit override.
// 7. Promotes one auto-filled route to an override.
// 8. Encodes and imports a plan code with identical persistent state.
```

- [ ] **Step 2: Run the new integration test and verify RED if any boundary is missing**

Run: `npm run test -- src/App.test.tsx`

Expected: PASS only when every timeline acceptance boundary is wired through App; otherwise fix the missing boundary with a focused RED/GREEN cycle before continuing.

- [ ] **Step 3: Document timeline and sharing usage**

Update `dev/README.md` with Major/Detailed planning, reserve/release semantics, JSON download, plan-code sharing, and the warning model. Do not document workbench-overhaul UI before its plan is executed.

- [ ] **Step 4: Run final plan-1 verification**

Run: `npm run check && git diff --check`

Expected: 0 failures and no whitespace errors.

- [ ] **Step 5: Commit the timeline boundary**

```powershell
git add dev/src/App.test.tsx dev/src/test/firered-pack.ts dev/README.md
git commit -m "test: verify milestone timeline journey"
```

## Plan-1 handoff gate

Before starting the workbench plan, confirm:

- `npm run check` passes.
- Schema-v1 fixtures migrate deterministically to schema v2.
- Timeline resolver, validator and plan-code modules have no React dependencies.
- The public interfaces named in this plan match their tests.
- No workbench layout overhaul was mixed into the timeline commits.
- Do not run branch-wide `/simplify` or `/code-review` yet; those run once after plan 2.
