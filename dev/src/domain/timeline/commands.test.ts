import { describe, expect, it } from 'vitest';
import {
  acquireMember,
  editMemberSnapshot,
  moveToReserve,
  placeInParty,
  releaseMember,
  restoreMember,
} from './commands';
import { createEmptyTimeline, type MemberAcquisition, type TimelinePackView, type TimelineState } from './model';

const view: TimelinePackView = {
  hasSpecies: (id) => id === 56,
  legalAbilityIds: () => [72],
  isVersionValidMove: (_speciesId, moveId) => moveId === 10,
  hasNode: (id) => new Set(['starter-selection', 'misty-gym']).has(id),
  hasMilestone: (id) => id === 'misty-gym',
  hasAcquisition: (id) => id === 'gift-mankey',
};

function acquisition(overrides: Partial<MemberAcquisition> = {}): MemberAcquisition {
  return {
    memberId: 'm1', speciesId: 56, nodeId: 'starter-selection', abilityId: 72, level: 5,
    moves: [{ moveId: 10, status: 'available-now', level: null, milestoneId: null }],
    heldItemId: null, origin: { type: 'inferred', acquisitionId: 'gift-mankey', note: null },
    nickname: null, natureId: null, notes: '',
    ...overrides,
  };
}

function stateWithParty(memberId: string): TimelineState {
  const acquired = acquireMember(createEmptyTimeline(), acquisition({ memberId }), view);
  return placeInParty(acquired, 'misty-gym', memberId, 0, view);
}

describe('timeline lifecycle commands', () => {
  it('numbers duplicate acquisitions independently', () => {
    const one = acquireMember(createEmptyTimeline(), acquisition({ memberId: 'm1' }), view);
    const two = acquireMember(one, acquisition({ memberId: 'm2' }), view);

    expect(two.members.m2.speciesSequence).toBe(2);
    expect(one.members).not.toHaveProperty('m2');
  });

  it('moves replaced party members to reserve', () => {
    const withOld = stateWithParty('old');
    const state = acquireMember(withOld, acquisition({ memberId: 'new', nodeId: 'misty-gym' }), view);
    const next = placeInParty(state, 'misty-gym', 'new', 0, view);

    expect(next.keyframes['misty-gym'].party[0]).toBe('new');
    expect(next.keyframes['misty-gym'].reserve).toContain('old');
    expect(next.keyframes['misty-gym'].snapshots.old.placement).toBe('reserve');
  });

  it('moves a member to reserve without retaining its party placement', () => {
    const next = moveToReserve(stateWithParty('m1'), 'misty-gym', 'm1', view);

    expect(next.keyframes['misty-gym'].party).not.toContain('m1');
    expect(next.keyframes['misty-gym'].reserve).toEqual(['m1']);
    expect(next.members.m1.lifecycle.at(-1)).toMatchObject({ type: 'moved-reserve', from: 'party', to: 'reserve' });
  });

  it('records release node and reason before moving the member to the archive', () => {
    const next = releaseMember(stateWithParty('m1'), 'misty-gym', 'm1', 'permadeath', view);

    expect(next.keyframes['misty-gym'].released).toEqual(['m1']);
    expect(next.keyframes['misty-gym'].snapshots.m1.placement).toBe('released');
    expect(next.members.m1.lifecycle.at(-1)).toEqual({
      type: 'released', nodeId: 'misty-gym', from: 'party', to: 'released', reason: 'permadeath',
    });
  });

  it('restores the same identity and records a permanent audit event', () => {
    const released = releaseMember(stateWithParty('m1'), 'misty-gym', 'm1', 'permadeath', view);
    const restored = restoreMember(released, 'misty-gym', 'm1', view);

    expect(restored.keyframes['misty-gym'].reserve).toContain('m1');
    expect(restored.members.m1.lifecycle.at(-1)?.type).toBe('restored');
    expect(restored.members.m1.lifecycle.some((event) => event.type === 'released')).toBe(true);
  });

  it('requires restoration before a released member can return to party', () => {
    const released = releaseMember(stateWithParty('m1'), 'misty-gym', 'm1', 'permadeath', view);

    expect(() => placeInParty(released, 'misty-gym', 'm1', 0, view)).toThrow(/restore/i);
  });

  it('requires restoration before a released member can move to reserve', () => {
    const released = releaseMember(stateWithParty('m1'), 'misty-gym', 'm1', 'permadeath', view);

    expect(() => moveToReserve(released, 'misty-gym', 'm1', view)).toThrow(/restore/i);
  });

  it('rejects releasing an already released member', () => {
    const released = releaseMember(stateWithParty('m1'), 'misty-gym', 'm1', 'permadeath', view);

    expect(() => releaseMember(released, 'misty-gym', 'm1', 'again', view)).toThrow(/already released/i);
  });

  it('moves a party member between slots without duplicating its placement', () => {
    const state = stateWithParty('m1');
    const next = placeInParty(state, 'misty-gym', 'm1', 1, view);

    expect(next.keyframes['misty-gym'].party).toEqual([null, 'm1', null, null, null, null]);
    expect(next.keyframes['misty-gym'].reserve).not.toContain('m1');
  });

  it('rejects a party slot outside the fixed six-slot party', () => {
    expect(() => placeInParty(stateWithParty('m1'), 'misty-gym', 'm1', 6 as never, view)).toThrow(/party slot/i);
  });

  it('edits a snapshot without mutating its original state', () => {
    const state = stateWithParty('m1');
    const next = editMemberSnapshot(state, 'misty-gym', 'm1', { level: 20 }, view);

    expect(next.keyframes['misty-gym'].snapshots.m1.level).toBe(20);
    expect(state.keyframes['misty-gym'].snapshots.m1.level).toBe(5);
  });
});
