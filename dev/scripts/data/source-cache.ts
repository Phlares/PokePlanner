import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import sourceFile from '../../data/sources.lock.json';

export interface SourceLock {
  id: string;
  repository: string;
  revision: string;
  license: string | null;
}

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
  validateSourceLock(lock);
  const cacheRoot = resolve(projectRoot, '.cache', 'sources');
  const target = resolve(cacheRoot, lock.id, lock.revision);
  assertWithinCacheRoot(cacheRoot, target);
  return target;
}

export function syncSource(
  projectRoot: string,
  lock: SourceLock,
  dependencies: SourceCacheDependencies,
): string {
  const target = sourceCachePath(projectRoot, lock);
  const cacheRoot = resolve(projectRoot, '.cache', 'sources');
  const verifyHead = () => {
    const head = dependencies.runGit(target, ['rev-parse', 'HEAD']);
    if (typeof head !== 'string' || head.trim() !== lock.revision) {
      throw new Error(`Source revision mismatch: expected ${lock.revision}, received ${String(head).trim()}`);
    }
  };

  if (dependencies.exists(join(target, '.git'))) {
    verifyHead();
    return target;
  }

  const temporaryTarget = dependencies.temporaryTarget(target);
  assertTemporarySibling(target, temporaryTarget, cacheRoot);
  try {
    dependencies.mkdir(dirname(temporaryTarget));
    dependencies.mkdir(temporaryTarget);
    dependencies.runGit(temporaryTarget, ['init']);
    dependencies.runGit(temporaryTarget, ['remote', 'add', 'origin', lock.repository]);
    dependencies.runGit(temporaryTarget, ['fetch', '--depth', '1', 'origin', lock.revision]);
    dependencies.runGit(temporaryTarget, ['checkout', '--detach', 'FETCH_HEAD']);
    const head = dependencies.runGit(temporaryTarget, ['rev-parse', 'HEAD']);
    if (typeof head !== 'string' || head.trim() !== lock.revision) {
      throw new Error(`Source revision mismatch: expected ${lock.revision}, received ${String(head).trim()}`);
    }
    dependencies.rename(temporaryTarget, target);
  } catch (error) {
    if (dependencies.exists(temporaryTarget)) dependencies.remove(temporaryTarget);
    throw error;
  }
  return target;
}

const SOURCE_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
const REVISION_PATTERN = /^[0-9a-f]{40}$/i;

function validateSourceLock(lock: SourceLock): void {
  if (!SOURCE_ID_PATTERN.test(lock.id)) throw new Error(`Invalid source ID: ${lock.id}`);
  if (!REVISION_PATTERN.test(lock.revision)) throw new Error(`Invalid source revision: ${lock.revision}`);
  let repository: URL;
  try {
    repository = new URL(lock.repository);
  } catch {
    throw new Error(`Invalid source repository: ${lock.repository}`);
  }
  if (repository.protocol !== 'https:' || repository.username || repository.password || !repository.hostname) {
    throw new Error(`Invalid source repository: ${lock.repository}`);
  }
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
  for (const source of sourceFile.sources) syncSource(projectRoot, source, dependencies);
}
