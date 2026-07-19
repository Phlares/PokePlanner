import { describe, expect, it } from 'vitest';
import {
  parseEvolutionEdges,
  parseAcquisitionRecords,
  parseEncounterAreas,
  parseFireRedPackManifest,
  parseFireRedIndexes,
  parseLearnsetRecords,
  parseMoveRecords,
  parsePokemonRecords,
  parseTypeChart,
} from './pack';

const provenance = [{
  sourceId: 'pokeapi-api-data',
  revision: '0fb5313cb77f46269502e987a53a0bf751ae883d',
  locator: 'pokemon/56',
  method: 'generated' as const,
  confidence: 'verified' as const,
  note: null,
}];

const mankey = {
  id: 56,
  slug: 'mankey',
  name: 'Mankey',
  types: ['fighting'],
  abilities: [{ id: 72, name: 'Vital Spirit', slot: 1, shortEffect: 'Prevents sleep.' }],
  baseStats: { hp: 40, attack: 80, defense: 35, specialAttack: 35, specialDefense: 45, speed: 70 },
  evYield: { hp: 0, attack: 1, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 },
  captureRate: 190,
  sprite: 'sprites/pokemon/56.png',
  provenance,
};

const descriptor = { path: 'pokemon.json', sha256: 'a'.repeat(64), schemaVersion: 1 };
const manifest = {
  schemaVersion: 2,
  packVersion: 'firered-test-pack',
  game: { id: 'firered', name: 'Pokémon FireRed', versionId: 10, versionGroupId: 7, generationId: 3 },
  sources: [{ id: 'pokeapi-api-data', revision: provenance[0].revision }],
  builtAt: '2026-07-19T00:00:00.000Z',
  validation: { valid: true, pokemonCount: 1, moveCount: 1, typeCount: 17 },
  files: {
    pokemon: descriptor,
    moves: { ...descriptor, path: 'moves.json' },
    learnsets: { ...descriptor, path: 'learnsets.json' },
    encounters: { ...descriptor, path: 'encounters.json' },
    progression: { ...descriptor, path: 'progression.json' },
    acquisitions: { ...descriptor, path: 'acquisitions.json' },
    evolutions: { ...descriptor, path: 'evolutions.json' },
    'type-chart': { ...descriptor, path: 'type-chart.json' },
    indexes: {
      'pokemon-by-move': { ...descriptor, path: 'indexes/pokemon-by-move.json' },
      'pokemon-by-type': { ...descriptor, path: 'indexes/pokemon-by-type.json' },
      'pokemon-by-ability': { ...descriptor, path: 'indexes/pokemon-by-ability.json' },
      'routes-by-pokemon': { ...descriptor, path: 'indexes/routes-by-pokemon.json' },
      'availability-by-milestone': { ...descriptor, path: 'indexes/availability-by-milestone.json' },
    },
  },
};

