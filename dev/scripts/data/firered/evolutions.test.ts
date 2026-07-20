import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PokeApiDataReader } from '../pokeapi-data-reader';
import { normalizePokemonCatalog } from './normalizer';
import type { EvolutionEdge, PokemonRecord } from '../../../src/domain/pack';
import {
  assertOverrideSourcesRegistered,
  compileEvolutions,
  deriveEvolutionClosure,
  parseEvolutionOverrides,
  parseEvolutionSources,
  type EvolutionOverride,
} from './evolutions';

const reader = new PokeApiDataReader(resolve('.cache/sources/pokeapi-api-data/0fb5313cb77f46269502e987a53a0bf751ae883d'));
const overrides = JSON.parse(readFileSync(resolve('data/firered/evolution-overrides.json'), 'utf8')) as EvolutionOverride[];
const sourcesInput = JSON.parse(readFileSync(resolve('data/firered/sources.json'), 'utf8')) as unknown;
const completeCatalog = Array.from({ length: 386 }, (_, index) => ({ id: index + 1 })) satisfies Pick<PokemonRecord, 'id'>[];

function evolutionDetail(versionGroupId: number, minimumLevel: number) {
  return {
    base_form: null, evolved_form: null, held_item: null, item: null, location: null,
    min_affection: null, min_beauty: null, min_happiness: null, min_level: minimumLevel,
    relative_physical_stats: null, time_of_day: '',
    trigger: { name: 'level-up', url: '/api/v2/evolution-trigger/1/' },
    version_group: { name: `group-${versionGroupId}`, url: `/api/v2/version-group/${versionGroupId}/` },
  };
}

function syntheticReader(details: unknown[]) {
  return {
    read(resource: string, id: number): unknown {
      if (resource === 'pokemon-species') return { evolution_chain: { url: '/api/v2/evolution-chain/1/' } };
      if (resource === 'evolution-chain') return {
        chain: {
          species: { url: '/api/v2/pokemon-species/1/' }, evolution_details: [],
          evolves_to: [{
            species: { url: '/api/v2/pokemon-species/2/' }, evolution_details: details, evolves_to: [],
          }],
        },
      };
      throw new Error(`Unexpected ${resource}/${id}`);
    },
    readVersion: () => ({ id: 10, name: 'firered', version_group: { name: 'firered-leafgreen', url: '/api/v2/version-group/7/' } }),
    readVersionGroup: (id: number) => id === 7
      ? { id: 7, name: 'firered-leafgreen', order: 7, generation: { name: 'generation-iii', url: '/api/v2/generation/3/' } }
      : { id, order: id },
    readGeneration: () => ({ id: 3, name: 'generation-iii' }),
  };
}

