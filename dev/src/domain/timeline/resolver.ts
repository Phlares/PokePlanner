import type { EvolutionEdge } from '../pack';
import type { RouteProgression } from '../progression';
import type { GameRules, LevelPolicy } from '../rules/game-rules';
import type {
  MemberPlacement,
  MemberSnapshot,
  TimelineKeyframe,
  TimelinePackView,
  TimelineState,
} from './model';

/** The resolver asks only for outgoing evolution edges, not the complete canonical game pack. */
export interface TimelineResolverPackView extends TimelinePackView {
  evolutionEdgesFrom(speciesId: number): readonly EvolutionEdge[];
}

export interface ResolveTimelineInput {
  timeline: TimelineState;
  nodeId: string;
  progression: RouteProgression;
  rules: GameRules;
  pack: TimelineResolverPackView;
}

export interface ResolvedTimelineNode {
  nodeId: string;
  source: 'explicit-major' | 'explicit-override' | 'auto-filled';
  party: TimelineKeyframe['party'];
  reserve: readonly string[];
  released: readonly string[];
  snapshots: Readonly<Record<string, MemberSnapshot>>;
}

interface OrderedFrame {
  frame: TimelineKeyframe;
  order: number;
}

interface Placement {
  kind: MemberPlacement;
  partySlot: MemberSnapshot['partySlot'];
}

type MutableParty = {
  -readonly [Index in keyof TimelineKeyframe['party']]: TimelineKeyframe['party'][Index];
};

const EMPTY_PARTY: TimelineKeyframe['party'] = [null, null, null, null, null, null];

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Resolve a manual endpoint interpolation or one active-party level policy. */
export function interpolateLevel(
  fromLevel: number,
  toLevel: number,
  progress: number,
  policy: LevelPolicy,
): number {
  const normalizedProgress = clamp(progress, 0, 1);
  const generated = policy.mode === 'manual'
    ? fromLevel + ((toLevel - fromLevel) * normalizedProgress)
    : policy.targetLevel + (policy.mode === 'under' ? -5 : policy.mode === 'over' ? 5 : 0);
  return clamp(Math.round(generated), 1, 100);
}

/** Return the one deterministic, currently reachable level evolution, or no automatic edge. */
export function eligibleLevelEvolution(
  speciesId: number,
  level: number,
  pack: TimelineResolverPackView,
): EvolutionEdge | null {
  const eligible = pack.evolutionEdgesFrom(speciesId).filter((edge) => (
    edge.fromPokemonId === speciesId
    && edge.trigger === 'level'
    && edge.minimumLevel !== null
    && edge.minimumLevel <= level
    && edge.itemId === null
    && edge.locationId === null
    && edge.milestoneId === null
    && edge.reason === null
    && edge.status === 'standard'
  ));
  return eligible.length === 1 ? eligible[0] : null;
}

function orderedNodeIds(progression: RouteProgression): Map<string, number> {
  const ordered = progression.nodes
    .map((node, inputOrder) => ({ node, inputOrder }))
    .sort((left, right) => (
      left.node.goldenPathOrder - right.node.goldenPathOrder
      || left.inputOrder - right.inputOrder
      || left.node.id.localeCompare(right.node.id)
    ));
  return new Map(ordered.map(({ node }, order) => [node.id, order]));
}

function progressionNodeId(
  nodeId: string,
  orders: ReadonlyMap<string, number>,
  rules: GameRules,
): string | null {
  if (orders.has(nodeId)) return nodeId;
  const milestone = rules.milestones.find((candidate) => candidate.id === nodeId);
  return milestone && orders.has(milestone.nodeId) ? milestone.nodeId : null;
}

function nodeOrder(
  nodeId: string,
  orders: ReadonlyMap<string, number>,
  rules: GameRules,
): number | null {
  const resolvedNodeId = progressionNodeId(nodeId, orders, rules);
  return resolvedNodeId === null ? null : orders.get(resolvedNodeId) ?? null;
}

function exactMajorAt(
  timeline: TimelineState,
  nodeId: string,
  orders: ReadonlyMap<string, number>,
  rules: GameRules,
): TimelineKeyframe | undefined {
  const direct = timeline.keyframes[nodeId];
  if (direct) return direct;
  const targetProgressionNodeId = progressionNodeId(nodeId, orders, rules);
  if (targetProgressionNodeId === null) return undefined;
  for (const milestone of rules.milestones) {
    if (milestone.nodeId === targetProgressionNodeId && timeline.keyframes[milestone.id]) {
      return timeline.keyframes[milestone.id];
    }
  }
  return undefined;
}

