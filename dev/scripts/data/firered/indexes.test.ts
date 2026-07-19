import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFireRedIndexes, type EvolutionEdge, type PokemonRecord } from '../../../src/domain/pack';
import { PokeApiDataReader } from '../pokeapi-data-reader';
import { normalizeLearnsets, normalizeMoveCatalog, normalizePokemonCatalog } from './normalizer';
import { compileFireRedEncounters } from './encounters';
import { compileEvolutions, type EvolutionOverride } from './evolutions';
import { attachAcquisitionIds, loadFireRedAcquisitions, loadFireRedProgression } from './curated';
import { buildFireRedIndexes, classifyFireRedAvailability, type FireRedPackInputs } from './indexes';

const reader = new PokeApiDataReader(resolve('.cache/sources/pokeapi-api-data/0fb5313cb77f46269502e987a53a0bf751ae883d'));
const overrides = JSON.parse(readFileSync(resolve('data/firered/evolution-overrides.json'), 'utf8')) as EvolutionOverride[];

const pokemon = normalizePokemonCatalog(reader);
const moves = normalizeMoveCatalog(reader);
const acquisitions = loadFireRedAcquisitions();
const learnsets = attachAcquisitionIds(normalizeLearnsets(reader), acquisitions);
const encounters = compileFireRedEncounters(reader);
const evolutions: EvolutionEdge[] = compileEvolutions(reader, pokemon as Pick<PokemonRecord, 'id'>[], overrides);
const progression = loadFireRedProgression();

const inputs: FireRedPackInputs = { pokemon, moves, learnsets, encounters, evolutions, acquisitions, progression };
const indexes = buildFireRedIndexes(inputs);
const classification = classifyFireRedAvailability(inputs);

function isSortedUnique(values: number[]): boolean {
  for (let i = 1; i < values.length; i += 1) if (values[i] <= values[i - 1]) return false;
  return true;
}
function isSortedUniqueStrings(values: string[]): boolean {
  for (let i = 1; i < values.length; i += 1) if (values[i] <= values[i - 1]) return false;
  return true;
}

describe('buildFireRedIndexes', () => {
  it('produces a schema-valid index set', () => {
    expect(() => parseFireRedIndexes(indexes)).not.toThrow();
  });

  it('indexes Mankey by type, ability, and move', () => {
    expect(indexes.pokemonByType.fighting).toContain(56);
    expect(indexes.pokemonByAbility['vital-spirit']).toContain(56);
    expect(indexes.pokemonByMove['karate-chop']).toContain(56);
  });

  it('lists Route 22 among Mankey routes', () => {
    expect(indexes.routesByPokemon['56']).toContain('kanto-route-22');
  });

  it('keeps every index array sorted ascending and duplicate-free', () => {
    for (const ids of Object.values(indexes.pokemonByMove)) expect(isSortedUnique(ids)).toBe(true);
    for (const ids of Object.values(indexes.pokemonByAbility)) expect(isSortedUnique(ids)).toBe(true);
    for (const ids of Object.values(indexes.pokemonByType)) expect(isSortedUnique(ids)).toBe(true);
    for (const slugs of Object.values(indexes.routesByPokemon)) expect(isSortedUniqueStrings(slugs)).toBe(true);
  });

  it('records HM08 Dive as unavailable at every milestone', () => {
    const dive = indexes.availabilityByMilestone['brock-gym'].unavailable.find((entry) => entry.moveId === 291);
    expect(dive).toBeDefined();
    expect(dive!.reason.length).toBeGreaterThan(0);
  });

  it('retains milestone and prerequisites for a future machine entry', () => {
    // At the first badge, Waterfall (HM07, move 127) is a future milestone gated on the Volcano Badge.
    const waterfall = indexes.availabilityByMilestone['brock-gym'].futureMilestone.find((entry) => entry.moveId === 127);
    expect(waterfall).toBeDefined();
    expect(waterfall!.milestoneId).toBe('blaine-gym');
    const hm07 = acquisitions.find((record) => record.subject.kind === 'hm' && record.subject.moveId === 127)!;
    expect(hm07.prerequisites).toContain('blaine-gym');
    // TM39 Rock Tomb (move 317) is available now once the Boulder Badge is earned.
    expect(indexes.availabilityByMilestone['brock-gym'].availableNow.some((entry) => entry.moveId === 317)).toBe(true);
    // The postgame Body Slam tutor (move 34) becomes available at the champion milestone.
    expect(indexes.availabilityByMilestone.champion.availableNow.some((entry) => entry.moveId === 34)).toBe(true);
  });
});

describe('classifyFireRedAvailability', () => {
  it('classifies every one of the 386 species exactly once', () => {
    expect(classification.size).toBe(386);
    for (let id = 1; id <= 386; id += 1) {
      const record = classification.get(id);
      expect(record, `missing classification for ${id}`).toBeDefined();
      expect(['standard', 'postgame', 'version-exclusive', 'event-only', 'transfer-only']).toContain(record!.status);
    }
  });

  it('closes standard availability over legal evolutions', () => {
    expect(classification.get(56)!.status).toBe('standard'); // Mankey (wild)
    expect(classification.get(3)!.status).toBe('standard'); // Venusaur (evolves from the Bulbasaur starter)
    expect(classification.get(134)!.status).toBe('standard'); // Vaporeon (evolves from the Eevee gift)
  });

  it('separates postgame, event-only, and version-exclusive species', () => {
    expect(classification.get(150)!.status).toBe('postgame'); // Mewtwo
    expect(classification.get(151)!.status).toBe('event-only'); // Mew
    expect(classification.get(37)!.status).toBe('version-exclusive'); // Vulpix
    expect(classification.get(38)!.status).toBe('version-exclusive'); // Ninetales (evolution closure)
  });

  it('keeps a transfer-only species searchable but never available in the wild', () => {
    expect(classification.get(252)!.status).toBe('transfer-only'); // Treecko
    // Searchable in the type index...
    expect(indexes.pokemonByType.grass).toContain(252);
    // ...but never wild-available (no route entry).
    expect(indexes.routesByPokemon['252']).toBeUndefined();
  });
}, 60_000);
