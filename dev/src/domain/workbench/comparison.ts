import type { FireRedPack } from '../../data/game-pack';
import {
  capabilitySources,
  packLearnability,
  progressionContextAtNode,
} from './search';
import { evaluateCapability, type CapabilityState } from '../timeline/capabilities';
import type { CapabilityRule, GameRules, StatKey } from '../rules/game-rules';
import type { MemberSnapshot } from '../timeline/model';
import type { ResolvedTimelineNode } from '../timeline/resolver';
import type { TimelineFinding } from '../timeline/validation';

/** The damage classes the pack assigns to a move, in render order. */
export type DamageClass = 'physical' | 'special' | 'status';
export type MoveClassCounts = Record<DamageClass, number>;

/** One side of the comparison: an existing member or a species with no plan behind it. */
export interface ComparisonSubject {
  memberId: string | null;
  snapshot: MemberSnapshot;
  natureId: string | null;
}

/** What the comparison reads, without ever mutating it. */
export interface MemberComparisonContext {
  pack: FireRedPack;
  rules: GameRules;
  node: ResolvedTimelineNode;
  findings: readonly TimelineFinding[];
}

/** One field capability the outgoing member would leave without a party owner. */
export interface CapabilityLoss {
  capabilityId: string;
  severity: 'yellow' | null;
  retainedByParty: boolean;
  candidateState: CapabilityState;
  reserveMemberIds: string[];
}

export interface MemberComparisonView {
  types: { before: string[]; after: string[] };
  abilities: { before: string[]; after: string[] };
  stats: Record<StatKey, { before: number; after: number; delta: number }>;
  moveClasses: { before: MoveClassCounts; after: MoveClassCounts };
  moves: { leaving: number[]; entering: number[] };
  nature: { before: string | null; after: string | null };
  findings: readonly TimelineFinding[];
  capabilityLosses: CapabilityLoss[];
  /** Move id → display name, for every move in either subject's plan. */
  moveNames: Record<number, string>;
  /** Capability id → display name, for every capability reported. */
  capabilityLabels: Record<string, string>;
}

const STAT_KEYS: readonly StatKey[] = ['hp', 'attack', 'defense', 'specialAttack', 'specialDefense', 'speed'];

function speciesAt(pack: FireRedPack, speciesId: number): FireRedPack['pokemon'][number] {
  return pack.pokemon.find((record) => record.id === speciesId) ?? pack.pokemon[0];
}

/** A species' signature ability: the name in slot 1, per the pack's ability list. */
function signatureAbility(pack: FireRedPack, speciesId: number): string {
  const abilities = speciesAt(pack, speciesId).abilities;
  const slotOne = abilities.find((ability) => ability.slot === 1);
  return (slotOne ?? abilities[0]).name;
}

function countMoveClasses(pack: FireRedPack, moves: MemberSnapshot['moves']): MoveClassCounts {
  const classById = new Map(pack.moves.map((record) => [record.id, record.damageClass]));
  const counts: MoveClassCounts = { physical: 0, special: 0, status: 0 };
  for (const move of moves) {
    const damageClass = classById.get(move.moveId);
    if (damageClass !== undefined) counts[damageClass] += 1;
  }
  return counts;
}

