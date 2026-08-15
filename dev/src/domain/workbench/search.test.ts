import { beforeAll, describe, expect, it } from 'vitest';
import type { FireRedPack } from '../../data/game-pack';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import { FIRE_RED_RULES } from '../rules/firered-rules';
import type { GameRules } from '../rules/game-rules';
import { hasActiveSearchQuery } from '../search';
import type { MemberSnapshot } from '../timeline/model';
import type { ResolvedTimelineNode } from '../timeline/resolver';
import {
  progressionContextAtNode,
  searchCapability,
  searchWorkbench,
  selectMilestoneBriefing,
  type WorkbenchMatch,
  type WorkbenchSearchQuery,
} from './search';

const CATERPIE = 10;
const FARFETCHD = 83; // In-game trade only: no wild encounter anywhere in the pack.
const MEW = 151;
const MEWTWO = 150;
const DEOXYS = 386;
const MR_MIME = 122;
const MUDKIP = 258; // Not in the FireRed regional dex — transfer only, so placed nowhere.
const PSYDUCK = 54; // Learns Surf from HM03.
const MANKEY = 56; // Neither Mankey nor Primeape can learn Surf.
const MAGIKARP = 129; // Cannot learn Surf; Gyarados, which it evolves into, can.
const LAPRAS = 131;

let pack: FireRedPack;
beforeAll(() => {
  pack = loadFireRedPackFixture();
});

const briefingContext = () => ({ pack, rules: FIRE_RED_RULES });

const SURF_MOVE = { moveId: 57, status: 'available-now' as const, level: null, milestoneId: null };

function snapshot(speciesId: number, overrides: Partial<MemberSnapshot> = {}): MemberSnapshot {
  return {
    speciesId,
    level: 30,
    abilityId: 1,
    moves: [],
    heldItemId: null,
    placement: 'party',
    partySlot: 0,
    review: { moves: false, heldItem: false },
    ...overrides,
  };
}

/**
 * The Safari Zone sits one node past Fuchsia City, so standing here the Soul Badge is won, the
 * Koga milestone is complete, and HM03 — which the pack anchors to Fuchsia City — is in hand.
 */
function surfNode(overrides: Partial<ResolvedTimelineNode> = {}): ResolvedTimelineNode {
  return {
    nodeId: 'kanto-safari-zone',
    source: 'explicit-major',
    party: ['m1', null, null, null, null, null],
    reserve: ['m2'],
    released: [],
    snapshots: {
      m1: snapshot(LAPRAS, { moves: [SURF_MOVE] }),
      m2: snapshot(PSYDUCK, { placement: 'reserve', partySlot: null }),
    },
    ...overrides,
  };
}

const byId = (matches: WorkbenchMatch[], id: number): WorkbenchMatch | undefined =>
  matches.find((match) => match.pokemonId === id);

