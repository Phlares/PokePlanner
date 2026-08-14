import { z } from 'zod';
import type { LevelMode } from '../rules/game-rules';
import type { MemberPackView, PlannedMove, SlotIndex } from '../team';
import { validateTeamMember } from '../team';

export type MemberPlacement = 'party' | 'reserve' | 'released';

/** Canonical lookup boundary required to validate every persisted timeline reference. */
export interface TimelinePackView extends MemberPackView {
  hasNode(nodeId: string): boolean;
  hasMilestone(milestoneId: string): boolean;
  hasAcquisition(acquisitionId: string): boolean;
}

/** A saved origin choice. `inferred` deliberately carries no claimed canonical acquisition. */
export interface MemberOrigin {
  type: 'inferred' | 'hatched' | 'external-trade' | 'transfer' | 'event' | 'other';
  acquisitionId: string | null;
  note: string | null;
}

/** An auditable ownership transition; no lifecycle event deletes a member. */
export interface LifecycleEvent {
  type: 'acquired' | 'placed-party' | 'moved-reserve' | 'released' | 'restored';
  nodeId: string;
  from: MemberPlacement | null;
  to: MemberPlacement | null;
  reason: string | null;
}

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

/** The complete user-authored data needed to add one persistent member at a timeline node. */
export interface MemberAcquisition {
  memberId: string;
  speciesId: number;
  nodeId: string;
  abilityId: number;
  level: number;
  moves: PlannedMove[];
  heldItemId: number | null;
  origin: MemberOrigin;
  nickname: string | null;
  natureId: string | null;
  notes: string;
}

export interface TimelineKeyframe {
  nodeId: string;
  kind: 'major' | 'override';
  party: readonly [string | null, string | null, string | null, string | null, string | null, string | null];
  reserve: readonly string[];
  released: readonly string[];
  snapshots: Readonly<Record<string, MemberSnapshot>>;
}

export interface TimelinePreferences {
  levelMode: LevelMode;
  autoEvolveLevel: boolean;
}

/** The complete saved timeline. Generated route states and findings are intentionally absent. */
export interface TimelineState {
  members: Record<string, PersistentMember>;
  keyframes: Record<string, TimelineKeyframe>;
  overrides: Record<string, TimelineKeyframe>;
  preferences: TimelinePreferences;
}

/** A resolver output shape. It is derived only and must never be serialized as TimelineState. */
export interface ResolvedTeamState {
  nodeId: string;
  source: 'explicit' | 'derived' | 'override';
  party: TimelineKeyframe['party'];
  reserve: readonly string[];
  released: readonly string[];
  snapshots: Readonly<Record<string, MemberSnapshot>>;
}

const plannedMoveSchema = z.object({
  moveId: z.number().int().positive(),
  status: z.enum(['available-now', 'future-level', 'future-milestone']),
  level: z.number().int().positive().nullable(),
  milestoneId: z.string().min(1).nullable(),
}).strict();

const memberOriginSchema = z.object({
  type: z.enum(['inferred', 'hatched', 'external-trade', 'transfer', 'event', 'other']),
  acquisitionId: z.string().min(1).nullable(),
  note: z.string().nullable(),
}).strict();

const lifecycleEventSchema = z.object({
  type: z.enum(['acquired', 'placed-party', 'moved-reserve', 'released', 'restored']),
  nodeId: z.string().min(1),
  from: z.enum(['party', 'reserve', 'released']).nullable(),
  to: z.enum(['party', 'reserve', 'released']).nullable(),
  reason: z.string().nullable(),
}).strict();

const persistentMemberSchema = z.object({
  id: z.string().min(1),
  originalSpeciesId: z.number().int().positive(),
  speciesSequence: z.number().int().positive(),
  nickname: z.string().nullable(),
  natureId: z.string().min(1).nullable(),
  origin: memberOriginSchema,
  acquiredAtNodeId: z.string().min(1),
  notes: z.string(),
  lifecycle: z.array(lifecycleEventSchema),
}).strict();

const snapshotSchema = z.object({
  speciesId: z.number().int().positive(),
  level: z.number().int().min(1).max(100),
  abilityId: z.number().int().positive(),
  moves: z.array(plannedMoveSchema).max(4),
  heldItemId: z.number().int().positive().nullable(),
  placement: z.enum(['party', 'reserve', 'released']),
  partySlot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).nullable(),
  review: z.object({ moves: z.boolean(), heldItem: z.boolean() }).strict(),
}).strict();

const memberIdSchema = z.string().min(1);
const partySchema = z.tuple([
  memberIdSchema.nullable(), memberIdSchema.nullable(), memberIdSchema.nullable(),
  memberIdSchema.nullable(), memberIdSchema.nullable(), memberIdSchema.nullable(),
]);
const keyframeSchema = z.object({
  nodeId: z.string().min(1),
  kind: z.enum(['major', 'override']),
  party: partySchema,
  reserve: z.array(memberIdSchema),
  released: z.array(memberIdSchema),
  snapshots: z.record(memberIdSchema, snapshotSchema),
}).strict();
const preferencesSchema = z.object({
  levelMode: z.enum(['manual', 'under', 'match', 'over']),
  autoEvolveLevel: z.boolean(),
}).strict();
const timelineStateSchema = z.object({
  members: z.record(memberIdSchema, persistentMemberSchema),
  keyframes: z.record(memberIdSchema, keyframeSchema),
  overrides: z.record(memberIdSchema, keyframeSchema),
  preferences: preferencesSchema,
}).strict();

