import type { RouteProgression } from '../progression';

export type StatKey = 'hp' | 'attack' | 'defense' | 'specialAttack' | 'specialDefense' | 'speed';
export type LevelMode = 'manual' | 'under' | 'match' | 'over';

/** The normalized progression state supplied to version-specific planning rules. */
export interface ProgressionContext {
  currentNodeId: string;
  targetMilestoneId: string;
  completedMilestoneIds: ReadonlySet<string>;
  badgeIds: ReadonlySet<string>;
  badgeCount: number;
  branchChoices: Readonly<Record<string, string>>;
}

/** A selectable planning checkpoint backed by a progression node or event. */
export interface PlanningMilestone {
  id: string;
  nodeId: string;
  name: string;
  targetLevel: number;
  badgeId: string | null;
}

/**
 * The per-member values behind a stat that a plan never chooses — individual and effort values in
 * the Generation III vocabulary. Surfaces span their range rather than state a false exact stat.
 */
export interface HiddenStatValues {
  individual: number;
  effort: number;
}

/** How far a nature can move one stat. A ruleset without natures states `neutral` alone. */
export type NatureEffect = 'hindering' | 'neutral' | 'beneficial';

export interface NatureStatModifier {
  effect: NatureEffect;
  multiplier: number;
}

export interface StatValueInput {
  stat: StatKey;
  /** The species' base value for that stat. */
  base: number;
  level: number;
  hidden: HiddenStatValues;
  /** One of `natureStatModifiers`' multipliers; a stat no nature moves ignores it. */
  natureMultiplier: number;
}

/** A Generation III nature's stat delta, expressed as a signed ten-percent modifier. */
export interface NatureRule {
  id: string;
  increasedStat: StatKey | null;
  decreasedStat: StatKey | null;
  multiplier: number;
}

/** A field capability that can be searched independently from a member's current moves. */
export interface CapabilityRule {
  id: string;
  kind: 'field-move';
  moveId: number;
  requiredBadgeId: string | null;
  availableAtMilestoneId: string | null;
}

/** Optional canonical counts for resources that a plan can assign more than once. */
export interface FiniteResourceInventory {
  heldItems: ReadonlyMap<number, number>;
  moves: ReadonlyMap<number, number>;
}

/** The selected active-party level policy at one planning checkpoint. */
export interface LevelPolicy {
  mode: LevelMode;
  targetLevel: number;
  autoEvolveLevel: boolean;
}

/** Narrow, pure adapter boundary between generic timeline logic and one game version. */
export interface GameRules {
  gameId: string;
  initialProgress(): { currentNodeId: string; targetMilestoneId: string };
  milestones: readonly PlanningMilestone[];
  natures: readonly NatureRule[];
  /** The extremes of the hidden values, so a surface states a range instead of a false exact stat. */
  hiddenStatBounds: { lowest: HiddenStatValues; highest: HiddenStatValues };
  /** Every distinct multiplier a nature applies to one stat, weakest first (spec §16). */
  natureStatModifiers: readonly NatureStatModifier[];
  /**
   * One stat's value under this version's formula. All six stats run this one call; a stat that
   * behaves unlike the others (HP under Generation III) differs by its terms, not by its caller.
   */
  statValue(input: StatValueInput): number;
  capabilities: ReadonlyMap<string, CapabilityRule>;
  targetLevel(milestoneId: string): number;
  targetLevelAtNode(nodeId: string, progression: RouteProgression): number;
  canTrade(context: ProgressionContext): boolean;
  /** Undefined means this ruleset cannot yet verify finite-resource assignments. */
  finiteResourceInventory?(context: ProgressionContext): FiniteResourceInventory | undefined;
  /** Earliest ordinary node for version-specific acquisitions absent from generic pack links. */
  acquisitionNodeId(acquisitionId: string): string | null;
  /** Highest level at which a traded member obeys, or null when all traded levels obey. */
  tradedObedienceLimit(context: ProgressionContext): number | null;
}
