import { describe, expect, it } from 'vitest';
import { defaultTimelinePreferences, parseTimelineState, type PersistentMember, type TimelinePackView } from './model';

const pack: TimelinePackView = {
  hasSpecies: (id) => id === 56,
  legalAbilityIds: () => [72],
  isVersionValidMove: (_speciesId, moveId) => moveId === 10,
  hasNode: (id) => new Set(['starter-selection', 'route-22', 'misty-gym']).has(id),
  hasMilestone: (id) => id === 'misty-gym',
  hasAcquisition: (id) => id === 'gift-mankey',
};

function member(overrides: Partial<PersistentMember> = {}): PersistentMember {
  return {
    id: 'm1',
    originalSpeciesId: 56,
    speciesSequence: 1,
    nickname: null,
    natureId: null,
    origin: { type: 'inferred', acquisitionId: null, note: null },
    acquiredAtNodeId: 'starter-selection',
    notes: '',
    lifecycle: [],
    ...overrides,
  };
}

function populatedState() {
  return {
    members: {
      m1: member({
        acquiredAtNodeId: 'starter-selection',
        origin: { type: 'inferred', acquisitionId: 'gift-mankey', note: null },
        lifecycle: [{ type: 'acquired' as const, nodeId: 'route-22', from: null, to: 'reserve' as const, reason: null }],
      }),
    },
    keyframes: {
      'misty-gym': {
        nodeId: 'misty-gym', kind: 'major' as const, party: ['m1', null, null, null, null, null], reserve: [], released: [],
        snapshots: {
          m1: {
            speciesId: 56, level: 20, abilityId: 72,
            moves: [{ moveId: 10, status: 'future-milestone' as const, level: null, milestoneId: 'misty-gym' }],
            heldItemId: null, placement: 'party' as const, partySlot: 0 as const, review: { moves: false, heldItem: false },
          },
        },
      },
    },
    overrides: {}, preferences: defaultTimelinePreferences(),
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

  it('rejects duplicate sequence numbers for one original species', () => {
    expect(() => parseTimelineState({
      members: {
        m1: member({ id: 'm1', speciesSequence: 1 }),
        m2: member({ id: 'm2', speciesSequence: 1 }),
      },
      keyframes: {}, overrides: {}, preferences: defaultTimelinePreferences(),
    }, pack)).toThrow(/sequence/i);
  });

  it.each([
    ['member acquisition', (state: ReturnType<typeof populatedState>) => { state.members.m1.acquiredAtNodeId = 'unknown-node'; }],
    ['lifecycle event', (state: ReturnType<typeof populatedState>) => { state.members.m1.lifecycle[0].nodeId = 'unknown-node'; }],
    ['major keyframe', (state: ReturnType<typeof populatedState>) => {
      const keyframe = state.keyframes['misty-gym'];
      const keyframes = state.keyframes as Record<string, unknown>;
      delete keyframes['misty-gym'];
      keyframes['unknown-node'] = { ...keyframe, nodeId: 'unknown-node' };
    }],
    ['override keyframe', (state: ReturnType<typeof populatedState>) => {
      const keyframe = state.keyframes['misty-gym'];
      (state.overrides as Record<string, unknown>)['unknown-node'] = { ...keyframe, nodeId: 'unknown-node', kind: 'override' };
    }],
  ])('rejects an unknown %s node reference', (_label, mutate) => {
    const state = populatedState();
    mutate(state);
    expect(() => parseTimelineState(state, pack)).toThrow(/node/i);
  });

  it('rejects an unknown origin acquisition reference', () => {
    const state = populatedState();
    state.members.m1.origin.acquisitionId = 'unknown-acquisition';
    expect(() => parseTimelineState(state, pack)).toThrow(/acquisition/i);
  });

  it('rejects an unknown future-move milestone reference', () => {
    const state = populatedState();
    state.keyframes['misty-gym'].snapshots.m1.moves[0].milestoneId = 'unknown-milestone';
    expect(() => parseTimelineState(state, pack)).toThrow(/milestone/i);
  });
});