/** Default saved preferences are deliberately conservative: no automatic level/evolution edits. */
export function defaultTimelinePreferences(): TimelinePreferences {
  return { levelMode: 'manual', autoEvolveLevel: false };
}

/** A fresh timeline has no explicit state and therefore no derived state persisted. */
export function createEmptyTimeline(): TimelineState {
  return { members: {}, keyframes: {}, overrides: {}, preferences: defaultTimelinePreferences() };
}

function assertMemberSnapshot(snapshot: MemberSnapshot, memberId: string, pack: TimelinePackView): void {
  validateTeamMember({
    id: memberId,
    speciesId: snapshot.speciesId,
    level: snapshot.level,
    abilityId: snapshot.abilityId,
    moves: snapshot.moves,
  }, pack);
  if ((snapshot.placement === 'party') !== (snapshot.partySlot !== null)) {
    throw new Error(`Snapshot for member "${memberId}" must carry a party slot exactly when placed in party`);
  }
  for (const move of snapshot.moves) {
    if (move.milestoneId !== null && !pack.hasMilestone(move.milestoneId)) {
      throw new Error(`Unknown future-move milestone id "${move.milestoneId}" for member "${memberId}"`);
    }
  }
}

function assertKeyframe(key: string, keyframe: TimelineKeyframe, members: Record<string, PersistentMember>, pack: TimelinePackView): void {
  if (key !== keyframe.nodeId) throw new Error(`Timeline keyframe record key "${key}" must equal node id "${keyframe.nodeId}"`);
  if (!pack.hasNode(keyframe.nodeId)) throw new Error(`Unknown timeline node id "${keyframe.nodeId}"`);
  const placements = new Map<string, MemberPlacement>();
  const register = (memberId: string, placement: MemberPlacement, slot: SlotIndex | null) => {
    if (!members[memberId]) throw new Error(`Unknown timeline member id "${memberId}" at node "${key}"`);
    if (placements.has(memberId)) throw new Error(`Timeline member "${memberId}" has multiple placements at node "${key}"`);
    placements.set(memberId, placement);
    const snapshot = keyframe.snapshots[memberId];
    if (!snapshot) throw new Error(`Timeline member "${memberId}" has no snapshot at node "${key}"`);
    if (snapshot.placement !== placement || snapshot.partySlot !== slot) {
      throw new Error(`Snapshot placement does not match timeline placement for member "${memberId}" at node "${key}"`);
    }
  };
  keyframe.party.forEach((memberId, slot) => { if (memberId !== null) register(memberId, 'party', slot as SlotIndex); });
  keyframe.reserve.forEach((memberId) => register(memberId, 'reserve', null));
  keyframe.released.forEach((memberId) => register(memberId, 'released', null));
  for (const [memberId, snapshot] of Object.entries(keyframe.snapshots)) {
    if (!members[memberId]) throw new Error(`Unknown timeline snapshot member id "${memberId}" at node "${key}"`);
    if (!placements.has(memberId)) throw new Error(`Timeline snapshot member "${memberId}" has no placement at node "${key}"`);
    assertMemberSnapshot(snapshot, memberId, pack);
  }
}

/**
 * Parse only explicit, user-authored timeline data. Object schemas are strict so canonical pack
 * records, resolver output and findings cannot be persisted accidentally.
 */
export function parseTimelineState(input: unknown, pack: TimelinePackView): TimelineState {
  const state = timelineStateSchema.parse(input) as unknown as TimelineState;
  const sequencesBySpecies = new Map<number, Set<number>>();
  for (const [memberId, member] of Object.entries(state.members)) {
    if (memberId !== member.id) throw new Error(`Timeline member record key "${memberId}" must equal member id "${member.id}"`);
    if (!pack.hasSpecies(member.originalSpeciesId)) throw new Error(`Unknown original species ${member.originalSpeciesId} for member "${memberId}"`);
    const sequences = sequencesBySpecies.get(member.originalSpeciesId) ?? new Set<number>();
    if (sequences.has(member.speciesSequence)) {
      throw new Error(`Duplicate species sequence ${member.speciesSequence} for original species ${member.originalSpeciesId}`);
    }
    sequences.add(member.speciesSequence);
    sequencesBySpecies.set(member.originalSpeciesId, sequences);
    if (!pack.hasNode(member.acquiredAtNodeId)) throw new Error(`Unknown member acquisition node id "${member.acquiredAtNodeId}"`);
    for (const event of member.lifecycle) {
      if (!pack.hasNode(event.nodeId)) throw new Error(`Unknown lifecycle node id "${event.nodeId}" for member "${memberId}"`);
    }
    if (member.origin.acquisitionId !== null && !pack.hasAcquisition(member.origin.acquisitionId)) {
      throw new Error(`Unknown member origin acquisition id "${member.origin.acquisitionId}" for member "${memberId}"`);
    }
  }
  for (const [key, keyframe] of Object.entries(state.keyframes)) {
    if (keyframe.kind !== 'major') throw new Error(`Major keyframe "${key}" must have kind "major"`);
    assertKeyframe(key, keyframe, state.members, pack);
  }
  for (const [key, keyframe] of Object.entries(state.overrides)) {
    if (keyframe.kind !== 'override') throw new Error(`Timeline override "${key}" must have kind "override"`);
    assertKeyframe(key, keyframe, state.members, pack);
  }
  return state;
}
