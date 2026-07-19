import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FIRERED_CONTEXT } from '../../src/domain/game';
import {
  buildBootstrapManifest,
  serializeBootstrapManifest,
  writeBootstrapPack,
  type SourceLock,
} from './write-bootstrap-pack';

const lock: SourceLock = {
  sources: [{
    id: 'alternate-locked-source',
    revision: '0123456789abcdef0123456789abcdef01234567',
    repository: 'https://example.test/data.git',
    license: 'BSD-3-Clause',
  }],
};

describe('bootstrap pack generator', () => {
  it('builds its validated manifest from the supplied lock and FireRed context', () => {
    expect(buildBootstrapManifest(lock)).toEqual({
      schemaVersion: 1,
      packVersion: 'firered-bootstrap-1',
      game: FIRERED_CONTEXT,
      sources: [{ id: 'alternate-locked-source', revision: '0123456789abcdef0123456789abcdef01234567' }],
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
});
