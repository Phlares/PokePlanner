import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseFireRedPackManifest, type FireRedPackManifest } from '../../src/domain/pack';
import { sha256Hex } from './firered/pack-writer';
import { compileFireRedPack } from './compile-firered-pack';

const projectRoot = resolve('.');
const sourceRoot = resolve('.cache/sources/pokeapi-api-data/0fb5313cb77f46269502e987a53a0bf751ae883d');

function allDescriptors(manifest: FireRedPackManifest) {
  return [
    manifest.files.pokemon, manifest.files.moves, manifest.files.learnsets, manifest.files.encounters,
    manifest.files.progression, manifest.files.acquisitions, manifest.files.evolutions, manifest.files['type-chart'],
    ...Object.values(manifest.files.indexes),
  ];
}

describe('compileFireRedPack', () => {
  let tmp: string;
  let outputRoot: string;
  let reportRoot: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'firered-pack-'));
    outputRoot = join(tmp, 'public', 'data', 'firered');
    reportRoot = join(tmp, 'research');
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  it('writes a manifest whose hashes load every emitted asset from disk', () => {
    const result = compileFireRedPack({ projectRoot, mode: 'write', sourceRoot, outputRoot, reportRoot });
    expect(result.ok).toBe(true);
    expect(result.manifest.validation).toEqual({ valid: true, pokemonCount: 386, moveCount: 354, typeCount: 17 });

    const manifest = parseFireRedPackManifest(JSON.parse(readFileSync(join(outputRoot, 'manifest.json'), 'utf8')));
    for (const descriptor of allDescriptors(manifest)) {
      const bytes = readFileSync(join(outputRoot, descriptor.path), 'utf8');
      expect(sha256Hex(bytes), `hash mismatch for ${descriptor.path}`).toBe(descriptor.sha256);
    }
  });

  it('never emits an opponents asset (Plan 3 out of scope)', () => {
    const manifest = parseFireRedPackManifest(JSON.parse(readFileSync(join(outputRoot, 'manifest.json'), 'utf8')));
    expect(Object.keys(manifest.files)).not.toContain('opponents');
    expect(() => readFileSync(join(outputRoot, 'opponents.json'))).toThrow();
  });

  it('preserves Route 22 / Mankey and the Brock milestone end-to-end', () => {
    const encounters = JSON.parse(readFileSync(join(outputRoot, 'encounters.json'), 'utf8')) as Array<{ locationAreaId: number; methods: Array<{ method: string; slots: Array<{ pokemonId: number }> }> }>;
    const route22 = encounters.find((area) => area.locationAreaId === 313);
    expect(route22?.methods.find((method) => method.method === 'walk')?.slots.some((slot) => slot.pokemonId === 56)).toBe(true);

    const progression = JSON.parse(readFileSync(join(outputRoot, 'progression.json'), 'utf8')) as { nodes: Array<{ events: Array<{ id: string; flags: { gym: boolean } }> }> };
    expect(progression.nodes.some((node) => node.events.some((event) => event.id === 'brock-gym' && event.flags.gym))).toBe(true);
  });

  it('passes check mode immediately after write and on a byte-identical repeat write', () => {
    const check = compileFireRedPack({ projectRoot, mode: 'check', sourceRoot, outputRoot, reportRoot });
    expect(check.ok).toBe(true);
    expect(check.mismatches).toEqual([]);

    const before = readFileSync(join(outputRoot, 'pokemon.json'));
    compileFireRedPack({ projectRoot, mode: 'write', sourceRoot, outputRoot, reportRoot });
    const after = readFileSync(join(outputRoot, 'pokemon.json'));
    expect(after.equals(before)).toBe(true);
  });

  it('check mode reports a single changed byte as a mismatched asset path', () => {
    const target = join(outputRoot, 'moves.json');
    const bytes = readFileSync(target);
    bytes[5] ^= 0x01;
    writeFileSync(target, bytes);

    const check = compileFireRedPack({ projectRoot, mode: 'check', sourceRoot, outputRoot, reportRoot });
    expect(check.ok).toBe(false);
    expect(check.mismatches).toEqual(['moves.json']);
  });
}, 120_000);