function cloneSnapshot(
  snapshot: MemberSnapshot,
  placement: MemberPlacement,
  partySlot: MemberSnapshot['partySlot'],
): MemberSnapshot {
  return {
    ...snapshot,
    moves: snapshot.moves.map((move) => ({ ...move })),
    placement,
    partySlot,
    review: { ...snapshot.review },
  };
}

function isAcquired(
  timeline: TimelineState,
  memberId: string,
  targetOrder: number,
  orders: ReadonlyMap<string, number>,
  rules: GameRules,
): boolean {
  const member = timeline.members[memberId];
  if (!member) throw new Error(`Unknown timeline member id "${memberId}" during resolution`);
  const acquisitionOrder = nodeOrder(member.acquiredAtNodeId, orders, rules);
  if (acquisitionOrder === null) {
    throw new Error(`Cannot order acquisition node "${member.acquiredAtNodeId}" for member "${memberId}"`);
  }
  return targetOrder >= acquisitionOrder;
}

function explicitResult(
  timeline: TimelineState,
  frame: TimelineKeyframe,
  requestedNodeId: string,
  source: ResolvedTimelineNode['source'],
  targetOrder: number,
  orders: ReadonlyMap<string, number>,
  rules: GameRules,
): ResolvedTimelineNode {
  const party = frame.party.map((memberId) => (
    memberId !== null && isAcquired(timeline, memberId, targetOrder, orders, rules) ? memberId : null
  )) as unknown as TimelineKeyframe['party'];
  const partyMembers = new Set(party.filter((memberId): memberId is string => memberId !== null));
  const reserve = frame.reserve.filter((memberId) => (
    !partyMembers.has(memberId) && isAcquired(timeline, memberId, targetOrder, orders, rules)
  ));
  const placed = new Set([...partyMembers, ...reserve]);
  const released = frame.released.filter((memberId) => (
    !placed.has(memberId) && isAcquired(timeline, memberId, targetOrder, orders, rules)
  ));
  const snapshots: Record<string, MemberSnapshot> = {};
  party.forEach((memberId, slot) => {
    if (memberId !== null) snapshots[memberId] = cloneSnapshot(frame.snapshots[memberId], 'party', slot as MemberSnapshot['partySlot']);
  });
  reserve.forEach((memberId) => { snapshots[memberId] = cloneSnapshot(frame.snapshots[memberId], 'reserve', null); });
  released.forEach((memberId) => { snapshots[memberId] = cloneSnapshot(frame.snapshots[memberId], 'released', null); });
  return { nodeId: requestedNodeId, source, party, reserve, released, snapshots };
}

function surroundingFrames(
  timeline: TimelineState,
  targetOrder: number,
  orders: ReadonlyMap<string, number>,
  rules: GameRules,
): { previous: OrderedFrame | null; next: OrderedFrame | null } {
  const frames = Object.values(timeline.keyframes)
    .map((frame): OrderedFrame | null => {
      const order = nodeOrder(frame.nodeId, orders, rules);
      return order === null ? null : { frame, order };
    })
    .filter((entry): entry is OrderedFrame => entry !== null)
    .sort((left, right) => left.order - right.order || left.frame.nodeId.localeCompare(right.frame.nodeId));
  let previous: OrderedFrame | null = null;
  let next: OrderedFrame | null = null;
  for (const frame of frames) {
    if (frame.order < targetOrder) previous = frame;
    if (frame.order > targetOrder) {
      next = frame;
      break;
    }
  }
  return { previous, next };
}

function placeMember(
  placements: Map<string, Placement>,
  memberId: string,
  kind: MemberPlacement,
  partySlot: MemberSnapshot['partySlot'],
): void {
  if (!placements.has(memberId)) placements.set(memberId, { kind, partySlot });
}

