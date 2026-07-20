import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadFireRedPack, type FireRedDigest } from './game-pack';

/**
 * Real committed pack bytes, keyed by the manifest-relative asset path. Using the real
 * assets keeps the loader test faithful to the shipped schema and cross-references while
 * the digest stays a pure injected fake — no real Web Crypto, no network.
 */
const PACK_DIR = resolve(process.cwd(), 'public/data/firered');
const ASSET_PATHS = [
  'pokemon.json',
  'moves.json',
  'learnsets.json',
  'encounters.json',
  'progression.json',
  'acquisitions.json',
  'evolutions.json',
  'type-chart.json',
  'indexes/pokemon-by-move.json',
  'indexes/pokemon-by-type.json',
  'indexes/pokemon-by-ability.json',
  'indexes/routes-by-pokemon.json',
  'indexes/availability-by-milestone.json',
] as const;

function readAsset(path: string): Uint8Array {
  return new Uint8Array(readFileSync(resolve(PACK_DIR, path)));
}

/** Deterministic, non-cryptographic 64-hex "digest" so tests never touch real crypto. */
function fakeDigestHex(bytes: Uint8Array): string {
  const words = new Uint32Array(8);
  for (let i = 0; i < bytes.length; i += 1) {
    const lane = i % 8;
    words[lane] = (Math.imul(words[lane] ^ bytes[i], 16_777_619) >>> 0);
  }
  words[0] = (words[0] ^ bytes.length) >>> 0;
  return [...words].map((word) => word.toString(16).padStart(8, '0')).join('');
}

const fakeDigest: FireRedDigest = (bytes) => Promise.resolve(fakeDigestHex(bytes));

/** A digest returning an ArrayBuffer (Web-Crypto-shaped) with the same underlying value. */
const fakeDigestBuffer: FireRedDigest = (bytes) => {
  const hex = fakeDigestHex(bytes);
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return Promise.resolve(out.buffer);
};

interface Descriptor { path: string; sha256: string; schemaVersion: 1 }

