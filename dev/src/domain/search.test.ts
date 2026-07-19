import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadFireRedPack, type FireRedPack } from '../data/game-pack';
import { searchFireRed, type SearchResult } from './search';

const PACK_DIR = resolve(process.cwd(), 'public/data/firered');
const digest = (bytes: Uint8Array): Promise<string> =>
  Promise.resolve(createHash('sha256').update(Buffer.from(bytes)).digest('hex'));
const fetcher = ((input: string): Promise<Response> => {
  const rel = String(input).replace(/^\/data\/firered\//, '');
  return Promise.resolve(new Response(readFileSync(resolve(PACK_DIR, rel))));
}) as unknown as typeof fetch;

const MANKEY = 56;
const SQUIRTLE = 7;
const MUDKIP = 258; // Not in the FireRed regional dex — transfer only.

let pack: FireRedPack;
beforeAll(async () => {
  pack = await loadFireRedPack(fetcher, digest, '/');
});

const ids = (results: SearchResult[]): number[] => results.map((result) => result.pokemonId);
const byId = (results: SearchResult[], id: number): SearchResult | undefined =>
  results.find((result) => result.pokemonId === id);

describe('searchFireRed — single filters', () => {
  it('filters by name substring (case-insensitive)', () => {
    const results = searchFireRed({ name: 'Mankey' }, pack);
    expect(ids(results)).toContain(MANKEY);
    expect(results.every((result) => result.name.toLowerCase().includes('mankey'))).toBe(true);
  });

  it('filters by type from the pokemon-by-type index', () => {
    const results = searchFireRed({ type: 'fighting' }, pack);
    expect(ids(results)).toContain(MANKEY);
    expect(results.every((result) => result.types.includes('fighting'))).toBe(true);
  });

  it('filters by ability from the pokemon-by-ability index', () => {
    const results = searchFireRed({ ability: 'vital-spirit' }, pack);
    expect(ids(results)).toContain(MANKEY);
  });

  it('filters by move from the pokemon-by-move index', () => {
    const results = searchFireRed({ move: 'karate-chop' }, pack);
    expect(ids(results)).toContain(MANKEY);
  });
});

describe('searchFireRed — intersection, route counts and flags', () => {
  it('intersects multiple filters (AND semantics)', () => {
    const results = searchFireRed({ type: 'fighting', move: 'karate-chop' }, pack);
    expect(ids(results)).toContain(MANKEY);
    for (const result of results) {
      expect(result.types).toContain('fighting');
      expect(result.moveMatch?.moveSlug).toBe('karate-chop');
    }
  });

  it('sources route match counts from routes-by-pokemon', () => {
    const results = searchFireRed({ type: 'fighting' }, pack);
    const mankey = byId(results, MANKEY);
    expect(mankey?.routes).toEqual(pack.indexes.routesByPokemon[String(MANKEY)]);
    expect(mankey?.routeCount).toBe(pack.indexes.routesByPokemon[String(MANKEY)]?.length ?? 0);
  });

  it('surfaces a version-valid move match for an in-game learn method', () => {
    const results = searchFireRed({ move: 'karate-chop' }, pack);
    const mankey = byId(results, MANKEY);
    expect(mankey?.moveMatch?.versionValid).toBe(true);
    expect(mankey?.moveMatch?.methods.length).toBeGreaterThan(0);
  });

  it('keeps a move learnable only via a non-existent machine searchable but flagged (not version-valid)', () => {
    const results = searchFireRed({ move: 'dive' }, pack);
    const squirtle = byId(results, SQUIRTLE);
    expect(squirtle).toBeDefined();
    expect(squirtle?.moveMatch?.versionValid).toBe(false);
  });

  it('keeps a transfer-only species searchable but flagged', () => {
    const results = searchFireRed({ name: 'Mudkip' }, pack);
    const mudkip = byId(results, MUDKIP);
    expect(mudkip).toBeDefined();
    expect(mudkip?.obtainability.status).toBe('transfer-only');
    expect(mudkip?.obtainability.flagged).toBe(true);
  });

  it('does not flag a standard wild species', () => {
    const results = searchFireRed({ name: 'Mankey' }, pack);
    expect(byId(results, MANKEY)?.obtainability.flagged).toBe(false);
  });

  it('returns results deterministically ordered by id and unique', () => {
    const results = searchFireRed({ type: 'fighting' }, pack);
    const list = ids(results);
    expect(list).toEqual([...list].sort((a, b) => a - b));
    expect(new Set(list).size).toBe(list.length);
  });
});
