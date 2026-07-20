import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseEncounterAreas } from '../../../src/domain/pack';
import { PokeApiDataReader } from '../pokeapi-data-reader';
import { compileFireRedEncounters } from './encounters';

const fixtureReader = new PokeApiDataReader(resolve('data/fixtures/firered-compiler'));
const sourceReader = new PokeApiDataReader(resolve('.cache/sources/pokeapi-api-data/0fb5313cb77f46269502e987a53a0bf751ae883d'));

describe('FireRed encounter compiler', () => {
  it('keeps Route 22 method rates separate from its Mankey slot chances', () => {
    const route22 = compileFireRedEncounters(fixtureReader).find(({ locationAreaId }) => locationAreaId === 313)!;
    const mankey = route22.methods.find(({ method }) => method === 'walk')!.slots.filter(({ pokemonId }) => pokemonId === 56);

    expect(route22.locationAreaId).toBe(313);
    expect(route22.locationId).toBe(102);
    expect(route22.name).toBe('Route 22');
    expect(route22.methodRates.walk).toBe(21);
    expect(mankey.map(({ maxChance }) => maxChance)).toEqual([45, 45, 45, 45, 45]);
    expect(mankey.map(({ chance }) => chance)).toEqual([20, 10, 10, 4, 1]);
    expect(mankey.map(({ minLevel }) => minLevel)).toEqual([3, 4, 2, 5, 5]);
    expect(mankey.every(({ minLevel, maxLevel }) => minLevel === maxLevel)).toBe(true);
    expect(mankey.some(({ chance }) => chance === 99)).toBe(false);
  });

  it('normalizes curated acquisition and event methods apart from wild encounter methods', () => {
    const route22 = compileFireRedEncounters(fixtureReader).find(({ locationAreaId }) => locationAreaId === 313)!;

    expect(route22.methods.map(({ method }) => method)).toEqual([
      'event', 'gift', 'gift-egg', 'only-one', 'pokeflute', 'walk',
    ]);
    expect(route22.methods.find(({ method }) => method === 'gift-egg')?.slots.at(0)?.conditions)
      .toEqual(['first-party-pokemon-high-friendship']);
  });

  it('rejects unrecognized source methods with their name and location-area ID', () => {
    const reader = {
      readVersion: fixtureReader.readVersion.bind(fixtureReader),
      readVersionGroup: fixtureReader.readVersionGroup.bind(fixtureReader),
      readGeneration: fixtureReader.readGeneration.bind(fixtureReader),
      listIds: () => [313],
      read(resource: string, id: number) {
        if (resource === 'encounter-method' && id === 1) return { id, name: 'mystery-method' };
        const endpoint = fixtureReader.read(resource, id) as Record<string, unknown>;
        if (resource !== 'location-area' || id !== 313) return endpoint;
        return {
          ...endpoint,
          pokemon_encounters: [{
            pokemon: { name: 'mankey', url: '/api/v2/pokemon/56/' },
            version_details: [{
              max_chance: 1,
              version: { name: 'firered', url: '/api/v2/version/10/' },
              encounter_details: [{
                chance: 1, min_level: 1, max_level: 1, condition_values: [],
                method: { name: 'mystery-method', url: '/api/v2/encounter-method/1/' },
              }],
            }],
          }],
        };
      },
    };

    expect(() => compileFireRedEncounters(reader)).toThrow('Unsupported FireRed encounter method: mystery-method in location area 313');
  });

  it('covers every locked FireRed location area with valid Generation I-III encounter records', () => {
    const encounters = compileFireRedEncounters(sourceReader);
    const species = new Set(encounters.flatMap(({ methods }) => methods.flatMap(({ slots }) => slots.map(({ pokemonId }) => pokemonId))));

    expect(encounters).toHaveLength(137);
    expect(species.size).toBe(136);
    expect(encounters.find(({ locationAreaId }) => locationAreaId === 261)?.methods
      .flatMap(({ slots }) => slots)
      .filter(({ pokemonId }) => pokemonId === 116)
      .map(({ maxChance }) => maxChance)).toContain(170);
    expect(encounters.every(({ methods }) => methods.every(({ slots }) => slots.every(({ pokemonId }) => pokemonId >= 1 && pokemonId <= 386)))).toBe(true);
    expect(parseEncounterAreas(encounters)).toEqual(encounters);
    expect(encounters.every(({ provenance }) => provenance.every(({ sourceId, revision }) => sourceId === 'pokeapi-api-data'
      && revision === '0fb5313cb77f46269502e987a53a0bf751ae883d'))).toBe(true);
  }, 120_000);
});
