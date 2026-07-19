import { describe, expect, it } from 'vitest';
import { PokeApiDataReader } from '../pokeapi-data-reader';
import { assertFireRedSourceContext } from './compiler-context';

const reader = new PokeApiDataReader('data/fixtures/firered-compiler');

describe('FireRed compiler context', () => {
  it('asserts the immutable FireRed version, version group, and generation chain', () => {
    expect(assertFireRedSourceContext(reader)).toMatchObject({
      versionId: 10,
      versionGroupId: 7,
      generationId: 3,
      source: {
        id: 'pokeapi-api-data',
        revision: '0fb5313cb77f46269502e987a53a0bf751ae883d',
        license: 'BSD-3-Clause',
        builtAt: '2026-07-19T04:09:43+02:00',
      },
    });
  });

  it('rejects a version that points outside FireRed before normalizing output', () => {
    const mismatchedReader = {
      readVersion: () => ({ id: 10, name: 'firered', version_group: { url: '/api/v2/version-group/8/' } }),
      readVersionGroup: reader.readVersionGroup.bind(reader),
      readGeneration: reader.readGeneration.bind(reader),
    };

    expect(() => assertFireRedSourceContext(mismatchedReader)).toThrow(/version group/i);
  });

  it('rejects a FireRed group that points outside Generation III before output', () => {
    const mismatchedReader = {
      readVersion: reader.readVersion.bind(reader),
      readVersionGroup: () => ({ id: 7, name: 'firered-leafgreen', generation: { url: '/api/v2/generation/4/' } }),
      readGeneration: reader.readGeneration.bind(reader),
    };

    expect(() => assertFireRedSourceContext(mismatchedReader)).toThrow(/Generation III/i);
  });

  it('rejects a generation endpoint that does not identify Generation III before output', () => {
    const mismatchedReader = {
      readVersion: reader.readVersion.bind(reader),
      readVersionGroup: reader.readVersionGroup.bind(reader),
      readGeneration: () => ({ id: 4, name: 'generation-iv' }),
    };

    expect(() => assertFireRedSourceContext(mismatchedReader)).toThrow(/Generation III/i);
  });

  it.each([
    ['version', {
      readVersion: () => ({ id: 10, name: 'leafgreen', version_group: { url: '/api/v2/version-group/7/' } }),
      readVersionGroup: reader.readVersionGroup.bind(reader),
      readGeneration: reader.readGeneration.bind(reader),
    }],
    ['version group', {
      readVersion: reader.readVersion.bind(reader),
      readVersionGroup: () => ({ id: 7, name: 'ruby-sapphire', generation: { url: '/api/v2/generation/3/' } }),
      readGeneration: reader.readGeneration.bind(reader),
    }],
    ['generation', {
      readVersion: reader.readVersion.bind(reader),
      readVersionGroup: reader.readVersionGroup.bind(reader),
      readGeneration: () => ({ id: 3, name: 'generation-iv' }),
    }],
  ])('rejects a mismatched FireRed %s title even when the numeric chain is 10 -> 7 -> 3', (_endpoint, mismatchedReader) => {
    expect(() => assertFireRedSourceContext(mismatchedReader)).toThrow(/FireRed|Generation III/i);
  });

  it('keeps endpoint-shaped representative Pokemon, moves, and referenced resources', () => {
    expect(reader.readPokemon(35)).toMatchObject({
      id: 35,
      name: 'clefairy',
      abilities: [{ ability: { url: '/api/v2/ability/56/' } }],
    });
    expect(reader.readPokemon(94)).toMatchObject({ id: 94, name: 'gengar' });
    expect(reader.readPokemon(56)).toMatchObject({ id: 56, name: 'mankey' });
    expect(reader.read('move', 33)).toMatchObject({ id: 33, name: 'tackle', type: { url: '/api/v2/type/1/' } });
    expect(reader.read('move', 247)).toMatchObject({ id: 247, name: 'shadow-ball', type: { url: '/api/v2/type/8/' } });
    expect(reader.read('move', 7)).toMatchObject({ id: 7, name: 'fire-punch', type: { url: '/api/v2/type/10/' } });
    expect(reader.read('ability', 56)).toMatchObject({ id: 56, name: 'cute-charm' });
    expect(reader.read('type', 9)).toMatchObject({ id: 9, name: 'steel' });
  });
});
