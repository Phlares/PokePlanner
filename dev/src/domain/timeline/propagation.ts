import type { TimelineEdit } from './commands';
import type { MemberSnapshot, TimelineKeyframe, TimelineState } from './model';

export type PropagationScope = 'here' | 'forward' | 'all-populated';

export interface PropagationPreview {
  targetNodeIds: readonly string[];
  skippedNodeIds: readonly string[];
  protectedNodeIds: readonly string[];
  conflictNodeIds: readonly string[];
  /** Exact canonical state representation captured before user confirmation. */
  stateVersion: string;
  /** Binds the state version, edit, scope and milestone order into one confirmation token. */
  token: string;
}

interface OrderedFrame {
  nodeId: string;
  keyframe: TimelineKeyframe;
  order: number;
}

type MutableParty = {
  -readonly [Index in keyof TimelineKeyframe['party']]: TimelineKeyframe['party'][Index];
};

function stableValue(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(',')}}`;
}

function versionFor(timeline: TimelineState): string {
  return stableValue(timeline);
}

function tokenFor(stateVersion: string, edit: TimelineEdit, scope: PropagationScope, milestoneOrder: readonly string[]): string {
  return stableValue({ stateVersion, edit, scope, milestoneOrder: [...milestoneOrder] });
}

function orderedFrames(timeline: TimelineState, milestoneOrder: readonly string[]): OrderedFrame[] {
  const orders = new Map(milestoneOrder.map((nodeId, order) => [nodeId, order]));
  const frames = new Map<string, TimelineKeyframe>();
  Object.entries(timeline.keyframes).forEach(([nodeId, keyframe]) => frames.set(nodeId, keyframe));
  Object.entries(timeline.overrides).forEach(([nodeId, keyframe]) => frames.set(nodeId, keyframe));
  return [...frames.entries()]
    .map(([nodeId, keyframe]): OrderedFrame | null => {
      const order = orders.get(nodeId);
      return order === undefined ? null : { nodeId, keyframe, order };
    })
    .filter((entry): entry is OrderedFrame => entry !== null)
    .sort((left, right) => left.order - right.order || left.nodeId.localeCompare(right.nodeId));
}

function candidateFrames(
  frames: readonly OrderedFrame[],
  edit: TimelineEdit,
  scope: PropagationScope,
): OrderedFrame[] {
  if (scope === 'all-populated') return [...frames];
  if (edit.nodeId === null) {
    if (scope === 'here') throw new Error('Here propagation requires a selected node id');
    return [...frames];
  }
  const source = frames.find((frame) => frame.nodeId === edit.nodeId);
  if (!source) throw new Error(`Cannot propagate from unpopulated timeline node "${edit.nodeId}"`);
  return scope === 'here' ? [source] : frames.filter((frame) => frame.order >= source.order);
}

function cloneSnapshot(snapshot: MemberSnapshot, placement = snapshot.placement, partySlot = snapshot.partySlot): MemberSnapshot {
  return {
    ...snapshot,
    moves: snapshot.moves.map((move) => ({ ...move })),
    review: { ...snapshot.review },
    placement,
    partySlot,
  };
}

function findSnapshot(timeline: TimelineState, memberId: string): MemberSnapshot | null {
  for (const frame of [...Object.values(timeline.keyframes), ...Object.values(timeline.overrides)]) {
    const snapshot = frame.snapshots[memberId];
    if (snapshot) return snapshot;
  }
  return null;
}

function containsMember(keyframe: TimelineKeyframe, memberId: string): boolean {
  return keyframe.party.includes(memberId)
    || keyframe.reserve.includes(memberId)
    || keyframe.released.includes(memberId);
}

function replacementWouldConflict(
  timeline: TimelineState,
  frame: OrderedFrame,
  edit: Extract<TimelineEdit, { kind: 'replace-slot' }>,
  milestoneOrders: ReadonlyMap<string, number>,
): boolean {
  const acquiredAt = timeline.members[edit.memberId]?.acquiredAtNodeId;
  if (!acquiredAt) return true;
  const acquisitionOrder = milestoneOrders.get(acquiredAt);
  if (acquisitionOrder === undefined) return true;
  return frame.order < acquisitionOrder || frame.keyframe.released.includes(edit.memberId);
}

function replacementPreview(
  timeline: TimelineState,
  edit: Extract<TimelineEdit, { kind: 'replace-slot' }>,
  scope: PropagationScope,
  frames: readonly OrderedFrame[],
  milestoneOrder: readonly string[],
): Omit<PropagationPreview, 'stateVersion' | 'token'> {
  const candidates = candidateFrames(frames, edit, scope);
  const source = frames.find((frame) => frame.nodeId === edit.nodeId);
  if (!timeline.members[edit.memberId] || !findSnapshot(timeline, edit.memberId) || !source) {
    return { targetNodeIds: [], skippedNodeIds: [], protectedNodeIds: [], conflictNodeIds: candidates.map((frame) => frame.nodeId) };
  }
  const originalOccupant = source.keyframe.party[edit.slot];
  const targets: string[] = [];
  const protectedNodeIds: string[] = [];
  const conflictNodeIds: string[] = [];
  const milestoneOrders = new Map(milestoneOrder.map((nodeId, order) => [nodeId, order]));
  for (const frame of candidates) {
    const laterChangedOverride = scope === 'forward'
      && frame.order > source.order
      && timeline.overrides[frame.nodeId] !== undefined
      && frame.keyframe.party[edit.slot] !== originalOccupant;
    if (laterChangedOverride) {
      protectedNodeIds.push(frame.nodeId);
      break;
    }
    if (replacementWouldConflict(timeline, frame, edit, milestoneOrders)) {
      conflictNodeIds.push(frame.nodeId);
      continue;
    }
    if (frame.keyframe.party[edit.slot] !== edit.memberId) targets.push(frame.nodeId);
  }
  return { targetNodeIds: targets, skippedNodeIds: [], protectedNodeIds, conflictNodeIds };
}

function fieldPreview(edit: Extract<TimelineEdit, { kind: 'snapshot-field' }>, scope: PropagationScope, frames: readonly OrderedFrame[]): Omit<PropagationPreview, 'stateVersion' | 'token'> {
  const targets: string[] = [];
  const skipped: string[] = [];
  for (const frame of candidateFrames(frames, edit, scope)) {
    if (frame.keyframe.snapshots[edit.memberId] && containsMember(frame.keyframe, edit.memberId)) {
      targets.push(frame.nodeId);
    } else {
      skipped.push(frame.nodeId);
    }
  }
  return { targetNodeIds: targets, skippedNodeIds: skipped, protectedNodeIds: [], conflictNodeIds: [] };
}

/** Calculate exact propagation effects without changing the saved timeline. */
export function previewPropagation(
  timeline: TimelineState,
  edit: TimelineEdit,
  scope: PropagationScope,
  milestoneOrder: readonly string[],
): PropagationPreview {
  const stateVersion = versionFor(timeline);
  const frames = orderedFrames(timeline, milestoneOrder);
  const details = edit.kind === 'replace-slot'
    ? replacementPreview(timeline, edit, scope, frames, milestoneOrder)
    : fieldPreview(edit, scope, frames);
  return { ...details, stateVersion, token: tokenFor(stateVersion, edit, scope, milestoneOrder) };
}

function replaceAtFrame(keyframe: TimelineKeyframe, memberId: string, slot: number, template: MemberSnapshot): TimelineKeyframe {
  const displacedId = keyframe.party[slot];
  const party = keyframe.party.map((id) => id === memberId ? null : id) as unknown as MutableParty;
  party[slot] = memberId;
  const reserve = keyframe.reserve.filter((id) => id !== memberId && id !== displacedId);
  const released = keyframe.released.filter((id) => id !== memberId);
  const displacedSnapshot = displacedId === null ? null : keyframe.snapshots[displacedId];
  const replacementSnapshot = cloneSnapshot(
    keyframe.snapshots[memberId] ?? template,
    'party',
    slot as MemberSnapshot['partySlot'],
  );
  if (!keyframe.snapshots[memberId] && displacedSnapshot) replacementSnapshot.level = displacedSnapshot.level;
  const snapshots: Record<string, MemberSnapshot> = { ...keyframe.snapshots, [memberId]: replacementSnapshot };
  if (displacedId !== null && displacedId !== memberId && displacedSnapshot) {
    snapshots[displacedId] = cloneSnapshot(displacedSnapshot, 'reserve', null);
    reserve.push(displacedId);
  }
  return { ...keyframe, party, reserve, released, snapshots };
}

function withFrame(timeline: TimelineState, nodeId: string, keyframe: TimelineKeyframe): TimelineState {
  return timeline.overrides[nodeId]
    ? { ...timeline, overrides: { ...timeline.overrides, [nodeId]: keyframe } }
    : { ...timeline, keyframes: { ...timeline.keyframes, [nodeId]: keyframe } };
}

/** Apply a previously previewed edit, rejecting confirmations whose state or parameters became stale. */
export function applyPropagation(
  timeline: TimelineState,
  edit: TimelineEdit,
  scope: PropagationScope,
  milestoneOrder: readonly string[],
  preview: Pick<PropagationPreview, 'stateVersion' | 'token'>,
): TimelineState {
  const current = previewPropagation(timeline, edit, scope, milestoneOrder);
  if (current.stateVersion !== preview.stateVersion || current.token !== preview.token) {
    throw new Error('Propagation preview is stale; create a new preview before applying');
  }
  if (edit.kind === 'snapshot-field') {
    return current.targetNodeIds.reduce((next, nodeId) => {
      const keyframe = next.overrides[nodeId] ?? next.keyframes[nodeId];
      const snapshot = keyframe.snapshots[edit.memberId];
      return withFrame(next, nodeId, {
        ...keyframe,
        snapshots: { ...keyframe.snapshots, [edit.memberId]: { ...snapshot, [edit.field]: edit.value } },
      });
    }, timeline);
  }
  const template = findSnapshot(timeline, edit.memberId);
  if (!template) throw new Error(`Timeline member "${edit.memberId}" has no snapshot to place`);
  return current.targetNodeIds.reduce((next, nodeId) => {
    const keyframe = next.overrides[nodeId] ?? next.keyframes[nodeId];
    return withFrame(next, nodeId, replaceAtFrame(keyframe, edit.memberId, edit.slot, template));
  }, timeline);
}
