import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PokeApiDataReader } from './pokeapi-data-reader';

const reader = new PokeApiDataReader(resolve('data/fixtures/pokeapi-data'));

describe('PokeApiDataReader', () => {
  it('reads a version by the api-data endpoint layout', () => {
    expect(reader.readVersion(10)).toMatchObject({ id: 10, name: 'firered' });
  });

  it('reads a Pokemon without changing its upstream shape', () => {
    expect(reader.readPokemon(56)).toMatchObject({ id: 56, name: 'mankey' });
  });

  it('rejects path-like resource names', () => {
    expect(() => reader.read('../version', 10)).toThrow('Invalid resource');
  });
});
