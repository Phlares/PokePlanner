import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
}

export function sourceCachePath(projectRoot: string, lock: SourceLock): string {
  return resolve(projectRoot, '.cache', 'sources', lock.id, lock.revision);
}

export function syncSource(
  projectRoot: string,
  lock: SourceLock,
  dependencies: SourceCacheDependencies,
): string {
  const target = sourceCachePath(projectRoot, lock);
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

  dependencies.mkdir(dirname(target));
  dependencies.mkdir(target);
  dependencies.runGit(target, ['init']);
  dependencies.runGit(target, ['remote', 'add', 'origin', lock.repository]);
  dependencies.runGit(target, ['fetch', '--depth', '1', 'origin', lock.revision]);
  dependencies.runGit(target, ['checkout', '--detach', 'FETCH_HEAD']);
  verifyHead();
  return target;
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
}

const dependencies: SourceCacheDependencies = {
  runGit,
  exists: existsSync,
  mkdir: (path) => mkdirSync(path, { recursive: true }),
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const projectRoot = resolve(process.cwd());
  for (const source of sourceFile.sources) syncSource(projectRoot, source, dependencies);
}
