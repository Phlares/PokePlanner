import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  REQUIRED_POKEAPI_SOURCE,
  parseSourceLock,
} from './source-lock';

function foundationLock(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    sources: [{ ...REQUIRED_POKEAPI_SOURCE, ...overrides }],
  };
}

describe('source lock', () => {
  it('rejects a symbolic revision', () => {
    expect(() => parseSourceLock(foundationLock({ revision: 'main' }))).toThrow();
  });

  it('rejects non-HTTPS and credential-bearing repositories', () => {
    expect(() => parseSourceLock(foundationLock({
      repository: 'http://github.com/PokeAPI/api-data.git',
    }))).toThrow();
    expect(() => parseSourceLock(foundationLock({
      repository: 'https://user:secret@github.com/PokeAPI/api-data.git',
    }))).toThrow();
  });

  it('rejects a whitespace-wrapped repository without normalizing it', () => {
    expect(() => parseSourceLock({
      schemaVersion: 1,
      sources: [
        REQUIRED_POKEAPI_SOURCE,
        {
          id: 'additional-source',
          repository: ' https://example.test/data.git ',
          revision: '0123456789abcdef0123456789abcdef01234567',
          license: null,
        },
      ],
    })).toThrow(ZodError);
  });

  it('reports a malformed repository as a controlled Zod validation error', () => {
    expect(() => parseSourceLock({
      schemaVersion: 1,
      sources: [
        REQUIRED_POKEAPI_SOURCE,
        {
          id: 'additional-source',
          repository: 'not a URL',
          revision: '0123456789abcdef0123456789abcdef01234567',
          license: null,
        },
      ],
    })).toThrow(ZodError);
  });

  it('rejects a different PokeAPI revision', () => {
    expect(() => parseSourceLock(foundationLock({
      revision: '0123456789abcdef0123456789abcdef01234567',
    }))).toThrow(/required PokeAPI source/i);
  });

  it('rejects a different PokeAPI repository', () => {
    expect(() => parseSourceLock(foundationLock({
      repository: 'https://example.test/api-data.git',
    }))).toThrow(/required PokeAPI source/i);
  });

  it('rejects unknown lock and source properties', () => {
    expect(() => parseSourceLock({ ...foundationLock(), extra: true })).toThrow();
    expect(() => parseSourceLock(foundationLock({ extra: true }))).toThrow();
  });

  it('rejects duplicate source IDs', () => {
    expect(() => parseSourceLock({
      schemaVersion: 1,
      sources: [REQUIRED_POKEAPI_SOURCE, { ...REQUIRED_POKEAPI_SOURCE }],
    })).toThrow(/duplicate source ID/i);
  });
});
