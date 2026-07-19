import { describe, expect, it } from 'vitest';
import { FIRERED_CONTEXT } from './game';

describe('FIRERED_CONTEXT', () => {
  it('keeps version, version-group, and generation IDs distinct', () => {
    expect(FIRERED_CONTEXT).toEqual({
      id: 'firered',
      name: 'Pokémon FireRed',
      versionId: 10,
      versionGroupId: 7,
      generationId: 3,
    });
  });
});
