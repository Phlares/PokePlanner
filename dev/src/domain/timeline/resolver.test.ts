import { describe, expect, it } from 'vitest';
import type { EvolutionEdge } from '../pack';
import type { RouteProgression } from '../progression';
import type { GameRules, LevelPolicy } from '../rules/game-rules';
import type { MemberSnapshot, PersistentMember, TimelineKeyframe, TimelineState } from './model';
import {
  eligibleLevelEvolution,
  interpolateLevel,
  resolveTimelineNode,
  type TimelineResolverPackView,
} from './resolver';

const NODE_IDS = ['route-1', 'route-22', 'pewter-city', 'cerulean-city', 'misty-gym'] as const;

const progression: RouteProgression = {
  schemaVersion: 1,
  game: { id: 'firered', name: 'FireRed', versionId: 10, versionGroupId: 7, generationId: 3 },
  sources: [],
  nodes: NODE_IDS.map((id, goldenPathOrder) => ({
    id,
    name: id,
    kind: id.startsWith('route') ? 'route' : 'city',
    phase: 'test',
    goldenPathOrder,
    prerequisiteEventIds: [],
    nextNodeIds: goldenPathOrder + 1 < NODE_IDS.length ? [NODE_IDS[goldenPathOrder + 1]] : [],
    location: { pokeApiLocationId: null, pokeApiLocationAreaIds: [], sourceMapIds: [] },
    versionFlags: {},
    events: [],
    provenance: [],
  })),
};

const rules: GameRules = {
  gameId: 'firered',
  initialProgress: () => ({ currentNodeId: 'route-1', targetMilestoneId: 'pewter-city' }),
  milestones: [
    { id: 'brock-gym', nodeId: 'pewter-city', name: 'Brock', targetLevel: 14, badgeId: 'boulder-badge' },
    { id: 'misty-gym', nodeId: 'misty-gym', name: 'Misty', targetLevel: 20, badgeId: 'cascade-badge' },
  ],
  natures: [],
  capabilities: new Map(),
  targetLevel: (milestoneId) => milestoneId === 'brock-gym' ? 14 : milestoneId === 'misty-gym' ? 20 : 0,
  targetLevelAtNode: (nodeId) => nodeId === 'route-1' || nodeId === 'route-22' || nodeId === 'pewter-city' ? 14 : 20,
  canTrade: () => true,
  acquisitionNodeId: () => null,
  tradedObedienceLimit: () => null,
};

function edge(
  fromPokemonId: number,
  toPokemonId: number,
  trigger: EvolutionEdge['trigger'],
  minimumLevel: number | null,
  overrides: Partial<EvolutionEdge> = {},
): EvolutionEdge {
  return {
    fromPokemonId,
    toPokemonId,
    trigger,
    minimumLevel,
    itemId: null,
    locationId: null,
    status: 'standard',
    milestoneId: null,
    reason: null,
    provenance: [],
    ...overrides,
  };
}

function packWith(evolutions: readonly EvolutionEdge[] = []): TimelineResolverPackView {
  return {
    hasSpecies: () => true,
    legalAbilityIds: () => [1],
    isVersionValidMove: () => true,
    hasNode: (id) => (NODE_IDS as readonly string[]).includes(id),
    hasMilestone: (id) => id === 'brock-gym' || id === 'misty-gym',
    hasAcquisition: () => true,
    evolutionEdgesFrom: (speciesId) => evolutions.filter((candidate) => candidate.fromPokemonId === speciesId),
  };
}

function member(id: string, originalSpeciesId: number, acquiredAtNodeId: string): PersistentMember {
  return {
    id,
    originalSpeciesId,
    speciesSequence: 1,
    nickname: null,
    natureId: null,
    origin: { type: 'inferred', acquisitionId: null, note: null },
    acquiredAtNodeId,
    notes: '',
    lifecycle: [],
  };
}

