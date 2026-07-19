import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PokeApiDataReader } from '../pokeapi-data-reader';
import { normalizePokemonCatalog } from './normalizer';
import type { EvolutionEdge } from '../../../src/domain/pack';
import { compileEvolutions, deriveEvolutionClosure, parseEvolutionOverrides, type EvolutionOverride } from './evolutions';

const reader = new PokeApiDataReader(resolve('.cache/sources/pokeapi-api-data/0fb5313cb77f46269502e987a53a0bf751ae883d'));
const overrides = JSON.parse(readFileSync(resolve('data/firered/evolution-overrides.json'), 'utf8')) as EvolutionOverride[];

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
        expect.objectContaining({ sourceId: 'firered-game-rules', locator: 'onix-steelix', method: 'manual', confidence: 'verified' }),
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
      expect.objectContaining({ fromPokemonId: 349, toPokemonId: 350, reason: 'beauty-condition-unavailable' }),
    ]));
    expect(edges.find(({ fromPokemonId, toPokemonId }) => fromPokemonId === 290 && toPokemonId === 292)?.provenance)
      .toEqual([
        expect.objectContaining({ locator: 'evolution-chain/144', method: 'generated' }),
        expect.objectContaining({ sourceId: 'firered-game-rules', locator: 'nincada-shedinja', method: 'manual' }),
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
        provenance: [{ sourceId: 'pokeapi-api-data', revision: '0fb5313cb77f46269502e987a53a0bf751ae883d', locator: 'test', method: 'manual', confidence: 'verified', note: null }],
      },
    ])).toThrow('did not match exactly one source edge');
  }, 120_000);
});