describe('searchWorkbench — placements', () => {
  it('places a wild species at every progression node that hosts it, with method and level range', () => {
    const caterpie = byId(searchWorkbench({ name: 'Caterpie' }, pack, FIRE_RED_RULES), CATERPIE);
    expect(caterpie).toBeDefined();
    expect(caterpie!.placements.map((placement) => placement.nodeId)).toEqual([
      'kanto-route-2', 'viridian-forest', 'kanto-route-24', 'kanto-route-25', 'pattern-bush',
    ]);
    expect(caterpie!.placements[0]).toEqual({
      nodeId: 'kanto-route-2', methods: ['walk'], minLevel: 4, maxLevel: 5,
    });
  });

  it('widens one placement across repeated slots for the same node and method', () => {
    const caterpie = byId(searchWorkbench({ name: 'Caterpie' }, pack, FIRE_RED_RULES), CATERPIE);
    const forest = caterpie!.placements.find((placement) => placement.nodeId === 'viridian-forest');
    // Viridian Forest lists Caterpie in three separate slots (levels 3, 4 and 5).
    expect(forest).toEqual({ nodeId: 'viridian-forest', methods: ['walk'], minLevel: 3, maxLevel: 5 });
  });

  it('places a non-wild acquisition at the node its rules anchor it to', () => {
    const farfetchd = byId(searchWorkbench({ name: 'farfetchd' }, pack, FIRE_RED_RULES), FARFETCHD);
    expect(farfetchd).toBeDefined();
    expect(farfetchd!.placements).toEqual([
      { nodeId: 'vermilion-city', methods: ['trade'], minLevel: null, maxLevel: null },
    ]);
  });

  it('places nothing for a species with no in-game location', () => {
    const mudkip = byId(searchWorkbench({ name: 'Mudkip' }, pack, FIRE_RED_RULES), MUDKIP);
    expect(mudkip).toBeDefined();
    expect(mudkip!.placements).toEqual([]);
  });

  it('places nothing where the rules name a node the progression graph does not carry', () => {
    // A milestone can be configured before the pack's first node (FireRed's `starter` is), so an
    // anchor that resolves to a non-node must drop out rather than invent a route row.
    const rules: GameRules = { ...FIRE_RED_RULES, acquisitionNodeId: () => 'nowhere-town' };
    const farfetchd = byId(searchWorkbench({ name: 'farfetchd' }, pack, rules), FARFETCHD);
    expect(farfetchd).toBeDefined();
    expect(farfetchd!.placements).toEqual([]);
  });

  it('places nothing at an encounter area the progression graph does not carry', () => {
    // Deoxys is distributed on Birth Island, which is an encounter area but not a spine node.
    const deoxys = byId(searchWorkbench({ name: 'Deoxys' }, pack, FIRE_RED_RULES), DEOXYS);
    expect(deoxys).toBeDefined();
    expect(deoxys!.placements).toEqual([]);
  });

  it('records every encounter method available for one species at one node', () => {
    const psyduck = byId(searchWorkbench({ name: 'Psyduck' }, pack, FIRE_RED_RULES), 54);
    const viridian = psyduck!.placements.find((placement) => placement.nodeId === 'viridian-city');
    expect(viridian?.methods).toEqual(['super-rod', 'surf']);
  });
});

describe('searchWorkbench — exact match and delegation', () => {
  it('flags a whole-name hit exact and a substring hit inexact', () => {
    const matches = searchWorkbench({ name: 'Mew' }, pack, FIRE_RED_RULES);
    expect(byId(matches, MEW)?.exactMatch).toBe(true);
    expect(byId(matches, MEWTWO)?.exactMatch).toBe(false);
  });

  it('flags a whole-name hit exact when only the slug spells it that way', () => {
    // "Farfetch’d" carries a typographic apostrophe, so the typed name only ever meets the slug.
    const matches = searchWorkbench({ name: 'farfetchd' }, pack, FIRE_RED_RULES);
    expect(byId(matches, FARFETCHD)?.exactMatch).toBe(true);
  });

  it('flags a whole-name hit exact when only the display name spells it that way', () => {
    // "Mr. Mime" is slugged `mr-mime`, so the typed name only ever meets the display name.
    const matches = searchWorkbench({ name: 'Mr. Mime' }, pack, FIRE_RED_RULES);
    expect(byId(matches, MR_MIME)?.exactMatch).toBe(true);
  });

  it('flags nothing exact when the query carries no name filter', () => {
    const matches = searchWorkbench({ type: 'normal' }, pack, FIRE_RED_RULES);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((match) => match.exactMatch)).toBe(false);
  });

  it('reads a capability filter as an active search', () => {
    // Ruling 1: `capability` must stay a plain string, because `hasActiveSearchQuery` counts only
    // string values. Any other shape reads as "no search" and silently reverts to browse mode.
    const query: WorkbenchSearchQuery = { capability: 'surf' };
    expect(hasActiveSearchQuery(query)).toBe(true);
  });

  it('filters a capability search to the species that can supply it, evolutions included', () => {
    const ids = searchWorkbench({ capability: 'surf' }, pack, FIRE_RED_RULES).map((match) => match.pokemonId);

    expect(ids).toContain(PSYDUCK);
    expect(ids).toContain(MAGIKARP);
    expect(ids).not.toContain(MANKEY);
  });

  it('treats a blank capability or route filter as no filter at all', () => {
    const unfiltered = searchWorkbench({}, pack, FIRE_RED_RULES).length;

    expect(unfiltered).toBeGreaterThan(0);
    expect(searchWorkbench({ capability: '  ', nodeId: '  ' }, pack, FIRE_RED_RULES)).toHaveLength(unfiltered);
  });

  it('matches nothing for a capability the ruleset does not carry', () => {
    expect(searchWorkbench({ capability: 'dive' }, pack, FIRE_RED_RULES)).toEqual([]);
  });

  it('narrows a route search to that route and drops species placed nowhere on it', () => {
    const matches = searchWorkbench({ nodeId: 'kanto-safari-zone' }, pack, FIRE_RED_RULES);

    expect(matches.length).toBeGreaterThan(0);
    expect(matches.map((match) => match.pokemonId)).toContain(MAGIKARP);
    expect(matches.map((match) => match.pokemonId)).not.toContain(CATERPIE);
    expect(matches.flatMap((match) => match.placements.map((placement) => placement.nodeId)))
      .toEqual(matches.map(() => 'kanto-safari-zone'));
  });

  it('keeps the pack search intersection, ordering and result fields', () => {
    const matches = searchWorkbench({ type: 'fighting', move: 'karate-chop' }, pack, FIRE_RED_RULES);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.map((match) => match.pokemonId)).toEqual(
      [...matches.map((match) => match.pokemonId)].sort((a, b) => a - b),
    );
    for (const match of matches) {
      expect(match.types).toContain('fighting');
      expect(match.moveMatch?.moveSlug).toBe('karate-chop');
      expect(match.obtainability.status).toBeDefined();
    }
  });
});