/** Move ids present in exactly one subject, ascending. */
function moveIdsDiff(before: readonly number[], after: readonly number[]): { leaving: number[]; entering: number[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const leaving = before.filter((id) => !afterSet.has(id)).sort((a, b) => a - b);
  const entering = after.filter((id) => !beforeSet.has(id)).sort((a, b) => a - b);
  return { leaving, entering };
}


const RESERVE_RETAINS: readonly CapabilityState[] = ['knows', 'can-now', 'conditional'];

/**
 * Every capability the outgoing member supplies that a replacement would leave without an active
 * owner. The party (not the outgoing member, not the candidate) decides `retainedByParty`; the
 * reserve only ever lists the help it could supply, never the retention that silences the warning.
 */
function capabilityLosses(
  member: ComparisonSubject,
  candidate: ComparisonSubject,
  context: MemberComparisonContext,
): CapabilityLoss[] {
  const { pack, rules, node } = context;
  const progression = progressionContextAtNode(node.nodeId, pack, rules);
  const canLearnMove = packLearnability(pack);
  const make = (capability: CapabilityRule) => ({
    capability,
    progressionContext: progression,
    canLearnMove,
    sources: capabilitySources(capability, node.nodeId, pack, rules),
  });
  const snapshotOf = (memberId: string | null) => (memberId === null ? null : node.snapshots[memberId]);

  const losses: CapabilityLoss[] = [];
  for (const capability of rules.capabilities.values()) {
    const evalContext = make(capability);
    if (evaluateCapability(member.snapshot, evalContext).state !== 'knows') continue;

    let retainedByParty = false;
    for (const memberId of node.party) {
      if (memberId === null || memberId === member.memberId || memberId === candidate.memberId) continue;
      const snapshot = snapshotOf(memberId);
      if (snapshot !== null && evaluateCapability(snapshot, evalContext).state === 'knows') {
        retainedByParty = true;
        break;
      }
    }

    const reserveMemberIds: string[] = [];
    for (const memberId of node.reserve) {
      const snapshot = snapshotOf(memberId);
      if (snapshot === null) continue;
      const state = evaluateCapability(snapshot, evalContext).state;
      if (RESERVE_RETAINS.includes(state)) reserveMemberIds.push(memberId);
    }

    losses.push({
      capabilityId: capability.id,
      severity: retainedByParty ? null : 'yellow',
      retainedByParty,
      candidateState: evaluateCapability(candidate.snapshot, evalContext).state,
      reserveMemberIds,
    });
  }
  return losses;
}

/**
 * Compare a party member against a replacement candidate at one resolved node. Pure: it reads the
 * pack, the rules and the node and returns a view; it never touches the timeline, so the workbench
 * can show the comparison before anything is confirmed.
 */
export function compareMemberCandidate(
  member: ComparisonSubject,
  candidate: ComparisonSubject,
  context: MemberComparisonContext,
): MemberComparisonView {
  const { pack, node, findings } = context;
  const beforeSpecies = speciesAt(pack, member.snapshot.speciesId);
  const afterSpecies = speciesAt(pack, candidate.snapshot.speciesId);
  const beforeMoves = member.snapshot.moves.map((move) => move.moveId);
  const afterMoves = candidate.snapshot.moves.map((move) => move.moveId);
  const moves = moveIdsDiff(beforeMoves, afterMoves);
  const capabilityLosses_ = capabilityLosses(member, candidate, context);
  const capabilityLabels: Record<string, string> = {};
  const nameById = new Map(pack.moves.map((record) => [record.id, record.name]));
  for (const loss of capabilityLosses_) {
    const capability = context.rules.capabilities.get(loss.capabilityId);
    if (capability !== undefined) capabilityLabels[loss.capabilityId] = nameById.get(capability.moveId) ?? loss.capabilityId;
  }

  const stats = {} as MemberComparisonView['stats'];
  for (const key of STAT_KEYS) {
    const before = beforeSpecies.baseStats[key];
    const after = afterSpecies.baseStats[key];
    stats[key] = { before, after, delta: after - before };
  }

  const moveIds = new Set([...beforeMoves, ...afterMoves]);
  const moveNames: Record<number, string> = {};
  for (const record of pack.moves) {
    if (moveIds.has(record.id)) moveNames[record.id] = record.name;
  }

  return {
    types: { before: [...beforeSpecies.types], after: [...afterSpecies.types] },
    abilities: { before: [signatureAbility(pack, member.snapshot.speciesId)], after: [signatureAbility(pack, candidate.snapshot.speciesId)] },
    stats,
    moveClasses: { before: countMoveClasses(pack, member.snapshot.moves), after: countMoveClasses(pack, candidate.snapshot.moves) },
    moves,
    nature: { before: member.natureId, after: candidate.natureId },
    findings: findings.filter((finding) => finding.memberId === member.memberId),
    capabilityLosses: capabilityLosses_,
    moveNames,
    capabilityLabels,
  };
}
