import type { SlotIndex } from '../team';
import {
  parseTimelineState,
  type LifecycleEvent,
  type MemberAcquisition,
  type MemberPlacement,
  type MemberSnapshot,
  type PersistentMember,
  type TimelineKeyframe,
  type TimelinePackView,
  type TimelineState,
} from './model';

type KeyframeCollection = 'keyframes' | 'overrides';
export type MemberSnapshotPatch = Partial<Omit<MemberSnapshot, 'placement' | 'partySlot'>>;

interface KeyframeLocation {
  collection: KeyframeCollection;
  keyframe: TimelineKeyframe;
}

function assertPartySlot(slot: number): asserts slot is SlotIndex {
  if (!Number.isInteger(slot) || slot < 0 || slot > 5) {
    throw new Error(`Party slot must be an integer 0..5; received ${slot}`);
  }
}

function emptyKeyframe(nodeId: string): TimelineKeyframe {
  return {
    nodeId,
    kind: 'major',
    party: [null, null, null, null, null, null],
    reserve: [],
    released: [],
    snapshots: {},
  };
}

function keyframeAt(state: TimelineState, nodeId: string, pack: TimelinePackView): KeyframeLocation {
  const major = state.keyframes[nodeId];
  if (major) return { collection: 'keyframes', keyframe: major };
  const override = state.overrides[nodeId];
  if (override) return { collection: 'overrides', keyframe: override };
  if (!pack.hasNode(nodeId)) throw new Error(`Unknown timeline node id "${nodeId}"`);
  return { collection: 'keyframes', keyframe: emptyKeyframe(nodeId) };
}

function withKeyframe(state: TimelineState, location: KeyframeLocation, keyframe: TimelineKeyframe): TimelineState {
  return location.collection === 'keyframes'
    ? { ...state, keyframes: { ...state.keyframes, [keyframe.nodeId]: keyframe } }
    : { ...state, overrides: { ...state.overrides, [keyframe.nodeId]: keyframe } };
}

function placementAt(keyframe: TimelineKeyframe, memberId: string): MemberPlacement | null {
  const placements: MemberPlacement[] = [];
  if (keyframe.party.includes(memberId)) placements.push('party');
  if (keyframe.reserve.includes(memberId)) placements.push('reserve');
  if (keyframe.released.includes(memberId)) placements.push('released');
  if (placements.length > 1) throw new Error(`Timeline member "${memberId}" has multiple placements at node "${keyframe.nodeId}"`);
  return placements[0] ?? null;
}

function snapshotFor(state: TimelineState, keyframe: TimelineKeyframe, memberId: string): MemberSnapshot {
  const current = keyframe.snapshots[memberId];
  if (current) return current;
  for (const frame of [...Object.values(state.keyframes), ...Object.values(state.overrides)]) {
    const snapshot = frame.snapshots[memberId];
    if (snapshot) return snapshot;
  }
  throw new Error(`Timeline member "${memberId}" has no snapshot to place at node "${keyframe.nodeId}"`);
}

function withoutMember(keyframe: TimelineKeyframe, memberId: string): { keyframe: TimelineKeyframe; from: MemberPlacement | null } {
  const from = placementAt(keyframe, memberId);
  const party = keyframe.party.map((id) => id === memberId ? null : id) as unknown as TimelineKeyframe['party'];
  return {
    from,
    keyframe: {
      ...keyframe,
      party,
      reserve: keyframe.reserve.filter((id) => id !== memberId),
      released: keyframe.released.filter((id) => id !== memberId),
    },
  };
}

function withSnapshotPlacement(
  keyframe: TimelineKeyframe,
  memberId: string,
  snapshot: MemberSnapshot,
  placement: MemberPlacement,
  partySlot: SlotIndex | null,
): TimelineKeyframe {
  return {
    ...keyframe,
    snapshots: { ...keyframe.snapshots, [memberId]: { ...snapshot, placement, partySlot } },
  };
}

function lifecycle(type: LifecycleEvent['type'], nodeId: string, from: MemberPlacement | null, to: MemberPlacement, reason: string | null): LifecycleEvent {
  return { type, nodeId, from, to, reason };
}

function withLifecycle(state: TimelineState, memberId: string, event: LifecycleEvent): TimelineState {
  const member = state.members[memberId];
  if (!member) throw new Error(`Unknown timeline member id "${memberId}"`);
  return {
    ...state,
    members: { ...state.members, [memberId]: { ...member, lifecycle: [...member.lifecycle, event] } },
  };
}

function parsed(state: TimelineState, pack: TimelinePackView): TimelineState {
  return parseTimelineState(state, pack);
}

/** Acquire an identity once and place its first snapshot into the unbounded reserve pool. */
export function acquireMember(state: TimelineState, acquisition: MemberAcquisition, pack: TimelinePackView): TimelineState {
  if (state.members[acquisition.memberId]) throw new Error(`Timeline member id "${acquisition.memberId}" already exists`);
  const sequence = Object.values(state.members)
    .filter((member) => member.originalSpeciesId === acquisition.speciesId)
    .reduce((highest, member) => Math.max(highest, member.speciesSequence), 0) + 1;
  const member: PersistentMember = {
    id: acquisition.memberId,
    originalSpeciesId: acquisition.speciesId,
    speciesSequence: sequence,
    nickname: acquisition.nickname,
    natureId: acquisition.natureId,
    origin: acquisition.origin,
    acquiredAtNodeId: acquisition.nodeId,
    notes: acquisition.notes,
    lifecycle: [lifecycle('acquired', acquisition.nodeId, null, 'reserve', null)],
  };
  const location = keyframeAt(state, acquisition.nodeId, pack);
  const snapshot: MemberSnapshot = {
    speciesId: acquisition.speciesId,
    level: acquisition.level,
    abilityId: acquisition.abilityId,
    moves: acquisition.moves,
    heldItemId: acquisition.heldItemId,
    placement: 'reserve',
    partySlot: null,
    review: { moves: false, heldItem: false },
  };
  const keyframe = withSnapshotPlacement({ ...location.keyframe, reserve: [...location.keyframe.reserve, acquisition.memberId] }, acquisition.memberId, snapshot, 'reserve', null);
  return parsed(withKeyframe({ ...state, members: { ...state.members, [member.id]: member } }, location, keyframe), pack);
}