describe('FireRed evolution compiler', () => {
  it('parses manual overrides strictly with complete provenance and one normalized rationale', () => {
    expect(parseEvolutionOverrides(overrides)).toEqual(overrides);
    expect(() => parseEvolutionOverrides([{ ...overrides[0], status: 'later' }])).toThrow();
    expect(() => parseEvolutionOverrides([{ ...overrides[0], milestoneId: 'National Dex' }])).toThrow();
    expect(() => parseEvolutionOverrides([{ ...overrides[0], reason: 'also-a-reason' }])).toThrow();
    expect(() => parseEvolutionOverrides([{ ...overrides[0], provenance: [] }])).toThrow();
    expect(() => parseEvolutionOverrides([{ ...overrides[0], provenance: [{ ...overrides[0].provenance[0], extra: true }] }])).toThrow();
    expect(() => parseEvolutionOverrides([{ ...overrides[0], extra: true }])).toThrow();
  });

  it('resolves every override provenance source through the strict manual-source registry', () => {
    const sources = parseEvolutionSources(sourcesInput);

    expect(sources.sources.map(({ url }) => url)).toEqual([
      'https://bulbapedia.bulbagarden.net/wiki/Evolution_prevention',
      'https://bulbapedia.bulbagarden.net/wiki/Methods_of_Evolution',
      'https://bulbapedia.bulbagarden.net/wiki/Personality_values',
      'https://bulbapedia.bulbagarden.net/wiki/Nincada_%28Pok%C3%A9mon%29',
    ]);
    expect(sources.sources.every(({ name }) => name.trim().length > 0)).toBe(true);
    expect(() => assertOverrideSourcesRegistered(overrides, sources)).not.toThrow();
    expect(() => parseEvolutionSources({ ...(sourcesInput as object), extra: true })).toThrow();
    const [{ name: _name, ...sourceWithoutName }, ...remainingSources] = sources.sources;
    expect(() => parseEvolutionSources({ ...sources, sources: [sourceWithoutName, ...remainingSources] })).toThrow();
    expect(() => assertOverrideSourcesRegistered([
      { ...overrides[0], provenance: [{ ...overrides[0].provenance[0], sourceId: 'undeclared-source' }] },
    ], sources)).toThrow('Undeclared override provenance source');
  });

  it('selects the latest evolution detail applicable to FireRed by version-group order', () => {
    const edges = compileEvolutions(syntheticReader([
      evolutionDetail(1, 10), evolutionDetail(8, 30), evolutionDetail(7, 20),
    ]), completeCatalog, []);

    expect(edges).toEqual([expect.objectContaining({ fromPokemonId: 1, toPokemonId: 2, minimumLevel: 20 })]);
    expect(() => compileEvolutions(syntheticReader([evolutionDetail(8, 30)]), completeCatalog, []))
      .toThrow('Expected a FireRed-applicable evolution detail');
  });

  it('requires each Generation I-III Pokemon ID exactly once', () => {
    expect(() => compileEvolutions(syntheticReader([evolutionDetail(7, 20)]), completeCatalog.filter(({ id }) => id !== 2), []))
      .toThrow('Expected Pokemon catalog IDs 1 through 386 exactly once');
    expect(() => compileEvolutions(syntheticReader([evolutionDetail(7, 20)]), [...completeCatalog, { id: 1 }], []))
      .toThrow('Expected Pokemon catalog IDs 1 through 386 exactly once');
  });

  it('rejects undeclared manual provenance during compilation', () => {
    expect(() => compileEvolutions(syntheticReader([evolutionDetail(7, 20)]), completeCatalog, [{
      fromPokemonId: 1,
      toPokemonId: 2,
      status: 'standard',
      milestoneId: null,
      reason: 'test-reason',
      provenance: [{ sourceId: 'undeclared-source', revision: 'accessed-2026-07-19', locator: 'test', method: 'manual', confidence: 'verified', note: null }],
    }])).toThrow('Undeclared override provenance source');
  });

  it('compiles the FireRed evolution rules from the pinned endpoint-shaped chains', () => {
    const edges = compileEvolutions(reader, normalizePokemonCatalog(reader), overrides);

    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromPokemonId: 1, toPokemonId: 2, trigger: 'level', minimumLevel: 16, itemId: null, locationId: null, status: 'standard', milestoneId: null, reason: null }),
      expect.objectContaining({ fromPokemonId: 2, toPokemonId: 3, trigger: 'level', minimumLevel: 32, status: 'standard', milestoneId: null, reason: null }),
      expect.objectContaining({ fromPokemonId: 64, toPokemonId: 65, trigger: 'trade', minimumLevel: null, itemId: null, status: 'standard', milestoneId: null, reason: null }),
      expect.objectContaining({ fromPokemonId: 95, toPokemonId: 208, trigger: 'trade', itemId: 210, status: 'postgame', milestoneId: 'national-dex', reason: null }),
      expect.objectContaining({ fromPokemonId: 42, toPokemonId: 169, trigger: 'friendship', status: 'postgame', milestoneId: 'national-dex', reason: null }),
      expect.objectContaining({ fromPokemonId: 133, toPokemonId: 196, trigger: 'friendship', status: 'unavailable', milestoneId: null, reason: 'no-day-night-cycle' }),
      expect.objectContaining({ fromPokemonId: 133, toPokemonId: 197, trigger: 'friendship', status: 'unavailable', milestoneId: null, reason: 'no-day-night-cycle' }),
    ]));
    expect(edges.find(({ fromPokemonId, toPokemonId }) => fromPokemonId === 95 && toPokemonId === 208)?.provenance)
      .toEqual([
        expect.objectContaining({ locator: 'evolution-chain/41', method: 'generated', confidence: 'verified' }),
        expect.objectContaining({ sourceId: 'bulbapedia-evolution-prevention', method: 'manual', confidence: 'verified' }),
      ]);
    expect(edges.filter(({ fromPokemonId, toPokemonId }) => fromPokemonId <= 151 && toPokemonId >= 152 && toPokemonId <= 251)
      .every(({ status }) => status !== 'standard')).toBe(true);
    expect(edges.some(({ toPokemonId }) => toPokemonId > 386)).toBe(false);
    expect(edges.some(({ fromPokemonId, toPokemonId }) => fromPokemonId === 112 && toPokemonId === 464)).toBe(false);
    expect(edges).toEqual([...edges].sort((left, right) => left.fromPokemonId - right.fromPokemonId || left.toPokemonId - right.toPokemonId));
  }, 120_000);

  it('retains every special Generation I-III evolution condition as an explicit rationale', () => {
    const edges = compileEvolutions(reader, normalizePokemonCatalog(reader), overrides);

    expect(edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ fromPokemonId: 236, toPokemonId: 106, reason: 'attack-greater-than-defense' }),
      expect.objectContaining({ fromPokemonId: 236, toPokemonId: 107, reason: 'attack-less-than-defense' }),
      expect.objectContaining({ fromPokemonId: 236, toPokemonId: 237, reason: 'attack-equals-defense' }),
      expect.objectContaining({ fromPokemonId: 265, toPokemonId: 266, status: 'standard', reason: 'personality-value-branch' }),
      expect.objectContaining({ fromPokemonId: 265, toPokemonId: 268, status: 'standard', reason: 'personality-value-branch' }),
      expect.objectContaining({ fromPokemonId: 290, toPokemonId: 292, status: 'standard', reason: 'empty-party-slot' }),
      expect.objectContaining({ fromPokemonId: 133, toPokemonId: 196, reason: 'no-day-night-cycle' }),
      expect.objectContaining({ fromPokemonId: 133, toPokemonId: 197, reason: 'no-day-night-cycle' }),
      expect.objectContaining({ fromPokemonId: 349, toPokemonId: 350, status: 'transfer-only', reason: 'requires-pre-raised-beauty' }),
    ]));
    expect(edges.find(({ fromPokemonId, toPokemonId }) => fromPokemonId === 290 && toPokemonId === 292)?.provenance)
      .toEqual([
        expect.objectContaining({ locator: 'evolution-chain/144', method: 'generated' }),
        expect.objectContaining({ sourceId: 'bulbapedia-nincada', method: 'manual' }),
      ]);
  }, 120_000);

  it('derives a sorted closure without FireRed-unavailable evolutions', () => {
    const edges = compileEvolutions(reader, normalizePokemonCatalog(reader), overrides);

    expect(deriveEvolutionClosure([133, 1], edges)).toEqual([1, 2, 3, 133, 134, 135, 136]);
  }, 120_000);

  it('keeps closure IDs within the Generation I-III species scope', () => {
    const futureEdge = {
      fromPokemonId: 1,
      toPokemonId: 387,
      trigger: 'level',
      minimumLevel: 16,
      itemId: null,
      locationId: null,
      status: 'standard',
      milestoneId: null,
      reason: null,
      provenance: [{ sourceId: 'pokeapi-api-data', revision: '0fb5313cb77f46269502e987a53a0bf751ae883d', locator: 'test', method: 'generated', confidence: 'verified', note: null }],
    } as EvolutionEdge;

    expect(deriveEvolutionClosure([1], [futureEdge])).toEqual([1]);
  });

  it('rejects an override that does not match one compiled source edge', () => {
    expect(() => compileEvolutions(reader, normalizePokemonCatalog(reader), [
      ...overrides,
      {
        fromPokemonId: 1,
        toPokemonId: 386,
        status: 'unavailable',
        milestoneId: null,
        reason: 'not-a-real-evolution',
        provenance: [{ sourceId: 'bulbapedia-methods-of-evolution', revision: 'accessed-2026-07-19', locator: 'test', method: 'manual', confidence: 'verified', note: null }],
      },
    ])).toThrow('did not match exactly one source edge');
  }, 120_000);
});
