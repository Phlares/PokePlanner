import { beforeAll, describe, expect, it } from 'vitest';
import type { FireRedPack } from '../../data/game-pack';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import { FIRE_RED_RULES } from '../rules/firered-rules';
import type { GameRules } from '../rules/game-rules';
import { searchWorkbench, type WorkbenchMatch } from './search';

const CATERPIE = 10;
const FARFETCHD = 83; // In-game trade only: no wild encounter anywhere in the pack.
const MEW = 151;
const MEWTWO = 150;
const DEOXYS = 386;
const MR_MIME = 122;
const MUDKIP = 258; // Not in the FireRed regional dex — transfer only, so placed nowhere.

let pack: FireRedPack;
beforeAll(() => {
  pack = loadFireRedPackFixture();
});

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