describe('selectMilestoneBriefing', () => {
  it('keeps milestone briefings terse and searchable', () => {
    expect(selectMilestoneBriefing('koga-gym', briefingContext())).toEqual({
      requires: expect.arrayContaining([expect.objectContaining({ id: 'surf', label: 'Surf' })]),
      unlocks: expect.arrayContaining([expect.objectContaining({ id: 'safari-zone', label: 'Safari Zone' })]),
    });
  });

  it('gives every token a label and a runnable workbench search', () => {
    const briefing = selectMilestoneBriefing('koga-gym', briefingContext());

    expect(briefing.requires).toContainEqual({
      id: 'surf', label: 'Surf', kind: 'capability', searchQuery: { capability: 'surf' },
    });
    expect(briefing.unlocks).toContainEqual({
      id: 'safari-zone', label: 'Safari Zone', kind: 'location', searchQuery: { nodeId: 'kanto-safari-zone' },
    });
  });

  it('requires only the field capabilities that gate its own leg of the path', () => {
    // Routes 12 and 13 and Fuchsia City carry Surf water; the rods, Poké Flute and walking that
    // share those nodes are not field capabilities, and nothing on the leg needs Rock Smash.
    expect(selectMilestoneBriefing('koga-gym', briefingContext()).requires.map((token) => token.id))
      .toEqual(['surf']);
  });

  it('unlocks the capability the milestone enables and the leg it opens next', () => {
    expect(selectMilestoneBriefing('koga-gym', briefingContext()).unlocks.map((token) => token.id))
      .toEqual(['surf', 'safari-zone', 'route-16', 'route-17', 'route-18', 'saffron-city']);
  });

  it('leaves the optional detours off the leg a milestone opens', () => {
    // Routes 24 and 25 share that stretch of the spine with Routes 5 and 6, but branch off it.
    expect(selectMilestoneBriefing('misty-gym', briefingContext()).unlocks.map((token) => token.id))
      .toEqual(['cut', 'route-5', 'route-6', 'vermilion-city']);
  });

  it('names a machine unlock from the acquisition the pack records for it', () => {
    expect(selectMilestoneBriefing('brock-gym', briefingContext()).unlocks).toContainEqual({
      id: 'tm39-rock-tomb', label: 'TM39 Rock Tomb', kind: 'tm', searchQuery: { move: 'rock-tomb' },
    });
  });

  it('leaves an unlock the workbench cannot search out of the briefing', () => {
    // Giovanni's gym grants the Earth Badge, which the pack records as a service: nothing to search.
    expect(selectMilestoneBriefing('giovanni-gym', briefingContext()).unlocks.map((token) => token.id))
      .toEqual(['pokemon-mansion', 'route-23', 'victory-road', 'indigo-plateau']);
  });

  it('briefs nothing for a milestone the ruleset does not carry', () => {
    expect(selectMilestoneBriefing('elite-four', briefingContext())).toEqual({ requires: [], unlocks: [] });
  });
});

