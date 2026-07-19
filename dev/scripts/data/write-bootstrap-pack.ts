import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { FIRERED_CONTEXT } from '../../src/domain/game';
import { parseGamePackManifest } from '../../src/data/manifest';

const lock = JSON.parse(readFileSync(resolve('data/sources.lock.json'), 'utf8')) as {
  sources: Array<{ id: string; revision: string }>;
};

const manifest = parseGamePackManifest({
  schemaVersion: 1,
  packVersion: 'firered-bootstrap-1',
  game: FIRERED_CONTEXT,
  sources: lock.sources.map(({ id, revision }) => ({ id, revision })),
  files: {},
});

const output = resolve('public/data/firered/manifest.json');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
