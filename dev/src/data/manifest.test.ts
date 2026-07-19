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

describe('game pack manifest', () => {
  it('rejects a manifest that confuses version and generation', () => {
    expect(() => parseGamePackManifest({ ...validManifest, game: { ...validManifest.game, versionId: 3 } })).toThrow();
  });

  it('loads and validates a manifest with an injected fetcher', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(validManifest)));
    await expect(loadGamePackManifest(fetcher, '/data/firered/manifest.json')).resolves.toEqual(validManifest);
  });
});
