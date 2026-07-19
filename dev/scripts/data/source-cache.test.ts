import { describe, expect, it, vi } from 'vitest';
import { sourceCachePath, syncSource, type SourceLock } from './source-cache';

const lock: SourceLock = {
  id: 'pokeapi-api-data',
  repository: 'https://github.com/PokeAPI/api-data.git',
  revision: '0fb5313cb77f46269502e987a53a0bf751ae883d',
  license: 'BSD-3-Clause',
};

describe('source cache', () => {
  it('uses source ID and revision as the immutable cache key', () => {
    expect(sourceCachePath('C:/repo/dev', lock).replaceAll('\\', '/').endsWith(
      '/.cache/sources/pokeapi-api-data/0fb5313cb77f46269502e987a53a0bf751ae883d',
    )).toBe(true);
  });

  it('fetches only the pinned revision and verifies HEAD', () => {
    const runGit = vi.fn().mockReturnValueOnce(undefined).mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined).mockReturnValueOnce(undefined).mockReturnValueOnce(lock.revision);
    const mkdir = vi.fn();
    syncSource('C:/repo/dev', lock, { runGit, exists: () => false, mkdir });
    expect(mkdir).toHaveBeenCalled();
    expect(runGit.mock.calls.map((call) => call[1])).toEqual([
      ['init'],
      ['remote', 'add', 'origin', lock.repository],
      ['fetch', '--depth', '1', 'origin', lock.revision],
      ['checkout', '--detach', 'FETCH_HEAD'],
      ['rev-parse', 'HEAD'],
    ]);
  });

  it('rejects an existing cache checked out at another revision', () => {
    const runGit = vi.fn().mockReturnValue('wrong-revision');
    expect(() => syncSource('C:/repo/dev', lock, { runGit, exists: () => true, mkdir: vi.fn() }))
      .toThrow('Source revision mismatch');
  });
});
