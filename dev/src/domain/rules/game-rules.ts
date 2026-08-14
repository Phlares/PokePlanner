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
  capabilities: ReadonlyMap<string, CapabilityRule>;
  targetLevel(milestoneId: string): number;
  canTrade(context: ProgressionContext): boolean;
}
