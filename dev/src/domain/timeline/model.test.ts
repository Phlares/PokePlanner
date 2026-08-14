import { describe, expect, it } from 'vitest';
import { defaultTimelinePreferences, parseTimelineState, type PersistentMember } from './model';
import type { MemberPackView } from '../team';

const pack: MemberPackView = {
  hasSpecies: (id) => id === 56,
  legalAbilityIds: () => [72],
  isVersionValidMove: (_speciesId, moveId) => moveId === 10,
};

function member(overrides: Partial<PersistentMember> = {}): PersistentMember {
  return {
    id: 'm1',
    originalSpeciesId: 56,
    speciesSequence: 1,
    nickname: null,
    natureId: null,
    origin: { type: 'inferred', acquisitionId: null, note: null },
    acquiredAtNodeId: 'starter',
    notes: '',
    lifecycle: [],
    ...overrides,
  };
}

describe('parseTimelineState', () => {
  it('keeps duplicate species distinct by member id and sequence', () => {
    const state = parseTimelineState({
      members: {
        m1: member({ id: 'm1', speciesSequence: 1 }),
        m2: member({ id: 'm2', speciesSequence: 2 }),
      },
      keyframes: {}, overrides: {}, preferences: defaultTimelinePreferences(),
    }, pack);

    expect(state.members.m1.speciesSequence).toBe(1);
    expect(state.members.m2.speciesSequence).toBe(2);
  });
});