/** Build a v2 manifest whose per-asset hashes agree with the injected fake digest. */
function buildManifest(bytesByPath: Map<string, Uint8Array>): unknown {
  const descriptor = (path: string): Descriptor => ({
    path,
    sha256: fakeDigestHex(bytesByPath.get(path)!),
    schemaVersion: 1,
  });
  return {
    schemaVersion: 2,
    packVersion: `firered-${'a'.repeat(64)}`,
    game: { id: 'firered', name: 'Pokémon FireRed', versionId: 10, versionGroupId: 7, generationId: 3 },
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
}

interface Harness {
  fetcher: ReturnType<typeof vi.fn>;
  urls: string[];
  bytesByPath: Map<string, Uint8Array>;
}

/**
 * A fake fetcher that serves the manifest and real asset bytes anchored under baseUrl. The
 * manifest is always built from the clean bytes; `mutate` then corrupts only the SERVED
 * bytes, so a mutation produces a genuine hash mismatch (not a manifest that matches junk).
 */
function makeHarness(baseUrl: string, mutate?: (bytesByPath: Map<string, Uint8Array>) => void): Harness {
  const cleanBytes = new Map<string, Uint8Array>();
  for (const path of ASSET_PATHS) cleanBytes.set(path, readAsset(path));

  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const manifestUrl = `${base}data/firered/manifest.json`;
  const manifestBytes = new TextEncoder().encode(JSON.stringify(buildManifest(cleanBytes)));

  const bytesByPath = new Map(cleanBytes);
  mutate?.(bytesByPath);

  const urls: string[] = [];
  const fetcher = vi.fn((input: string, _init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    if (url === manifestUrl) return Promise.resolve(new Response(manifestBytes));
    const assetPath = url.startsWith(`${base}data/firered/`) ? url.slice(`${base}data/firered/`.length) : null;
    if (assetPath !== null && bytesByPath.has(assetPath)) {
      return Promise.resolve(new Response(bytesByPath.get(assetPath)! as unknown as BodyInit));
    }
    return Promise.resolve(new Response('not found', { status: 404 }));
  });
  return { fetcher, urls, bytesByPath };
}

describe('loadFireRedPack', () => {
  it('loads a verified, deeply frozen pack (manifest-first, hash-verified)', async () => {
    const { fetcher } = makeHarness('/');
    const pack = await loadFireRedPack(fetcher as unknown as typeof fetch, fakeDigest, '/');

    expect(pack.pokemon.find((p) => p.id === 56)?.name).toBe('Mankey');
    expect(pack.moves.length).toBe(354);
    expect(pack.manifest.schemaVersion).toBe(2);
    expect(pack.indexes.pokemonByType.fighting).toContain(56);
    // Deeply frozen aggregate.
    expect(Object.isFrozen(pack)).toBe(true);
    expect(Object.isFrozen(pack.pokemon)).toBe(true);
    expect(Object.isFrozen(pack.pokemon[0])).toBe(true);
    expect(Object.isFrozen(pack.indexes)).toBe(true);
  });

  it('accepts a Web-Crypto-shaped digest that returns an ArrayBuffer', async () => {
    const { fetcher } = makeHarness('/');
    const pack = await loadFireRedPack(fetcher as unknown as typeof fetch, fakeDigestBuffer, '/');
    expect(pack.pokemon.length).toBe(386);
  });

  it('anchors every request under the static base path (root base)', async () => {
    const { fetcher, urls } = makeHarness('/');
    await loadFireRedPack(fetcher as unknown as typeof fetch, fakeDigest, '/');
    expect(urls.length).toBe(ASSET_PATHS.length + 1); // manifest + assets
    for (const url of urls) expect(url.startsWith('/data/firered/')).toBe(true);
    expect(urls).toContain('/data/firered/manifest.json');
  });

  it('anchors every request under a nested static base path', async () => {
    const { fetcher, urls } = makeHarness('/pokeplanner/');
    await loadFireRedPack(fetcher as unknown as typeof fetch, fakeDigest, '/pokeplanner/');
    for (const url of urls) expect(url.startsWith('/pokeplanner/data/firered/')).toBe(true);
  });

  it('forwards the abort signal to the fetcher', async () => {
    const { fetcher } = makeHarness('/');
    const controller = new AbortController();
    await loadFireRedPack(fetcher as unknown as typeof fetch, fakeDigest, '/', controller.signal);
    for (const call of fetcher.mock.calls) {
      expect(call[1]?.signal).toBe(controller.signal);
    }
  });

  it('rejects the whole load on a single corrupt asset and returns no partial pack', async () => {
    const { fetcher } = makeHarness('/', (bytesByPath) => {
      const bytes = bytesByPath.get('moves.json')!;
      const corrupt = Uint8Array.from(bytes);
      corrupt[0] ^= 0xff; // flip a byte so the fake digest no longer matches the manifest
      bytesByPath.set('moves.json', corrupt);
    });
    await expect(loadFireRedPack(fetcher as unknown as typeof fetch, fakeDigest, '/'))
      .rejects.toThrow(/moves\.json/);
  });

  it('verifies the hash BEFORE parsing (garbage bytes fail as a hash mismatch, not a parse error)', async () => {
    const { fetcher } = makeHarness('/', (bytesByPath) => {
      bytesByPath.set('pokemon.json', new TextEncoder().encode('not json at all'));
    });
    await expect(loadFireRedPack(fetcher as unknown as typeof fetch, fakeDigest, '/'))
      .rejects.toThrow(/hash mismatch/i);
  });

  it('rejects when a manifest-listed asset is missing (404)', async () => {
    const bytesByPath = new Map<string, Uint8Array>();
    for (const path of ASSET_PATHS) bytesByPath.set(path, readAsset(path));
    const manifestBytes = new TextEncoder().encode(JSON.stringify(buildManifest(bytesByPath)));
    const fetcher = vi.fn((input: string) => {
      const url = String(input);
      if (url === '/data/firered/manifest.json') return Promise.resolve(new Response(manifestBytes));
      if (url === '/data/firered/encounters.json') return Promise.resolve(new Response('', { status: 404 }));
      const assetPath = url.slice('/data/firered/'.length);
      return Promise.resolve(new Response(bytesByPath.get(assetPath)! as unknown as BodyInit));
    });
    await expect(loadFireRedPack(fetcher as unknown as typeof fetch, fakeDigest, '/'))
      .rejects.toThrow(/encounters\.json/);
  });

  it('reports an HTTP error when the manifest itself cannot be fetched', async () => {
    const fetcher = vi.fn(() => Promise.resolve(new Response('', { status: 500 })));
    await expect(loadFireRedPack(fetcher as unknown as typeof fetch, fakeDigest, '/'))
      .rejects.toThrow(/500/);
  });
});