function snapshot(
  speciesId: number,
  level: number,
  placement: MemberSnapshot['placement'],
  partySlot: MemberSnapshot['partySlot'],
): MemberSnapshot {
  return {
    speciesId,
    level,
    abilityId: 1,
    moves: [],
    heldItemId: null,
    placement,
    partySlot,
    review: { moves: false, heldItem: false },
  };
}

function frame(
  nodeId: string,
  party: TimelineKeyframe['party'],
  reserve: readonly string[],
  snapshots: Readonly<Record<string, MemberSnapshot>>,
  kind: TimelineKeyframe['kind'] = 'major',
): TimelineKeyframe {
  return { nodeId, kind, party, reserve, released: [], snapshots };
}

function timeline(
  members: TimelineState['members'],
  keyframes: TimelineState['keyframes'],
  overrides: TimelineState['overrides'] = {},
  preferences: TimelineState['preferences'] = { levelMode: 'manual', autoEvolveLevel: false },
): TimelineState {
  return { members, keyframes, overrides, preferences };
}

function resolve(
  timelineState: TimelineState,
  nodeId: string,
  pack: TimelineResolverPackView = packWith(),
) {
  return resolveTimelineNode({ timeline: timelineState, nodeId, progression, rules, pack });
}

describe('interpolateLevel', () => {
  const policy = (mode: LevelPolicy['mode'], targetLevel: number): LevelPolicy => ({
    mode,
    targetLevel,
    autoEvolveLevel: false,
  });

  it('interpolates manual levels and applies the Under, Match and Over offsets', () => {
    expect(interpolateLevel(10, 20, 0.5, policy('manual', 50))).toBe(15);
    expect(interpolateLevel(10, 20, 0.5, policy('under', 20))).toBe(15);
    expect(interpolateLevel(10, 20, 0.5, policy('match', 20))).toBe(20);
    expect(interpolateLevel(10, 20, 0.5, policy('over', 20))).toBe(25);
  });
});

describe('eligibleLevelEvolution', () => {
  it('accepts one deterministic level edge and rejects item, trade, location and choice edges', () => {
    const level = edge(4, 5, 'level', 16);
    expect(eligibleLevelEvolution(4, 20, packWith([level]))?.toPokemonId).toBe(5);
    expect(eligibleLevelEvolution(33, 30, packWith([edge(33, 34, 'item', null, { itemId: 34 })]))).toBeNull();
    expect(eligibleLevelEvolution(64, 30, packWith([edge(64, 65, 'trade', null)]))).toBeNull();
    expect(eligibleLevelEvolution(1, 30, packWith([edge(1, 2, 'other', null, { locationId: 1 })]))).toBeNull();
    expect(eligibleLevelEvolution(236, 30, packWith([
      edge(236, 106, 'level', 20, { reason: 'attack-greater-than-defense' }),
    ]))).toBeNull();
  });
});