function derivedPlacements(
  timeline: TimelineState,
  previous: TimelineKeyframe | null,
  template: TimelineKeyframe,
  targetOrder: number,
  orders: ReadonlyMap<string, number>,
  rules: GameRules,
): { party: TimelineKeyframe['party']; reserve: string[]; released: string[]; placements: Map<string, Placement> } {
  const party = [...EMPTY_PARTY] as MutableParty;
  const placements = new Map<string, Placement>();

  template.party.forEach((memberId, slot) => {
    const candidate = memberId !== null && isAcquired(timeline, memberId, targetOrder, orders, rules) ? memberId : null;
    const fallback = previous?.party[slot] ?? null;
    const selected = candidate ?? (
      fallback !== null && isAcquired(timeline, fallback, targetOrder, orders, rules) ? fallback : null
    );
    if (selected !== null && !placements.has(selected)) {
      party[slot] = selected;
      placements.set(selected, { kind: 'party', partySlot: slot as MemberSnapshot['partySlot'] });
    }
  });

  const addCollection = (memberIds: readonly string[], kind: 'reserve' | 'released') => {
    memberIds.forEach((memberId) => {
      if (isAcquired(timeline, memberId, targetOrder, orders, rules)) placeMember(placements, memberId, kind, null);
    });
  };
  addCollection(template.reserve, 'reserve');
  addCollection(template.released, 'released');

  if (previous) {
    previous.party.forEach((memberId, slot) => {
      if (memberId === null || !isAcquired(timeline, memberId, targetOrder, orders, rules) || placements.has(memberId)) return;
      if (party[slot] === null) {
        party[slot] = memberId;
        placements.set(memberId, { kind: 'party', partySlot: slot as MemberSnapshot['partySlot'] });
      } else {
        placements.set(memberId, { kind: 'reserve', partySlot: null });
      }
    });
    addCollection(previous.reserve, 'reserve');
    addCollection(previous.released, 'released');
  }

  return {
    party,
    reserve: [...placements].filter(([, placement]) => placement.kind === 'reserve').map(([memberId]) => memberId),
    released: [...placements].filter(([, placement]) => placement.kind === 'released').map(([memberId]) => memberId),
    placements,
  };
}

function evolvedSpecies(speciesId: number, level: number, pack: TimelineResolverPackView): number {
  let current = speciesId;
  const visited = new Set<number>();
  while (!visited.has(current)) {
    visited.add(current);
    const evolution = eligibleLevelEvolution(current, level, pack);
    if (!evolution) break;
    current = evolution.toPokemonId;
  }
  return current;
}

/** Purely resolve one explicit or auto-filled timeline node without persisting derived state. */
export function resolveTimelineNode(input: ResolveTimelineInput): ResolvedTimelineNode {
  const { timeline, nodeId, progression, rules, pack } = input;
  const orders = orderedNodeIds(progression);
  const targetOrder = nodeOrder(nodeId, orders, rules);
  if (targetOrder === null) throw new Error(`Unknown progression node id "${nodeId}"`);

  const exactOverride = timeline.overrides[nodeId];
  if (exactOverride) {
    return explicitResult(timeline, exactOverride, nodeId, 'explicit-override', targetOrder, orders, rules);
  }
  const exactMajor = exactMajorAt(timeline, nodeId, orders, rules);
  if (exactMajor) {
    return explicitResult(timeline, exactMajor, nodeId, 'explicit-major', targetOrder, orders, rules);
  }

  const { previous, next } = surroundingFrames(timeline, targetOrder, orders, rules);
  const template = next?.frame ?? previous?.frame;
  if (!template) {
    return { nodeId, source: 'auto-filled', party: [...EMPTY_PARTY], reserve: [], released: [], snapshots: {} };
  }

  const resolvedPlacement = derivedPlacements(
    timeline,
    previous?.frame ?? null,
    template,
    targetOrder,
    orders,
    rules,
  );
  const progress = previous && next && next.order !== previous.order
    ? (targetOrder - previous.order) / (next.order - previous.order)
    : 0;
  const policy: LevelPolicy = {
    mode: timeline.preferences.levelMode,
    targetLevel: rules.targetLevelAtNode(nodeId, progression),
    autoEvolveLevel: timeline.preferences.autoEvolveLevel,
  };
  const snapshots: Record<string, MemberSnapshot> = {};
  for (const [memberId, placement] of resolvedPlacement.placements) {
    const previousSnapshot = previous?.frame.snapshots[memberId];
    const nextSnapshot = next?.frame.snapshots[memberId];
    const sourceSnapshot = previousSnapshot ?? template.snapshots[memberId] ?? nextSnapshot;
    if (!sourceSnapshot) throw new Error(`Timeline member "${memberId}" has no surrounding snapshot at node "${nodeId}"`);
    const snapshot = cloneSnapshot(sourceSnapshot, placement.kind, placement.partySlot);
    if (placement.kind === 'party') {
      snapshot.level = interpolateLevel(sourceSnapshot.level, nextSnapshot?.level ?? sourceSnapshot.level, progress, policy);
      if (timeline.preferences.autoEvolveLevel) snapshot.speciesId = evolvedSpecies(snapshot.speciesId, snapshot.level, pack);
    }
    snapshots[memberId] = snapshot;
  }

  return {
    nodeId,
    source: 'auto-filled',
    party: resolvedPlacement.party,
    reserve: resolvedPlacement.reserve,
    released: resolvedPlacement.released,
    snapshots,
  };
}
