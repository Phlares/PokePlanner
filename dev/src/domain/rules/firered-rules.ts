import type { CapabilityRule, GameRules, NatureRule, PlanningMilestone } from './game-rules';

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

const NATURES: readonly NatureRule[] = [
  { id: 'hardy', increasedStat: null, decreasedStat: null, multiplier: 0 },
  { id: 'lonely', increasedStat: 'attack', decreasedStat: 'defense', multiplier: 0.1 },
  { id: 'brave', increasedStat: 'attack', decreasedStat: 'speed', multiplier: 0.1 },
  { id: 'adamant', increasedStat: 'attack', decreasedStat: 'specialAttack', multiplier: 0.1 },
  { id: 'naughty', increasedStat: 'attack', decreasedStat: 'specialDefense', multiplier: 0.1 },
  { id: 'bold', increasedStat: 'defense', decreasedStat: 'attack', multiplier: 0.1 },
  { id: 'docile', increasedStat: null, decreasedStat: null, multiplier: 0 },
  { id: 'relaxed', increasedStat: 'defense', decreasedStat: 'speed', multiplier: 0.1 },
  { id: 'impish', increasedStat: 'defense', decreasedStat: 'specialAttack', multiplier: 0.1 },
  { id: 'lax', increasedStat: 'defense', decreasedStat: 'specialDefense', multiplier: 0.1 },
  { id: 'timid', increasedStat: 'speed', decreasedStat: 'attack', multiplier: 0.1 },
  { id: 'hasty', increasedStat: 'speed', decreasedStat: 'defense', multiplier: 0.1 },
  { id: 'serious', increasedStat: null, decreasedStat: null, multiplier: 0 },
  { id: 'jolly', increasedStat: 'speed', decreasedStat: 'specialAttack', multiplier: 0.1 },
  { id: 'naive', increasedStat: 'speed', decreasedStat: 'specialDefense', multiplier: 0.1 },
  { id: 'modest', increasedStat: 'specialAttack', decreasedStat: 'attack', multiplier: 0.1 },
  { id: 'mild', increasedStat: 'specialAttack', decreasedStat: 'defense', multiplier: 0.1 },
  { id: 'quiet', increasedStat: 'specialAttack', decreasedStat: 'speed', multiplier: 0.1 },
  { id: 'bashful', increasedStat: null, decreasedStat: null, multiplier: 0 },
  { id: 'rash', increasedStat: 'specialAttack', decreasedStat: 'specialDefense', multiplier: 0.1 },
  { id: 'calm', increasedStat: 'specialDefense', decreasedStat: 'attack', multiplier: 0.1 },
  { id: 'gentle', increasedStat: 'specialDefense', decreasedStat: 'defense', multiplier: 0.1 },
  { id: 'sassy', increasedStat: 'specialDefense', decreasedStat: 'speed', multiplier: 0.1 },
  { id: 'careful', increasedStat: 'specialDefense', decreasedStat: 'specialAttack', multiplier: 0.1 },
  { id: 'quirky', increasedStat: null, decreasedStat: null, multiplier: 0 },
];

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

export const FIRE_RED_RULES: GameRules = {
  gameId: 'firered',
  initialProgress: () => ({ currentNodeId: 'starter', targetMilestoneId: 'brock-gym' }),
  milestones: MILESTONES,
  natures: NATURES,
  capabilities: new Map(CAPABILITIES.map((capability) => [capability.id, capability])),
  targetLevel: (milestoneId) => MILESTONE_BY_ID.get(milestoneId)?.targetLevel ?? 0,
  canTrade: (context) => context.completedMilestoneIds.has('viridian-oaks-parcel'),
};
