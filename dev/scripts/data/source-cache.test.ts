import { win32 } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isPathWithinRoot, sourceCachePath, syncSource, type SourceLock } from './source-cache';

const lock: SourceLock = {
  id: 'pokeapi-api-data',
  repository: 'https://github.com/PokeAPI/api-data.git',
  revision: '0fb5313cb77f46269502e987a53a0bf751ae883d',
  license: 'BSD-3-Clause',
};

function withLock(overrides: Partial<SourceLock>): SourceLock {
  return { ...lock, ...overrides };
}

function promotionDependencies() {
  return {
    temporaryTarget: vi.fn((target: string) => `${target}.partial-test`),
    rename: vi.fn(),
    remove: vi.fn(),
  };
}

describe('source cache', () => {
  it('rejects Windows cross-drive targets under POSIX CI', () => {
    expect(isPathWithinRoot('C:\\repo\\dev\\.cache\\sources', 'D:\\outside\\partial', win32)).toBe(false);
  });

  it('uses source ID and revision as the immutable cache key', () => {
    expect(sourceCachePath('C:/repo/dev', lock).replaceAll('\\', '/').endsWith(
      '/.cache/sources/pokeapi-api-data/0fb5313cb77f46269502e987a53a0bf751ae883d',
    )).toBe(true);
  });

  it('rejects a traversal source ID before deriving a cache path', () => {
    expect(() => sourceCachePath('C:/repo/dev', withLock({ id: '../outside' })))
      .toThrow('Invalid source ID');
  });

  it('rejects invalid and option-like revisions before deriving a cache path', () => {
    expect(() => sourceCachePath('C:/repo/dev', withLock({ revision: 'main' })))
      .toThrow('Invalid source revision');
    expect(() => sourceCachePath('C:/repo/dev', withLock({ revision: '--upload-pack=evil' })))
      .toThrow('Invalid source revision');
  });

  it('rejects uppercase revisions before calling dependencies', () => {
    const runGit = vi.fn();
    const exists = vi.fn();
    const mkdir = vi.fn();
    const promotion = promotionDependencies();

    expect(() => syncSource('C:/repo/dev', withLock({ revision: lock.revision.toUpperCase() }), {
      runGit,
      exists,
      mkdir,
      ...promotion,
    })).toThrow('Invalid source revision');

    expect(runGit).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(promotion.temporaryTarget).not.toHaveBeenCalled();
    expect(promotion.rename).not.toHaveBeenCalled();
    expect(promotion.remove).not.toHaveBeenCalled();
  });

  it('rejects unsafe repository URLs before filesystem or Git use', () => {
    const runGit = vi.fn();
    const mkdir = vi.fn();
    expect(() => syncSource('C:/repo/dev', withLock({ repository: 'ssh://github.com/PokeAPI/api-data.git' }), {
      runGit,
      exists: vi.fn(),
      mkdir,
      ...promotionDependencies(),
    })).toThrow('Invalid source repository');
    expect(runGit).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('fetches only the pinned revision and verifies HEAD', () => {
    const runGit = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined).mockReturnValueOnce(undefined).mockReturnValueOnce(lock.revision)
      .mockReturnValueOnce('');
    const mkdir = vi.fn();
    syncSource('C:/repo/dev', lock, {
      runGit,
      exists: () => false,
      mkdir,
      ...promotionDependencies(),
    });
    expect(mkdir).toHaveBeenCalled();
    expect(runGit.mock.calls.map((call) => call[1])).toEqual([
      ['init'],
      ['remote', 'add', 'origin', lock.repository],
      ['fetch', '--depth', '1', 'origin', lock.revision],
      ['checkout', '--detach', 'FETCH_HEAD'],
      ['rev-parse', 'HEAD'],
      ['status', '--porcelain=v1', '--untracked-files=all'],
    ]);
  });

  it('rejects an existing cache checked out at another revision', () => {
    const runGit = vi.fn().mockReturnValue('wrong-revision');
    expect(() => syncSource('C:/repo/dev', lock, {
      runGit,
      exists: () => true,
      mkdir: vi.fn(),
      ...promotionDependencies(),
    }))
      .toThrow('Source revision mismatch');
  });

  it('rejects an existing cache with a tracked modification', () => {
    const runGit = vi.fn()
      .mockReturnValueOnce(lock.revision)
      .mockReturnValueOnce(' M data/api/v2/pokemon/56/index.json\n');

    expect(() => syncSource('C:/repo/dev', lock, {
      runGit,
      exists: () => true,
      mkdir: vi.fn(),
      ...promotionDependencies(),
    })).toThrow(/source (working tree|cache) integrity/i);

    expect(runGit.mock.calls.map((call) => call[1])).toEqual([
      ['rev-parse', 'HEAD'],
      ['status', '--porcelain=v1', '--untracked-files=all'],
    ]);
  });

  it('rejects an existing cache with an untracked file', () => {
    const runGit = vi.fn()
      .mockReturnValueOnce(lock.revision)
      .mockReturnValueOnce('?? local-note.txt\n');

    expect(() => syncSource('C:/repo/dev', lock, {
      runGit,
      exists: () => true,
      mkdir: vi.fn(),
      ...promotionDependencies(),
    })).toThrow(/source (working tree|cache) integrity/i);

    expect(runGit.mock.calls.map((call) => call[1])).toEqual([
      ['rev-parse', 'HEAD'],
      ['status', '--porcelain=v1', '--untracked-files=all'],
    ]);
  });

  it('accepts an existing cache at the exact pinned revision without fetching', () => {
    const runGit = vi.fn()
      .mockReturnValueOnce(lock.revision)
      .mockReturnValueOnce('');
    const target = syncSource('C:/repo/dev', lock, {
      runGit,
      exists: () => true,
      mkdir: vi.fn(),
      ...promotionDependencies(),
    });
    expect(target).toBe(sourceCachePath('C:/repo/dev', lock));
    expect(runGit).toHaveBeenCalledTimes(2);
    expect(runGit).toHaveBeenCalledWith(target, ['rev-parse', 'HEAD']);
    expect(runGit).toHaveBeenCalledWith(target, ['status', '--porcelain=v1', '--untracked-files=all']);
  });

  it('rejects a temporary target outside the resolved cache root before creating it', () => {
    const mkdir = vi.fn();
    expect(() => syncSource('C:/repo/dev', lock, {
      runGit: vi.fn(),
      exists: vi.fn(),
      mkdir,
      temporaryTarget: () => 'D:/outside/partial',
      rename: vi.fn(),
      remove: vi.fn(),
    })).toThrow('Unsafe source cache path');
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('cleans a dirty temporary checkout instead of promoting it', () => {
    const target = sourceCachePath('C:/repo/dev', lock);
    const temporaryTarget = `${target}.partial-test`;
    const paths = new Set<string>();
    const remove = vi.fn((path: string) => paths.delete(path));
    const rename = vi.fn();
    const runGit = vi.fn((_cwd: string, args: string[]) => {
      if (args[0] === 'rev-parse') return lock.revision;
      if (args[0] === 'status') return '?? generated-local-file.json\n';
      return undefined;
    });

    expect(() => syncSource('C:/repo/dev', lock, {
      runGit,
      exists: (path) => paths.has(path),
      mkdir: (path) => { paths.add(path); },
      temporaryTarget: () => temporaryTarget,
      rename,
      remove,
    })).toThrow(/source cache integrity/i);

    expect(remove).toHaveBeenCalledWith(temporaryTarget);
    expect(rename).not.toHaveBeenCalled();
  });

  it('cleans a failed temporary checkout and allows a later retry', () => {
    const target = sourceCachePath('C:/repo/dev', lock);
    const temporaryTarget = `${target}.partial-test`;
    const paths = new Set<string>();
    const mkdir = vi.fn((path: string) => paths.add(path));
    const remove = vi.fn((path: string) => paths.delete(path));
    const rename = vi.fn((from: string, to: string) => {
      paths.delete(from);
      paths.add(to);
    });
    const failingGit = vi.fn((_cwd: string, args: string[]) => {
      if (args[0] === 'fetch') throw new Error('network interrupted');
      return undefined;
    });
    const dependencies = {
      runGit: failingGit,
      exists: (path: string) => paths.has(path),
      mkdir,
      temporaryTarget: () => temporaryTarget,
      rename,
      remove,
    };

    expect(() => syncSource('C:/repo/dev', lock, dependencies)).toThrow('network interrupted');
    expect(mkdir).not.toHaveBeenCalledWith(target);
    expect(remove).toHaveBeenCalledWith(temporaryTarget);

    const retryGit = vi.fn((_cwd: string, args: string[]) => (
      args[0] === 'rev-parse' ? lock.revision : ''
    ));
    expect(() => syncSource('C:/repo/dev', lock, { ...dependencies, runGit: retryGit })).not.toThrow();
    expect(rename).toHaveBeenCalledWith(temporaryTarget, target);
  });
});
