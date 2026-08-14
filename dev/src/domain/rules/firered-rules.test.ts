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
    expect(FIRE_RED_RULES.natures.find((nature) => nature.id === 'adamant')).toMatchObject({
      increasedStat: 'attack', decreasedStat: 'specialAttack', multiplier: 0.1,
    });
  });

  it('exposes Surf as a milestone-searchable capability', () => {
    expect(FIRE_RED_RULES.capabilities.get('surf')).toMatchObject({ kind: 'field-move', moveId: 57 });
  });

  it('marks Waterfall as a postgame field move requiring the Volcano Badge', () => {
    expect(FIRE_RED_RULES.capabilities.get('waterfall')).toMatchObject({
      kind: 'field-move', moveId: 127, requiredBadgeId: 'volcano-badge', availableAtMilestoneId: 'champion',
    });
  });

  it('uses leader and Champion targets for level planning', () => {
    expect(FIRE_RED_RULES.targetLevel('brock-gym')).toBe(14);
    expect(FIRE_RED_RULES.targetLevel('champion')).toBe(63);
  });

  it('unlocks trading after the parcel delivery', () => {
    const beforeBrock = {
      currentNodeId: 'starter', targetMilestoneId: 'brock-gym',
      completedMilestoneIds: new Set<string>(), badgeIds: new Set<string>(), badgeCount: 0, branchChoices: {},
    };
    const afterPokedex = { ...beforeBrock, completedMilestoneIds: new Set(['viridian-oaks-parcel']) };

    expect(FIRE_RED_RULES.canTrade(beforeBrock)).toBe(false);
    expect(FIRE_RED_RULES.canTrade(afterPokedex)).toBe(true);
  });
});
