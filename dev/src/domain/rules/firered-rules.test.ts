import { describe, expect, it } from 'vitest';
import progressionAsset from '../../../data/firered/progression.json';
import type { RouteProgression } from '../progression';
import { FIRE_RED_RULES } from './firered-rules';

const levelProgression = progressionAsset as RouteProgression;

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

  it('keeps Misty and Surge targets through their canonical preparation routes', () => {
    expect(FIRE_RED_RULES.targetLevelAtNode('kanto-route-24', levelProgression)).toBe(21);
    expect(FIRE_RED_RULES.targetLevelAtNode('kanto-route-25', levelProgression)).toBe(21);
    expect(FIRE_RED_RULES.targetLevelAtNode('ss-anne', levelProgression)).toBe(24);
    expect(FIRE_RED_RULES.targetLevelAtNode('pewter-city', levelProgression)).toBe(14);
    expect(FIRE_RED_RULES.targetLevelAtNode('cerulean-city', levelProgression)).toBe(21);
  });

  it('places prerequisite-gated Giovanni after Blaine instead of at Viridian first arrival', () => {
    expect(FIRE_RED_RULES.targetLevelAtNode('viridian-city', levelProgression)).toBe(14);
    expect(FIRE_RED_RULES.targetLevelAtNode('kanto-power-plant', levelProgression)).toBe(50);
    expect(FIRE_RED_RULES.targetLevelAtNode('kanto-victory-road', levelProgression)).toBe(50);
    expect(FIRE_RED_RULES.targetLevelAtNode('indigo-plateau', levelProgression)).toBe(63);
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

  it('maps canonical acquisitions to their earliest progression nodes', () => {
    expect(FIRE_RED_RULES.acquisitionNodeId('starter-charmander')).toBe('pallet-town');
    expect(FIRE_RED_RULES.acquisitionNodeId('trade-mr-mime')).toBe('kanto-route-2');
    expect(FIRE_RED_RULES.acquisitionNodeId('unknown-acquisition')).toBeNull();
  });

  it('uses FireRed badge identities for traded obedience limits', () => {
    const context = {
      currentNodeId: 'pallet-town', targetMilestoneId: 'brock-gym',
      completedMilestoneIds: new Set<string>(), badgeIds: new Set<string>(), badgeCount: 0, branchChoices: {},
    };

    expect(FIRE_RED_RULES.tradedObedienceLimit(context)).toBe(10);
    expect(FIRE_RED_RULES.tradedObedienceLimit({ ...context, badgeIds: new Set(['cascade-badge']) })).toBe(30);
    expect(FIRE_RED_RULES.tradedObedienceLimit({ ...context, badgeIds: new Set(['rainbow-badge']) })).toBe(50);
    expect(FIRE_RED_RULES.tradedObedienceLimit({ ...context, badgeIds: new Set(['marsh-badge']) })).toBe(70);
    expect(FIRE_RED_RULES.tradedObedienceLimit({ ...context, badgeIds: new Set(['earth-badge']) })).toBeNull();
  });
});

describe('FIRE_RED_RULES stat values', () => {
  const NONE = { individual: 0, effort: 0 };
  const attack = (level: number, hidden = NONE, natureMultiplier = 1): number =>
    FIRE_RED_RULES.statValue({ stat: 'attack', base: 80, level, hidden, natureMultiplier });
  const hp = (level: number, hidden = NONE, natureMultiplier = 1): number =>
    FIRE_RED_RULES.statValue({ stat: 'hp', base: 40, level, hidden, natureMultiplier });

  it('runs one formula for every stat, HP included', () => {
    expect(attack(50)).toBe(85);
    expect(hp(50)).toBe(100); // the level counts twice over for HP, not the flat five
    expect(attack(100)).toBe(165);
    expect(hp(100)).toBe(190);
  });

  it('lets a nature move any stat but HP', () => {
    expect(attack(50, NONE, 0.9)).toBe(76);
    expect(attack(50, NONE, 1.1)).toBe(93);
    expect(hp(50, NONE, 0.9)).toBe(hp(50));
    expect(hp(50, NONE, 1.1)).toBe(hp(50));
  });

  it('reads both hidden values, quarter-weighting effort', () => {
    expect(attack(50, { individual: 31, effort: 0 })).toBe(100);
    expect(attack(50, { individual: 0, effort: 252 })).toBe(116);
    expect(attack(50, { individual: 31, effort: 252 })).toBe(132);
  });

  it('states the hidden bounds a plan never chooses', () => {
    expect(FIRE_RED_RULES.hiddenStatBounds).toEqual({
      lowest: { individual: 0, effort: 0 },
      highest: { individual: 31, effort: 252 },
    });
  });

  it('states one multiplier per nature column, weakest first', () => {
    expect(FIRE_RED_RULES.natureStatModifiers).toEqual([
      { effect: 'hindering', multiplier: 0.9 },
      { effect: 'neutral', multiplier: 1 },
      { effect: 'beneficial', multiplier: 1.1 },
    ]);
    // The columns and the natures state one delta between them, never two.
    const delta = FIRE_RED_RULES.natures.find((nature) => nature.increasedStat !== null)!.multiplier;
    expect(FIRE_RED_RULES.natureStatModifiers.map((modifier) => modifier.multiplier))
      .toEqual([1 - delta, 1, 1 + delta]);
  });
});
