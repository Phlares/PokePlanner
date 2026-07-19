import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FIRERED_CONTEXT } from '../../src/domain/game';
import { REQUIRED_POKEAPI_SOURCE } from './source-lock';
import {
  buildBootstrapManifest,
  serializeBootstrapManifest,
  runBootstrapPack,
  writeBootstrapPack,
  type SourceLock,
} from './write-bootstrap-pack';

const lock: SourceLock = {
  schemaVersion: 1,
  sources: [
    REQUIRED_POKEAPI_SOURCE,
    {
      id: 'alternate-locked-source',
      revision: '0123456789abcdef0123456789abcdef01234567',
      repository: 'https://example.test/data.git',
      license: 'BSD-3-Clause',
    },
  ],
};

describe('bootstrap pack generator', () => {
  it('builds its validated manifest from the supplied lock and FireRed context', () => {
    expect(buildBootstrapManifest(lock)).toEqual({
      schemaVersion: 1,
      packVersion: 'firered-bootstrap-1',
      game: FIRERED_CONTEXT,
      sources: [
        { id: REQUIRED_POKEAPI_SOURCE.id, revision: REQUIRED_POKEAPI_SOURCE.revision },
        { id: 'alternate-locked-source', revision: '0123456789abcdef0123456789abcdef01234567' },
      ],
      files: {},
    });
  });

  it('serializes deterministic indented UTF-8 JSON with exactly one terminal newline', () => {
    const serialized = serializeBootstrapManifest(buildBootstrapManifest(lock));
    expect(serialized).toBe(`${JSON.stringify(buildBootstrapManifest(lock), null, 2)}\n`);
    expect(serialized.endsWith('\n\n')).toBe(false);
    expect(Buffer.from(serialized)).toContainEqual(0xc3);
    expect(Buffer.from(serialized)).toContainEqual(0xa9);
  });

  it('writes the bootstrap manifest beneath the supplied project root', () => {
    const mkdir = vi.fn();
    const writeFile = vi.fn();
    writeBootstrapPack('C:/repo/dev', lock, { mkdir, writeFile });

    const output = resolve('C:/repo/dev', 'public/data/firered/manifest.json');
    expect(mkdir).toHaveBeenCalledWith(resolve(output, '..'), { recursive: true });
    expect(writeFile).toHaveBeenCalledWith(output, serializeBootstrapManifest(buildBootstrapManifest(lock)), 'utf8');
  });

  it('validates an invalid lock before either filesystem effect', () => {
    const mkdir = vi.fn();
    const writeFile = vi.fn();
    const invalidLock = {
      schemaVersion: 1,
      sources: [{ ...REQUIRED_POKEAPI_SOURCE, revision: 'main' }],
    };

    expect(() => writeBootstrapPack('C:/repo/dev', invalidLock, { mkdir, writeFile })).toThrow();
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects an invalid on-disk lock before writing the manifest', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'pokeplanner-bootstrap-'));
    try {
      mkdirSync(resolve(projectRoot, 'data'), { recursive: true });
      writeFileSync(resolve(projectRoot, 'data/sources.lock.json'), JSON.stringify({
        schemaVersion: 1,
        sources: [{
          id: 'pokeapi-api-data',
          repository: 'https://github.com/PokeAPI/api-data.git',
          revision: 'main',
          license: 'BSD-3-Clause',
        }],
      }), 'utf8');

      expect(() => runBootstrapPack(projectRoot)).toThrow();
      expect(existsSync(resolve(projectRoot, 'public/data/firered/manifest.json'))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
