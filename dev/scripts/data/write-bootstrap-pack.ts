import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { FIRERED_CONTEXT } from '../../src/domain/game';
import { parseGamePackManifest, type GamePackManifest } from '../../src/data/manifest';

export type SourceLock = {
  sources: Array<{ id: string; revision: string; [key: string]: unknown }>;
};

interface BootstrapPackWriter {
  mkdir: typeof mkdirSync;
  writeFile: typeof writeFileSync;
}

export function buildBootstrapManifest(lock: SourceLock): GamePackManifest {
  return parseGamePackManifest({
    schemaVersion: 1,
    packVersion: 'firered-bootstrap-1',
    game: FIRERED_CONTEXT,
    sources: lock.sources.map(({ id, revision }) => ({ id, revision })),
    files: {},
  });
}

export function serializeBootstrapManifest(manifest: GamePackManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function writeBootstrapPack(
  projectRoot: string,
  lock: SourceLock,
  { mkdir, writeFile }: BootstrapPackWriter = { mkdir: mkdirSync, writeFile: writeFileSync },
): void {
  const output = resolve(projectRoot, 'public/data/firered/manifest.json');
  mkdir(dirname(output), { recursive: true });
  writeFile(output, serializeBootstrapManifest(buildBootstrapManifest(lock)), 'utf8');
}

export function runBootstrapPack(projectRoot = process.cwd()): void {
  const lock = JSON.parse(readFileSync(resolve(projectRoot, 'data/sources.lock.json'), 'utf8')) as SourceLock;
  writeBootstrapPack(projectRoot, lock);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runBootstrapPack();
}
