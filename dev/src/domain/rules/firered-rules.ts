import type { ProgressionEvent, ProgressionNode, RouteProgression } from '../progression';
import type {
  CapabilityRule,
  GameRules,
  NatureRule,
  NatureStatModifier,
  PlanningMilestone,
  ProgressionContext,
  StatKey,
  StatValueInput,
} from './game-rules';

/** Ordered FireRed availability milestones retained for compatibility with the legacy API. */
export const FIRE_RED_MILESTONE_ORDER = [
  'brock-gym', 'misty-gym', 'surge-gym', 'erika-gym', 'koga-gym', 'sabrina-gym', 'blaine-gym', 'giovanni-gym', 'champion',
] as const;

const MILESTONES: readonly PlanningMilestone[] = [
  { id: 'starter', nodeId: 'starter', name: 'Starter', targetLevel: 5, badgeId: null },
  { id: 'brock-gym', nodeId: 'pewter-city', name: 'Brock', targetLevel: 14, badgeId: 'boulder-badge' },
  { id: 'misty-gym', nodeId: 'cerulean-city', name: 'Misty', targetLevel: 21, badgeId: 'cascade-badge' },
  { id: 'surge-gym', nodeId: 'vermilion-city', name: 'Lt. Surge', targetLevel: 24, badgeId: 'thunder-badge' },
  { id: 'erika-gym', nodeId: 'celadon-city', name: 'Erika', targetLevel: 29, badgeId: 'rainbow-badge' },
  { id: 'koga-gym', nodeId: 'fuchsia-city', name: 'Koga', targetLevel: 43, badgeId: 'soul-badge' },
  { id: 'sabrina-gym', nodeId: 'saffron-city', name: 'Sabrina', targetLevel: 43, badgeId: 'marsh-badge' },
  { id: 'blaine-gym', nodeId: 'cinnabar-island', name: 'Blaine', targetLevel: 47, badgeId: 'volcano-badge' },
  { id: 'giovanni-gym', nodeId: 'viridian-city', name: 'Giovanni', targetLevel: 50, badgeId: 'earth-badge' },
  { id: 'champion', nodeId: 'indigo-plateau', name: 'Champion', targetLevel: 63, badgeId: null },
];

/** The share of one stat a non-neutral nature moves, stated once for the natures and the columns. */
const NATURE_DELTA = 0.1;

const NATURES: readonly NatureRule[] = [
  { id: 'hardy', increasedStat: null, decreasedStat: null, multiplier: 0 },
  { id: 'lonely', increasedStat: 'attack', decreasedStat: 'defense', multiplier: NATURE_DELTA },
  { id: 'brave', increasedStat: 'attack', decreasedStat: 'speed', multiplier: NATURE_DELTA },
  { id: 'adamant', increasedStat: 'attack', decreasedStat: 'specialAttack', multiplier: NATURE_DELTA },
  { id: 'naughty', increasedStat: 'attack', decreasedStat: 'specialDefense', multiplier: NATURE_DELTA },
  { id: 'bold', increasedStat: 'defense', decreasedStat: 'attack', multiplier: NATURE_DELTA },
  { id: 'docile', increasedStat: null, decreasedStat: null, multiplier: 0 },
  { id: 'relaxed', increasedStat: 'defense', decreasedStat: 'speed', multiplier: NATURE_DELTA },
  { id: 'impish', increasedStat: 'defense', decreasedStat: 'specialAttack', multiplier: NATURE_DELTA },
  { id: 'lax', increasedStat: 'defense', decreasedStat: 'specialDefense', multiplier: NATURE_DELTA },
  { id: 'timid', increasedStat: 'speed', decreasedStat: 'attack', multiplier: NATURE_DELTA },
  { id: 'hasty', increasedStat: 'speed', decreasedStat: 'defense', multiplier: NATURE_DELTA },
  { id: 'serious', increasedStat: null, decreasedStat: null, multiplier: 0 },
  { id: 'jolly', increasedStat: 'speed', decreasedStat: 'specialAttack', multiplier: NATURE_DELTA },
  { id: 'naive', increasedStat: 'speed', decreasedStat: 'specialDefense', multiplier: NATURE_DELTA },
  { id: 'modest', increasedStat: 'specialAttack', decreasedStat: 'attack', multiplier: NATURE_DELTA },
  { id: 'mild', increasedStat: 'specialAttack', decreasedStat: 'defense', multiplier: NATURE_DELTA },
  { id: 'quiet', increasedStat: 'specialAttack', decreasedStat: 'speed', multiplier: NATURE_DELTA },
  { id: 'bashful', increasedStat: null, decreasedStat: null, multiplier: 0 },
  { id: 'rash', increasedStat: 'specialAttack', decreasedStat: 'specialDefense', multiplier: NATURE_DELTA },
  { id: 'calm', increasedStat: 'specialDefense', decreasedStat: 'attack', multiplier: NATURE_DELTA },
  { id: 'gentle', increasedStat: 'specialDefense', decreasedStat: 'defense', multiplier: NATURE_DELTA },
  { id: 'sassy', increasedStat: 'specialDefense', decreasedStat: 'speed', multiplier: NATURE_DELTA },
  { id: 'careful', increasedStat: 'specialDefense', decreasedStat: 'specialAttack', multiplier: NATURE_DELTA },
  { id: 'quirky', increasedStat: null, decreasedStat: null, multiplier: 0 },
];

