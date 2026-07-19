import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sourceFile from '../../data/sources.lock.json';
import {
  parseSourceLock,
  parseSourceLockEntry,
  type SourceLockEntry,
} from './source-lock';

export type SourceLock = SourceLockEntry;

export type GitRunner = (cwd: string, args: string[]) => string | void;

export interface SourceCacheDependencies {
  runGit: GitRunner;
  exists: (path: string) => boolean;
  mkdir: (path: string) => void;
  temporaryTarget: (target: string) => string;
  rename: (from: string, to: string) => void;
  remove: (path: string) => void;
}

export function sourceCachePath(projectRoot: string, lock: SourceLock): string {
  const source = parseSourceLockEntry(lock);
  const cacheRoot = resolve(projectRoot, '.cache', 'sources');
  const target = resolve(cacheRoot, source.id, source.revision);
  assertWithinCacheRoot(cacheRoot, target);
  return target;
}

export function syncSource(
  projectRoot: string,
  lock: SourceLock,
  dependencies: SourceCacheDependencies,
): string {
  const source = parseSourceLockEntry(lock);
  const target = sourceCachePath(projectRoot, source);
  const cacheRoot = resolve(projectRoot, '.cache', 'sources');
  const verifyCheckoutIntegrity = (checkout: string) => {
    const head = dependencies.runGit(checkout, ['rev-parse', 'HEAD']);
    if (typeof head !== 'string' || head.trim() !== source.revision) {
      throw new Error(
        `Source cache integrity failure: Source revision mismatch: expected ${source.revision}, received ${String(head).trim()}`,
      );
    }
    const status = dependencies.runGit(checkout, ['status', '--porcelain=v1', '--untracked-files=all']);
    if (typeof status !== 'string' || status !== '') {
      throw new Error('Source cache integrity failure: source working tree is not clean');
    }
  };

  if (dependencies.exists(join(target, '.git'))) {
    verifyCheckoutIntegrity(target);
    return target;
  }

  const temporaryTarget = dependencies.temporaryTarget(target);
  assertTemporarySibling(target, temporaryTarget, cacheRoot);
  try {
    dependencies.mkdir(dirname(temporaryTarget));
    dependencies.mkdir(temporaryTarget);
    dependencies.runGit(temporaryTarget, ['init']);
    dependencies.runGit(temporaryTarget, ['remote', 'add', 'origin', source.repository]);
    dependencies.runGit(temporaryTarget, ['fetch', '--depth', '1', 'origin', source.revision]);
    dependencies.runGit(temporaryTarget, ['checkout', '--detach', 'FETCH_HEAD']);
    verifyCheckoutIntegrity(temporaryTarget);
    dependencies.rename(temporaryTarget, target);
  } catch (error) {
    if (dependencies.exists(temporaryTarget)) dependencies.remove(temporaryTarget);
    throw error;
  }
  return target;
}

function assertWithinCacheRoot(cacheRoot: string, target: string): void {
  const pathFromRoot = relative(cacheRoot, target);
  if (pathFromRoot === '' || pathFromRoot === '..' || pathFromRoot.startsWith(`..${sep}`)) {
    throw new Error(`Unsafe source cache path: ${target}`);
  }
}

function assertTemporarySibling(target: string, temporaryTarget: string, cacheRoot: string): void {
  assertWithinCacheRoot(cacheRoot, temporaryTarget);
  if (dirname(temporaryTarget) !== dirname(target) || !basename(temporaryTarget).startsWith(`${basename(target)}.partial-`)) {
    throw new Error(`Unsafe temporary source cache path: ${temporaryTarget}`);
  }
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

const dependencies: SourceCacheDependencies = {
  runGit,
  exists: existsSync,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
  temporaryTarget: (target) => `${target}.partial-${randomUUID()}`,
  rename: renameSync,
  remove: (path) => rmSync(path, { recursive: true, force: true }),
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const projectRoot = resolve(process.cwd());
  for (const source of parseSourceLock(sourceFile).sources) syncSource(projectRoot, source, dependencies);
}