describe('searchCapability', () => {
  it('uses one capability state across party, reserve and candidates', () => {
    const result = searchCapability('surf', surfNode(), pack, FIRE_RED_RULES);

    expect(result.party.m1.state).toBe('knows');
    expect(result.reserve.m2.state).toBe('can-now');
    expect(result.candidates[MAGIKARP].state).toBe('conditional');
    expect(result.candidates[MANKEY]).toBeUndefined();
  });

  it('carries the subject and the shared evaluator evidence onto every highlight', () => {
    const result = searchCapability('surf', surfNode(), pack, FIRE_RED_RULES);

    expect(result.party.m1).toMatchObject({
      speciesId: LAPRAS,
      memberId: 'm1',
      evidenceIds: expect.arrayContaining(['capability:surf', 'move:57', 'hm03-surf']),
    });
    expect(result.candidates[MAGIKARP]).toMatchObject({ speciesId: MAGIKARP, memberId: null });
  });

  it('summarises the reserve as aggregate counts and matching member ids', () => {
    const node = surfNode();
    const result = searchCapability('surf', {
      ...node,
      reserve: ['m2', 'm3'],
      snapshots: { ...node.snapshots, m3: snapshot(MANKEY, { placement: 'reserve', partySlot: null }) },
    }, pack, FIRE_RED_RULES);

    expect(result.reserveSummary).toEqual({
      counts: { knows: 0, 'can-now': 1, conditional: 0, none: 1 },
      memberIds: ['m2'],
    });
  });

  it('holds the whole team conditional before the milestone that unlocks the capability', () => {
    // Cerulean City is five milestones short of Koga: the move is planned, the field use is not.
    const result = searchCapability('surf', surfNode({ nodeId: 'cerulean-city' }), pack, FIRE_RED_RULES);

    expect(result.party.m1.state).toBe('conditional');
    expect(result.reserve.m2.state).toBe('conditional');
  });

  it('counts a milestone complete only once the run is past the node that carries it', () => {
    // Standing in Fuchsia City is standing at Koga's door: the Soul Badge is not won yet.
    const result = searchCapability('surf', surfNode({ nodeId: 'fuchsia-city' }), pack, FIRE_RED_RULES);

    expect(result.party.m1.state).toBe('conditional');
  });

  it('returns an empty result for a capability the ruleset does not carry', () => {
    expect(searchCapability('dive', surfNode(), pack, FIRE_RED_RULES)).toEqual({
      capabilityId: 'dive',
      party: {},
      reserve: {},
      candidates: {},
      reserveSummary: { counts: { knows: 0, 'can-now': 0, conditional: 0, none: 0 }, memberIds: [] },
    });
  });
});

describe('progressionContextAtNode', () => {
  it('reads badges off the milestones the run has actually finished', () => {
    // Only Brock is behind Cerulean City: Misty is fought at it, and Giovanni's gym stands in
    // Viridian City — walked past on the way out of Pallet Town, but fought last of all.
    expect([...progressionContextAtNode('cerulean-city', pack, FIRE_RED_RULES).badgeIds])
      .toEqual(['boulder-badge']);
    // Every gym is behind One Island, and the two badgeless milestones still count for nothing.
    expect(progressionContextAtNode('one-island', pack, FIRE_RED_RULES).badgeCount).toBe(8);
  });

  it('counts a progression event complete only once the run is past the node carrying it', () => {
    const completedAt = (id: string) => progressionContextAtNode(id, pack, FIRE_RED_RULES)
      .completedMilestoneIds.has('viridian-oaks-parcel');

    expect(completedAt('viridian-city')).toBe(false);
    expect(completedAt('kanto-route-2')).toBe(true);
  });
});