/**
 * Generation III grades every non-neutral nature by the same delta and mirrors the decrease onto
 * the increase, so one number states all three columns. A version that graded them unevenly would
 * list its own multipliers here instead of deriving them from a single delta.
 */
const NATURE_STAT_MODIFIERS: readonly NatureStatModifier[] = [
  { effect: 'hindering', multiplier: 1 - NATURE_DELTA },
  { effect: 'neutral', multiplier: 1 },
  { effect: 'beneficial', multiplier: 1 + NATURE_DELTA },
];

/** The hidden per-member values Generation III admits: 0-31 individual and 0-252 effort per stat. */
const HIDDEN_STAT_BOUNDS = {
  lowest: { individual: 0, effort: 0 },
  highest: { individual: 31, effort: 252 },
};

/**
 * Generation III finishes all six stats with one formula: a core term every stat shares, a flat
 * addend, and a nature multiplier. HP is not a special case — it carries a level-sized addend and
 * takes no nature, and both of those are terms of the same formula rather than a branch in it.
 */
const STAT_TERMS: Record<StatKey, { flat: (level: number) => number; nature: boolean }> = {
  hp: { flat: (level) => level + 10, nature: false },
  attack: { flat: () => 5, nature: true },
  defense: { flat: () => 5, nature: true },
  specialAttack: { flat: () => 5, nature: true },
  specialDefense: { flat: () => 5, nature: true },
  speed: { flat: () => 5, nature: true },
};

function statValue({ stat, base, level, hidden, natureMultiplier }: StatValueInput): number {
  const term = STAT_TERMS[stat];
  const core = Math.floor(((2 * base + hidden.individual + Math.floor(hidden.effort / 4)) * level) / 100);
  return Math.floor((core + term.flat(level)) * (term.nature ? natureMultiplier : 1));
}

const CAPABILITIES: readonly CapabilityRule[] = [
  { id: 'cut', kind: 'field-move', moveId: 15, requiredBadgeId: 'cascade-badge', availableAtMilestoneId: 'misty-gym' },
  { id: 'fly', kind: 'field-move', moveId: 19, requiredBadgeId: 'thunder-badge', availableAtMilestoneId: 'surge-gym' },
  { id: 'surf', kind: 'field-move', moveId: 57, requiredBadgeId: 'soul-badge', availableAtMilestoneId: 'koga-gym' },
  { id: 'strength', kind: 'field-move', moveId: 70, requiredBadgeId: 'rainbow-badge', availableAtMilestoneId: 'erika-gym' },
  { id: 'waterfall', kind: 'field-move', moveId: 127, requiredBadgeId: 'volcano-badge', availableAtMilestoneId: 'champion' },
  { id: 'flash', kind: 'field-move', moveId: 148, requiredBadgeId: 'boulder-badge', availableAtMilestoneId: 'brock-gym' },
  { id: 'rock-smash', kind: 'field-move', moveId: 249, requiredBadgeId: 'marsh-badge', availableAtMilestoneId: 'sabrina-gym' },
];

const MILESTONE_BY_ID = new Map(MILESTONES.map((milestone) => [milestone.id, milestone]));

/** Pack acquisitions whose location is documented but not linked to a progression event. */
const ACQUISITION_NODE_IDS: Readonly<Record<string, string>> = {
  'starter-bulbasaur': 'pallet-town',
  'starter-charmander': 'pallet-town',
  'starter-squirtle': 'pallet-town',
  'trade-farfetchd': 'vermilion-city',
  'trade-jynx': 'cerulean-city',
  'trade-lickitung': 'kanto-route-18',
  'trade-mr-mime': 'kanto-route-2',
  'trade-seel': 'cinnabar-island',
  'trade-tangela': 'cinnabar-island',
};