/** Put an existing member into a party slot, moving any replaced party member into reserve. */
export function placeInParty(state: TimelineState, nodeId: string, memberId: string, slot: SlotIndex, pack: TimelinePackView): TimelineState {
  assertPartySlot(slot);
  const location = keyframeAt(state, nodeId, pack);
  if (!state.members[memberId]) throw new Error(`Unknown timeline member id "${memberId}"`);
  const { keyframe: removed, from } = withoutMember(location.keyframe, memberId);
  if (from === 'released') throw new Error(`Timeline member "${memberId}" must be restored before party placement`);
  const party = removed.party.slice() as unknown as string[];
  const replacedId = party[slot];
  party[slot] = memberId;
  let keyframe = withSnapshotPlacement({ ...removed, party: party as unknown as TimelineKeyframe['party'] }, memberId, snapshotFor(state, location.keyframe, memberId), 'party', slot);
  let next = withKeyframe(state, location, keyframe);
  next = withLifecycle(next, memberId, lifecycle('placed-party', nodeId, from, 'party', null));
  if (replacedId !== null && replacedId !== memberId) {
    const replacedSnapshot = snapshotFor(state, location.keyframe, replacedId);
    keyframe = {
      ...keyframe,
      reserve: [...keyframe.reserve, replacedId],
      snapshots: { ...keyframe.snapshots, [replacedId]: { ...replacedSnapshot, placement: 'reserve', partySlot: null } },
    };
    next = withKeyframe(next, location, keyframe);
    next = withLifecycle(next, replacedId, lifecycle('moved-reserve', nodeId, 'party', 'reserve', null));
  }
  return parsed(next, pack);
}

/** Remove a currently placed member from party or release and retain its snapshot in reserve. */
export function moveToReserve(state: TimelineState, nodeId: string, memberId: string, pack: TimelinePackView): TimelineState {
  const location = keyframeAt(state, nodeId, pack);
  const { keyframe: removed, from } = withoutMember(location.keyframe, memberId);
  if (from === null) throw new Error(`Timeline member "${memberId}" has no placement at node "${nodeId}"`);
  const keyframe = withSnapshotPlacement({ ...removed, reserve: [...removed.reserve, memberId] }, memberId, snapshotFor(state, location.keyframe, memberId), 'reserve', null);
  return parsed(withLifecycle(withKeyframe(state, location, keyframe), memberId, lifecycle('moved-reserve', nodeId, from, 'reserve', null)), pack);
}

/** Archive a member without deleting its identity, prior snapshots, or lifecycle history. */
export function releaseMember(state: TimelineState, nodeId: string, memberId: string, reason: string | null, pack: TimelinePackView): TimelineState {
  const location = keyframeAt(state, nodeId, pack);
  const { keyframe: removed, from } = withoutMember(location.keyframe, memberId);
  if (from === null) throw new Error(`Timeline member "${memberId}" has no placement at node "${nodeId}"`);
  const keyframe = withSnapshotPlacement({ ...removed, released: [...removed.released, memberId] }, memberId, snapshotFor(state, location.keyframe, memberId), 'released', null);
  return parsed(withLifecycle(withKeyframe(state, location, keyframe), memberId, lifecycle('released', nodeId, from, 'released', reason)), pack);
}

/** Restore an archived identity to reserve while preserving its release audit event. */
export function restoreMember(state: TimelineState, nodeId: string, memberId: string, pack: TimelinePackView): TimelineState {
  const location = keyframeAt(state, nodeId, pack);
  const { keyframe: removed, from } = withoutMember(location.keyframe, memberId);
  if (from !== 'released') throw new Error(`Timeline member "${memberId}" must be released before restoration`);
  const keyframe = withSnapshotPlacement({ ...removed, reserve: [...removed.reserve, memberId] }, memberId, snapshotFor(state, location.keyframe, memberId), 'reserve', null);
  return parsed(withLifecycle(withKeyframe(state, location, keyframe), memberId, lifecycle('restored', nodeId, 'released', 'reserve', null)), pack);
}

/** Update only editable snapshot fields, retaining placement consistency with the keyframe. */
export function editMemberSnapshot(state: TimelineState, nodeId: string, memberId: string, patch: MemberSnapshotPatch, pack: TimelinePackView): TimelineState {
  const location = keyframeAt(state, nodeId, pack);
  const current = location.keyframe.snapshots[memberId];
  if (!current || placementAt(location.keyframe, memberId) === null) {
    throw new Error(`Timeline member "${memberId}" has no snapshot at node "${nodeId}"`);
  }
  const keyframe: TimelineKeyframe = {
    ...location.keyframe,
    snapshots: { ...location.keyframe.snapshots, [memberId]: { ...current, ...patch } },
  };
  return parsed(withKeyframe(state, location, keyframe), pack);
}