describe('resolveTimelineNode', () => {
  it('does not place a target member before its acquisition node', () => {
    const mankey = member('mankey-1', 56, 'route-22');
    const state = timeline(
      { 'mankey-1': mankey },
      {
        'pewter-city': frame(
          'pewter-city',
          ['mankey-1', null, null, null, null, null],
          [],
          { 'mankey-1': snapshot(56, 14, 'party', 0) },
        ),
      },
    );

    const beforeRoute22 = resolve(state, 'route-1');
    const atRoute22 = resolve(state, 'route-22');

    expect(beforeRoute22.party).not.toContain('mankey-1');
    expect(beforeRoute22.snapshots['mankey-1']).toBeUndefined();
    expect(atRoute22.party).toContain('mankey-1');
  });

  it('freezes reserve state while active members auto-level', () => {
    const members = {
      'boxed-pidgey': member('boxed-pidgey', 16, 'route-1'),
      'active-mankey': member('active-mankey', 56, 'route-22'),
    };
    const state = timeline(
      members,
      {
        'pewter-city': frame(
          'pewter-city',
          ['active-mankey', null, null, null, null, null],
          ['boxed-pidgey'],
          {
            'boxed-pidgey': snapshot(16, 6, 'reserve', null),
            'active-mankey': snapshot(56, 14, 'party', 0),
          },
        ),
        'misty-gym': frame(
          'misty-gym',
          ['active-mankey', null, null, null, null, null],
          ['boxed-pidgey'],
          {
            'boxed-pidgey': snapshot(16, 12, 'reserve', null),
            'active-mankey': snapshot(56, 20, 'party', 0),
          },
        ),
      },
      {},
      { levelMode: 'match', autoEvolveLevel: false },
    );

    const result = resolve(state, 'cerulean-city');

    expect(result.snapshots['boxed-pidgey'].level).toBe(6);
    expect(result.snapshots['active-mankey'].level).toBe(20);
  });

  it('auto-evolves only level-triggered evolutions when enabled', () => {
    const levelEdge = edge(4, 5, 'level', 16);
    const itemEdge = edge(33, 34, 'item', null, { itemId: 34 });
    const members = {
      charmander: member('charmander', 4, 'route-1'),
      nidorino: member('nidorino', 33, 'route-1'),
    };
    const state = timeline(
      members,
      {
        'route-1': frame(
          'route-1',
          ['charmander', 'nidorino', null, null, null, null],
          [],
          {
            charmander: snapshot(4, 15, 'party', 0),
            nidorino: snapshot(33, 15, 'party', 1),
          },
        ),
        'pewter-city': frame(
          'pewter-city',
          ['charmander', 'nidorino', null, null, null, null],
          [],
          {
            charmander: snapshot(4, 20, 'party', 0),
            nidorino: snapshot(33, 20, 'party', 1),
          },
        ),
      },
      {},
      { levelMode: 'match', autoEvolveLevel: true },
    );

    const result = resolve(state, 'cerulean-city', packWith([levelEdge, itemEdge]));

    expect(result.snapshots.charmander.speciesId).toBe(5);
    expect(result.snapshots.nidorino.speciesId).toBe(33);
  });

  it('resolves an exact override before a major keyframe and reports the exact source label', () => {
    const members = {
      mankey: member('mankey', 56, 'route-1'),
      pidgey: member('pidgey', 16, 'route-1'),
    };
    const major = frame(
      'route-22',
      ['mankey', null, null, null, null, null],
      ['pidgey'],
      { mankey: snapshot(56, 10, 'party', 0), pidgey: snapshot(16, 6, 'reserve', null) },
    );
    const override = frame(
      'route-22',
      ['pidgey', null, null, null, null, null],
      ['mankey'],
      { pidgey: snapshot(16, 8, 'party', 0), mankey: snapshot(56, 10, 'reserve', null) },
      'override',
    );
    const withOverride = timeline(members, { 'route-22': major }, { 'route-22': override });
    const withoutOverride = timeline(members, { 'route-22': major });

    expect(resolve(withOverride, 'route-22')).toMatchObject({ source: 'explicit-override', party: ['pidgey', null, null, null, null, null] });
    expect(resolve(withoutOverride, 'route-22')).toMatchObject({ source: 'explicit-major', party: ['mankey', null, null, null, null, null] });
  });

  it('deterministically interpolates surrounding explicit levels without mutating persisted input', () => {
    const members = { mankey: member('mankey', 56, 'route-1') };
    const state = timeline(members, {
      'route-1': frame(
        'route-1',
        ['mankey', null, null, null, null, null],
        [],
        { mankey: snapshot(56, 10, 'party', 0) },
      ),
      'pewter-city': frame(
        'pewter-city',
        ['mankey', null, null, null, null, null],
        [],
        { mankey: snapshot(56, 20, 'party', 0) },
      ),
    });
    const before = JSON.stringify(state);

    const result = resolve(state, 'route-22');

    expect(result.source).toBe('auto-filled');
    expect(result.snapshots.mankey.level).toBe(15);
    expect(JSON.stringify(state)).toBe(before);
    expect(result.party).not.toBe(state.keyframes['pewter-city'].party);
    expect(result.snapshots.mankey).not.toBe(state.keyframes['pewter-city'].snapshots.mankey);
  });
});