function tradedObedienceLimit(context: ProgressionContext): number | null {
  if (context.badgeIds.has('earth-badge')) return null;
  if (context.badgeIds.has('marsh-badge')) return 70;
  if (context.badgeIds.has('rainbow-badge')) return 50;
  if (context.badgeIds.has('cascade-badge')) return 30;
  return 10;
}

interface MilestoneBoundary {
  milestone: PlanningMilestone;
  event: ProgressionEvent;
  phaseStart: number;
  phaseEnd: number;
}

/**
 * Gym events live on their city node even when preparation continues later in the same phase.
 * A gated revisit such as Giovanni is anchored after its prerequisite and before the next
 * intended milestone instead of at the city's first golden-path visit.
 */
function progressionMilestoneBoundaries(progression: RouteProgression): Array<MilestoneBoundary & { order: number }> {
  const phaseRange = new Map<string, { start: number; end: number }>();
  const eventOwner = new Map<string, ProgressionNode>();
  for (const node of progression.nodes) {
    const range = phaseRange.get(node.phase);
    phaseRange.set(node.phase, {
      start: Math.min(range?.start ?? node.goldenPathOrder, node.goldenPathOrder),
      end: Math.max(range?.end ?? node.goldenPathOrder, node.goldenPathOrder),
    });
    node.events.forEach((event) => { eventOwner.set(event.id, node); });
  }

  const positioned = MILESTONES.flatMap((milestone): MilestoneBoundary[] => {
    const owner = eventOwner.get(milestone.id);
    const event = owner?.events.find((candidate) => candidate.id === milestone.id);
    const range = owner && phaseRange.get(owner.phase);
    return owner && event && range
      ? [{ milestone, event, phaseStart: range.start, phaseEnd: range.end }]
      : [];
  });
  const boundaryByMilestoneId = new Map<string, number>();
  const lastProgressionOrder = Math.max(...progression.nodes.map((node) => node.goldenPathOrder));

  return positioned.map((entry, index) => {
    const prerequisiteOrder = Math.max(-1, ...entry.event.conditions
      .filter((condition) => condition.kind === 'milestone-complete' && typeof condition.value === 'string')
      .map((condition) => boundaryByMilestoneId.get(String(condition.value)) ?? -1));
    let order = entry.phaseEnd;
    if (order <= prerequisiteOrder) {
      const nextPhaseStart = Math.min(
        ...positioned.slice(index + 1).map((candidate) => candidate.phaseStart).filter((start) => start > prerequisiteOrder),
        lastProgressionOrder + 1,
      );
      order = Math.max(prerequisiteOrder + 1, nextPhaseStart - 1);
    }
    boundaryByMilestoneId.set(entry.milestone.id, order);
    return { ...entry, order };
  });
}

function targetLevelAtNode(nodeId: string, progression: RouteProgression): number {
  const directMilestone = MILESTONE_BY_ID.get(nodeId);
  if (directMilestone) return directMilestone.targetLevel;
  const targetNode = progression.nodes.find((node) => node.id === nodeId);
  if (!targetNode) return 0;
  const positionedMilestones = progressionMilestoneBoundaries(progression);
  return positionedMilestones.find((entry) => entry.order >= targetNode.goldenPathOrder)?.milestone.targetLevel
    ?? positionedMilestones.at(-1)?.milestone.targetLevel
    ?? 0;
}

export const FIRE_RED_RULES: GameRules = {
  gameId: 'firered',
  initialProgress: () => ({ currentNodeId: 'starter', targetMilestoneId: 'brock-gym' }),
  milestones: MILESTONES,
  natures: NATURES,
  hiddenStatBounds: HIDDEN_STAT_BOUNDS,
  natureStatModifiers: NATURE_STAT_MODIFIERS,
  statValue,
  capabilities: new Map(CAPABILITIES.map((capability) => [capability.id, capability])),
  targetLevel: (milestoneId) => MILESTONE_BY_ID.get(milestoneId)?.targetLevel ?? 0,
  targetLevelAtNode,
  canTrade: (context) => context.completedMilestoneIds.has('viridian-oaks-parcel'),
  acquisitionNodeId: (acquisitionId) => ACQUISITION_NODE_IDS[acquisitionId] ?? null,
  tradedObedienceLimit,
};
