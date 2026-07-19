import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PokeApiDataReader } from './pokeapi-data-reader';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const reader = new PokeApiDataReader(resolve('data/fixtures/pokeapi-data'));

describe('PokeApiDataReader', () => {
  afterEach(() => vi.clearAllMocks());

  it('reads a version by the api-data endpoint layout', () => {
    expect(reader.readVersion(10)).toMatchObject({ id: 10, name: 'firered' });
  });

  it('reads a Pokemon without changing its upstream shape', () => {
    expect(reader.readPokemon(56)).toMatchObject({
      id: 56,
      name: 'mankey',
      abilities: [{
        ability: {
          name: 'vital-spirit',
          url: 'https://pokeapi.co/api/v2/ability/72/',
        },
      }],
    });
  });

  it('rejects path-like resource names', () => {
    expect(() => reader.read('../version', 10)).toThrow('Invalid resource');
  });

  it.each([0, 1.5])('rejects invalid IDs before reading a fixture: %s', (id) => {
    expect(() => reader.readPokemon(id)).toThrow(`Invalid resource ID: ${id}`);

    expect(readFileSync).not.toHaveBeenCalled();
  });
});
