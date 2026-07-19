import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFireRedPackManifest, type EvolutionEdge, type PokemonRecord } from '../../../src/domain/pack';
import { PokeApiDataReader } from '../pokeapi-data-reader';
import { normalizeLearnsets, normalizeMoveCatalog, normalizePokemonCatalog, normalizeTypeChart } from './normalizer';
import { compileFireRedEncounters } from './encounters';
import { compileEvolutions, type EvolutionOverride } from './evolutions';
import { attachAcquisitionIds, loadFireRedAcquisitions, loadFireRedProgression } from './curated';
import { buildFireRedIndexes } from './indexes';
import type { FireRedPackData } from './validate-pack';
import { planFireRedPackFiles, serializeCanonical, sha256Hex, buildResearchReport } from './pack-writer';

const PINNED = '2026-07-19T04:09:43+02:00';
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
const sources = real.progression.sources.map((source) => ({ id: source.id, revision: source.revision }));

describe('serializeCanonical', () => {
  it('sorts object keys recursively but preserves compiler-owned array order', () => {
    expect(serializeCanonical({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(
      '{\n  "a": [\n    {\n      "x": 1,\n      "y": 2\n    }\n  ],\n  "b": 1\n}\n',
    );
    expect(serializeCanonical({ list: [3, 1, 2] })).toBe('{\n  "list": [\n    3,\n    1,\n    2\n  ]\n}\n');
  });

  it('terminates every serialization with exactly one newline', () => {
    const serialized = serializeCanonical({ a: 1 });
    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized.endsWith('\n\n')).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('hashes the exact UTF-8 bytes', () => {
    const bytes = serializeCanonical({ name: 'Pokémon FireRed' });
    expect(sha256Hex(bytes)).toBe(createHash('sha256').update(Buffer.from(bytes, 'utf8')).digest('hex'));
    expect(sha256Hex('abc')).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('planFireRedPackFiles', () => {
  const files = planFireRedPackFiles(real, { builtAt: PINNED, sources });
  const byPath = new Map(files.map((file) => [file.path, file]));
  const manifest = parseFireRedPackManifest(JSON.parse(byPath.get('manifest.json')!.bytes));

  it('stamps the deterministic pinned builtAt, never a wall clock', () => {
    expect(manifest.builtAt).toBe(PINNED);
  });

  it('emits a schema-valid v2 manifest with the exact FireRed scope', () => {
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.validation).toEqual({ valid: true, pokemonCount: 386, moveCount: 354, typeCount: 17 });
  });

  it('terminates every emitted file with a newline', () => {
    for (const file of files) expect(file.bytes.endsWith('\n')).toBe(true);
  });

  it('records each asset hash as the SHA-256 of its exact bytes', () => {
    const pokemon = byPath.get('pokemon.json')!;
    expect(manifest.files.pokemon.sha256).toBe(pokemon.sha256);
    expect(pokemon.sha256).toBe(sha256Hex(pokemon.bytes));
    expect(manifest.files.indexes['routes-by-pokemon'].sha256).toBe(byPath.get('indexes/routes-by-pokemon.json')!.sha256);
  });

  it('produces byte-identical output on a repeat build', () => {
    const again = planFireRedPackFiles(real, { builtAt: PINNED, sources });
    expect(again.map((file) => [file.path, file.bytes])).toEqual(files.map((file) => [file.path, file.bytes]));
  });

  it('content-addresses packVersion so any content change moves it', () => {
    const mutated = structuredClone(real);
    mutated.pokemon[0] = { ...mutated.pokemon[0], captureRate: mutated.pokemon[0].captureRate + 1 };
    const mutatedManifest = parseFireRedPackManifest(
      JSON.parse(planFireRedPackFiles(mutated, { builtAt: PINNED, sources }).find((file) => file.path === 'manifest.json')!.bytes),
    );
    expect(mutatedManifest.packVersion).not.toBe(manifest.packVersion);
  });

  it('never emits an opponents asset (Plan 3 is out of scope)', () => {
    expect(files.some((file) => /opponent/i.test(file.path))).toBe(false);
    expect(byPath.get('manifest.json')!.bytes).not.toMatch(/opponent/i);
    expect(Object.keys(manifest.files)).not.toContain('opponents');
  });
});

describe('buildResearchReport', () => {
  it('reports zero provisional records and the exact scope with no copied tables', () => {
    const report = buildResearchReport(real, { builtAt: PINNED, sources });
    expect(report.json.provisionalRecords).toBe(0);
    expect(report.json.scope).toMatchObject({ pokemonCount: 386, moveCount: 354, typeCount: 17, versionId: 10 });
    expect(report.markdown.endsWith('\n')).toBe(true);
    expect(report.markdown).toMatch(/provisional/i);
  });
}, 60_000);