describe('FireRed pack contracts', () => {
  it('accepts Generation III Pokemon records without hidden abilities', () => {
    expect(parsePokemonRecords([mankey]).at(0)?.abilities).toEqual([
      { id: 72, name: 'Vital Spirit', slot: 1, shortEffect: expect.any(String) },
    ]);
  });

  it('accepts either legal ability slot and rejects hidden, duplicate, and later slots', () => {
    expect(parsePokemonRecords([{
      ...mankey,
      abilities: [
        mankey.abilities[0],
        { id: 50, name: 'Run Away', slot: 2, shortEffect: 'Lets the Pokémon flee.' },
      ],
    }]).at(0)?.abilities).toHaveLength(2);
    expect(() => parsePokemonRecords([{ ...mankey, abilities: [{ ...mankey.abilities[0], slot: 3 }] }])).toThrow();
    expect(() => parsePokemonRecords([{ ...mankey, abilities: [mankey.abilities[0], { ...mankey.abilities[0], id: 50 }] }])).toThrow();
    expect(() => parsePokemonRecords([{ ...mankey, abilities: [mankey.abilities[0], { ...mankey.abilities[0], slot: 2 }] }])).toThrow();
    expect(() => parsePokemonRecords([{ ...mankey, abilities: [{ ...mankey.abilities[0], isHidden: true }] }])).toThrow();
  });

  it('rejects forbidden Generation III mechanics', () => {
    expect(() => parsePokemonRecords([{ ...mankey, types: ['fairy'] }])).toThrow();
  });

  it('rejects evolutions whose target is not a Generation III Pokemon', () => {
    expect(() => parseEvolutionEdges([{
      fromPokemonId: 56,
      toPokemonId: 467,
      trigger: 'level',
      minimumLevel: 35,
      itemId: null,
      locationId: null,
      status: 'standard',
      reason: null,
      provenance,
    }])).toThrow();
  });

  it('does not admit future moves in an available-now index', () => {
    const validIndexes = {
      pokemonByMove: { 'karate-chop': [56] },
      pokemonByType: { fighting: [56] },
      pokemonByAbility: { 'vital-spirit': [56] },
      routesByPokemon: { '56': ['route-22'] },
      availabilityByMilestone: {
        'pallet-town': { availableNow: [], futureLevel: [], futureMilestone: [], unavailable: [] },
      },
      provenance,
    };
    expect(parseFireRedIndexes(validIndexes)).toMatchObject({ provenance });
    expect(() => parseFireRedIndexes({ ...validIndexes, provenance: [] })).toThrow();
    expect(() => parseFireRedIndexes({
      ...validIndexes,
      availabilityByMilestone: {
        'pallet-town': {
          availableNow: [{ moveId: 2, status: 'future-level', level: 15 }],
          futureLevel: [],
          futureMilestone: [],
          unavailable: [],
        },
      },
    })).toThrow();
    expect(() => parseFireRedIndexes({ ...validIndexes, pokemonByMove: { 'karate-chop': [387] } })).toThrow();
    expect(() => parseFireRedIndexes({ ...validIndexes, routesByPokemon: { '387': ['route-22'] } })).toThrow();
    expect(() => parseFireRedIndexes({
      ...validIndexes,
      availabilityByMilestone: {
        'pallet-town': { availableNow: [{ moveId: 373, status: 'available-now' }], futureLevel: [], futureMilestone: [], unavailable: [] },
      },
    })).toThrow();
  });

  it('parses bounded strict move records', () => {
    const move = { id: 372, slug: 'shadow-ball', name: 'Shadow Ball', type: 'ghost', damageClass: 'physical', power: 80, accuracy: 100, pp: 15, priority: 0, shortEffect: 'Deals damage.', provenance };
    expect(parseMoveRecords([move]).at(0)?.id).toBe(372);
    expect(() => parseMoveRecords([{ ...move, id: 373 }])).toThrow();
    expect(() => parseMoveRecords([{ ...move, unexpected: true }])).toThrow();
  });

  it('parses bounded strict learnset records', () => {
    const learnset = { pokemonId: 386, moves: [{ method: 'machine', moveId: 372, acquisitionIds: ['tm50'] }], provenance };
    expect(parseLearnsetRecords([learnset]).at(0)?.pokemonId).toBe(386);
    expect(() => parseLearnsetRecords([{ ...learnset, pokemonId: 387 }])).toThrow();
    expect(() => parseLearnsetRecords([{ ...learnset, moves: [{ method: 'machine', moveId: 373, acquisitionIds: ['tm50'] }] }])).toThrow();
  });

  it('parses bounded strict encounter areas', () => {
    const area = {
      locationAreaId: 313, locationId: 22, slug: 'route-22-area', name: 'Route 22', nodeId: 'route-22', methodRates: { walk: 21 },
      methods: [{ method: 'walk', slots: [{ pokemonId: 386, chance: 45, maxChance: 45, minLevel: 3, maxLevel: 5, conditions: [] }] }], provenance,
    };
    expect(parseEncounterAreas([area]).at(0)?.locationAreaId).toBe(313);
    expect(() => parseEncounterAreas([{ ...area, methods: [{ ...area.methods[0], slots: [{ ...area.methods[0].slots[0], pokemonId: 387 }] }] }])).toThrow();
    expect(() => parseEncounterAreas([{ ...area, unexpected: true }])).toThrow();
  });

  it('parses bounded strict acquisition records', () => {
    const machine = { id: 'tm50', name: 'TM50', subject: { kind: 'tm', moveId: 372, itemId: 420, machineNumber: 50 }, milestoneId: 'pallet-town', prerequisites: [], repeatable: false, status: 'standard', provenance };
    expect(parseAcquisitionRecords([machine]).at(0)?.id).toBe('tm50');
    expect(() => parseAcquisitionRecords([{ ...machine, subject: { ...machine.subject, moveId: 373 } }])).toThrow();
    expect(() => parseAcquisitionRecords([{ ...machine, subject: { kind: 'gift', pokemonId: 387 } }])).toThrow();
    expect(() => parseAcquisitionRecords([{ ...machine, unexpected: true }])).toThrow();
  });

  it('requires provenance for the generated type chart', () => {
    const chart = Object.fromEntries([
      'normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
      'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark',
    ].map((type) => [type, { weakTo: [], resists: [], immuneTo: [] }]));

    expect(parseTypeChart({ ...chart, provenance }).steel).toEqual({ weakTo: [], resists: [], immuneTo: [] });
    expect(() => parseTypeChart({ ...chart, provenance: [] })).toThrow();
  });

  it('requires the v2 generated tree and local hashed assets', () => {
    expect(parseFireRedPackManifest(manifest)).toMatchObject({ schemaVersion: 2 });
    expect(() => parseFireRedPackManifest({ ...manifest, schemaVersion: 1 })).toThrow();
    expect(() => parseFireRedPackManifest({
      ...manifest,
      files: { ...manifest.files, pokemon: { ...descriptor, path: 'http://example.test/pokemon.json' } },
    })).toThrow();
    const { ['routes-by-pokemon']: _routesByPokemon, ...indexes } = manifest.files.indexes;
    expect(() => parseFireRedPackManifest({ ...manifest, files: { ...manifest.files, indexes } })).toThrow();
  });
});
