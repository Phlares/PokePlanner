import { describe, expect, it, vi } from 'vitest';
import { loadGamePackManifest, parseGamePackManifest } from './manifest';

const validManifest = {
  schemaVersion: 1,
  packVersion: 'firered-bootstrap-1',
  game: {
    id: 'firered',
    name: 'Pokémon FireRed',
    versionId: 10,
    versionGroupId: 7,
    generationId: 3,
  },
  sources: [{ id: 'pokeapi-api-data', revision: '0fb5313cb77f46269502e987a53a0bf751ae883d' }],
  files: {},
};

const hash = 'a'.repeat(64);
const descriptor = (path: string) => ({ path, sha256: hash, schemaVersion: 1 as const });
const validV2Manifest = {
  schemaVersion: 2,
  packVersion: `firered-${hash}`,
  game: {
    id: 'firered',
    name: 'Pokémon FireRed',
    versionId: 10,
    versionGroupId: 7,
    generationId: 3,
  },
  sources: [{ id: 'pokeapi-api-data', revision: '0fb5313cb77f46269502e987a53a0bf751ae883d' }],
  builtAt: '2026-07-19T04:09:43+02:00',
  validation: { valid: true, pokemonCount: 386, moveCount: 354, typeCount: 17 },
  files: {
    pokemon: descriptor('pokemon.json'),
    moves: descriptor('moves.json'),
    learnsets: descriptor('learnsets.json'),
    encounters: descriptor('encounters.json'),
    progression: descriptor('progression.json'),
    acquisitions: descriptor('acquisitions.json'),
    evolutions: descriptor('evolutions.json'),
    'type-chart': descriptor('type-chart.json'),
    indexes: {
      'pokemon-by-move': descriptor('indexes/pokemon-by-move.json'),
      'pokemon-by-type': descriptor('indexes/pokemon-by-type.json'),
      'pokemon-by-ability': descriptor('indexes/pokemon-by-ability.json'),
      'routes-by-pokemon': descriptor('indexes/routes-by-pokemon.json'),
      'availability-by-milestone': descriptor('indexes/availability-by-milestone.json'),
    },
  },
};

describe('game pack manifest', () => {
  it('rejects a manifest that confuses version and generation', () => {
    expect(() => parseGamePackManifest({ ...validManifest, game: { ...validManifest.game, versionId: 3 } })).toThrow();
  });

  it('loads and validates a legacy v1 manifest with an injected fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(validManifest)));
    await expect(loadGamePackManifest(fetcher, '/data/firered/manifest.json')).resolves.toEqual(validManifest);
  });

  it('accepts and displays the verified v2 FireRed pack manifest', () => {
    const parsed = parseGamePackManifest(validV2Manifest);
    expect(parsed).toEqual(validV2Manifest);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.sources[0].revision).toBe('0fb5313cb77f46269502e987a53a0bf751ae883d');
  });

  it('rejects a v2 manifest missing a required index asset', () => {
    const broken = structuredClone(validV2Manifest) as { files: { indexes: Record<string, unknown> } };
    delete broken.files.indexes['routes-by-pokemon'];
    expect(() => parseGamePackManifest(broken)).toThrow();
  });

  it('reports an HTTP error from the injected fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 404 }));

    await expect(loadGamePackManifest(fetcher, '/data/firered/manifest.json'))
      .rejects.toThrow('Unable to load game pack manifest: 404');
  });
});
