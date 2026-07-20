import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { EncounterArea, EvolutionEdge, PokemonRecord } from '../../../src/domain/pack';
import { PokeApiDataReader } from '../pokeapi-data-reader';
import { normalizeLearnsets, normalizeMoveCatalog, normalizePokemonCatalog, normalizeTypeChart } from './normalizer';
import { compileFireRedEncounters } from './encounters';
import { compileEvolutions, type EvolutionOverride } from './evolutions';
import { attachAcquisitionIds, loadFireRedAcquisitions, loadFireRedProgression } from './curated';
import { buildFireRedIndexes } from './indexes';
import { validateFireRedPack, type FireRedPackData } from './validate-pack';

const reader = new PokeApiDataReader(resolve('.cache/sources/pokeapi-api-data/0fb5313cb77f46269502e987a53a0bf751ae883d'));
const overrides = JSON.parse(readFileSync(resolve('data/firered/evolution-overrides.json'), 'utf8')) as EvolutionOverride[];

function buildRealPack(): FireRedPackData {
  const pokemon = normalizePokemonCatalog(reader);
  const moves = normalizeMoveCatalog(reader);
  const typeChart = normalizeTypeChart(reader);
  const acquisitions = loadFireRedAcquisitions();
  const learnsets = attachAcquisitionIds(normalizeLearnsets(reader), acquisitions);
  const encounters = compileFireRedEncounters(reader);
  const evolutions: EvolutionEdge[] = compileEvolutions(reader, pokemon as Pick<PokemonRecord, 'id'>[], overrides);
  const progression = loadFireRedProgression();
  const indexes = buildFireRedIndexes({ pokemon, moves, learnsets, encounters, evolutions, acquisitions, progression });
  return {
    identity: { versionId: 10, versionGroupId: 7, generationId: 3 },
    pokemon, moves, learnsets, encounters, progression, acquisitions, evolutions, typeChart, indexes,
  };
}

const real = buildRealPack();
const clone = (): FireRedPackData => structuredClone(real);

describe('validateFireRedPack', () => {
  it('accepts the fully compiled FireRed pack', () => {
    expect(() => validateFireRedPack(real)).not.toThrow();
  });

  it('requires exactly 386 species, 354 moves, and 17 types', () => {
    expect(real.pokemon.length).toBe(386);
    expect(real.moves.length).toBe(354);
    expect(Object.keys(real.typeChart).filter((key) => key !== 'provenance').length).toBe(17);
    const short = clone();
    short.pokemon = short.pokemon.filter((record) => record.id !== 200);
    expect(() => validateFireRedPack(short)).toThrow(/386/);
  });

  it('rejects a version/generation identity mismatch', () => {
    const wrong = clone();
    wrong.identity = { versionId: 3, versionGroupId: 7, generationId: 3 };
    expect(() => validateFireRedPack(wrong)).toThrow(/identity|version/i);
  });

  it('rejects an excluded Orre-only Shadow move (PokeAPI 10001..10018)', () => {
    const withShadow = clone();
    (withShadow.moves as unknown[]).push({ ...real.moves[0], id: 10001, slug: 'shadow-rush' });
    expect(() => validateFireRedPack(withShadow)).toThrow(/shadow/i);
  });

  it('rejects duplicate species slugs', () => {
    const dup = clone();
    dup.pokemon[1] = { ...dup.pokemon[1], slug: dup.pokemon[0].slug };
    expect(() => validateFireRedPack(dup)).toThrow(/duplicate/i);
  });

  it('rejects any provisional fact', () => {
    const provisional = clone();
    provisional.moves[0] = {
      ...provisional.moves[0],
      provenance: provisional.moves[0].provenance.map((entry) => ({ ...entry, confidence: 'provisional' })),
    };
    expect(() => validateFireRedPack(provisional)).toThrow(/provisional/i);
  });

  it('rejects an unknown cross-file acquisition reference from a learnset', () => {
    const dangling = clone();
    const machine = dangling.learnsets
      .flatMap((record) => record.moves)
      .find((move) => move.method === 'machine');
    expect(machine).toBeDefined();
    (machine as { acquisitionIds: string[] }).acquisitionIds = ['acquisition-that-does-not-exist'];
    expect(() => validateFireRedPack(dangling)).toThrow(/acquisition|unknown|reference/i);
  });

  it('rejects an unmapped encounter area', () => {
    const orphan = clone();
    orphan.encounters.push({
      locationAreaId: 99999,
      locationId: 1,
      slug: 'phantom-area',
      name: 'Phantom Area',
      nodeId: null,
      methodRates: { walk: 10 },
      methods: [{ method: 'walk', slots: [{ pokemonId: 1, chance: 10, maxChance: 10, minLevel: 2, maxLevel: 3, conditions: [] }] }],
      provenance: [{ sourceId: 'pokeapi-api-data', revision: '0fb5313cb77f46269502e987a53a0bf751ae883d', locator: 'phantom', method: 'generated', confidence: 'verified', note: null }],
    } satisfies EncounterArea);
    expect(() => validateFireRedPack(orphan)).toThrow(/area/i);
  });

  it('rejects a future move listed as available-now at a milestone', () => {
    const contradiction = clone();
    const bucket = contradiction.indexes.availabilityByMilestone['brock-gym'];
    const future = bucket.futureMilestone[0];
    expect(future).toBeDefined();
    bucket.availableNow.push({ moveId: future.moveId, status: 'available-now' });
    expect(() => validateFireRedPack(contradiction)).toThrow(/available/i);
  });

  it('rejects a catalog gap that leaves a species without availability classification', () => {
    const gap = clone();
    gap.pokemon = gap.pokemon.filter((record) => record.id !== 300);
    expect(() => validateFireRedPack(gap)).toThrow();
  });
}, 60_000);
