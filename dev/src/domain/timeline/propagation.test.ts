import { describe, expect, it } from 'vitest';
import { editAbility, replaceSlotEdit } from './commands';
import { applyPropagation, previewPropagation } from './propagation';
import type { MemberSnapshot, PersistentMember, TimelineKeyframe, TimelineState } from './model';

const order = ['misty-gym', 'erika-gym', 'koga-gym'] as const;

function member(id: string, acquiredAtNodeId = 'misty-gym'): PersistentMember {
  return {
    id,
    originalSpeciesId: 56,
    speciesSequence: 1,
    nickname: null,
    natureId: null,
    origin: { type: 'inferred', acquisitionId: null, note: null },
    acquiredAtNodeId,
    notes: '',
    lifecycle: [],
  };
}

function snapshot(overrides: Partial<MemberSnapshot> = {}): MemberSnapshot {
  return {
    speciesId: 56,
    level: 20,
    abilityId: 61,
    moves: [{ moveId: 10, status: 'available-now', level: null, milestoneId: null }],
    heldItemId: null,
    placement: 'party',
    partySlot: 0,
    review: { moves: false, heldItem: false },
    ...overrides,
  };
}

function frame(
  nodeId: string,
  partyMemberId: string,
  snapshots: Record<string, MemberSnapshot>,
  kind: TimelineKeyframe['kind'] = 'major',
): TimelineKeyframe {
  return {
    nodeId,
    kind,
    party: [partyMemberId, null, null, null, null, null],
    reserve: [],
    released: [],
    snapshots,
  };
}

function timelineWithReplacementBoundary(): TimelineState {
  return {
    members: {
      old: member('old'),
      pikachu: member('pikachu'),
      protected: member('protected'),
    },
    keyframes: {
      'misty-gym': {
        ...frame('misty-gym', 'old', {
          old: snapshot(),
          pikachu: snapshot({ speciesId: 25, placement: 'reserve', partySlot: null }),
        }),
        reserve: ['pikachu'],
      },
      'erika-gym': frame('erika-gym', 'old', { old: snapshot({ level: 31 }) }),
    },
    overrides: {
      'koga-gym': frame('koga-gym', 'protected', { protected: snapshot({ speciesId: 19 }) }, 'override'),
    },
    preferences: { levelMode: 'manual', autoEvolveLevel: false },
  };
}

describe('scoped timeline propagation', () => {
  it('stops forward slot replacement at a later explicit slot override', () => {
    const timeline = timelineWithReplacementBoundary();

    const preview = previewPropagation(timeline, replaceSlotEdit('misty-gym', 0, 'pikachu'), 'forward', order);

    expect(preview.targetNodeIds).toEqual(['misty-gym', 'erika-gym']);
    expect(preview.protectedNodeIds).toEqual(['koga-gym']);
    expect(preview.skippedNodeIds).toEqual([]);
    expect(preview.conflictNodeIds).toEqual([]);
  });

  it('moves each displaced slot occupant to reserve without changing its independent level', () => {
    const timeline = timelineWithReplacementBoundary();
    const edit = replaceSlotEdit('misty-gym', 0, 'pikachu');
    const preview = previewPropagation(timeline, edit, 'forward', order);

    const next = applyPropagation(timeline, edit, 'forward', order, preview);

    expect(next.keyframes['misty-gym'].party[0]).toBe('pikachu');
    expect(next.keyframes['misty-gym'].reserve).toEqual(['old']);
    expect(next.keyframes['erika-gym'].snapshots.pikachu.level).toBe(31);
    expect(next.keyframes['erika-gym'].snapshots.old).toMatchObject({ placement: 'reserve', partySlot: null, level: 31 });
    expect(next.overrides['koga-gym'].party[0]).toBe('protected');
    expect(timeline.keyframes['misty-gym'].party[0]).toBe('old');
  });

  it('changes only the selected field for change-all', () => {
    const timeline = timelineWithReplacementBoundary();
    const originalMoves = timeline.keyframes['erika-gym'].snapshots.old.moves;
    const edit = editAbility('old', 72);
    const preview = previewPropagation(timeline, edit, 'all-populated', order);

    const next = applyPropagation(timeline, edit, 'all-populated', order, preview);

    expect(next.keyframes['misty-gym'].snapshots.old.abilityId).toBe(72);
    expect(next.keyframes['erika-gym'].snapshots.old.moves).toEqual(originalMoves);
    expect(next.keyframes['erika-gym'].snapshots.old.level).toBe(31);
    expect(next.overrides['koga-gym'].snapshots.protected.abilityId).toBe(61);
    expect(preview.skippedNodeIds).toEqual(['koga-gym']);
  });

  it('only affects the selected populated node for the here scope', () => {
    const timeline = timelineWithReplacementBoundary();
    const edit = editAbility('old', 72, 'misty-gym');
    const preview = previewPropagation(timeline, edit, 'here', order);

    const next = applyPropagation(timeline, edit, 'here', order, preview);

    expect(preview.targetNodeIds).toEqual(['misty-gym']);
    expect(next.keyframes['misty-gym'].snapshots.old.abilityId).toBe(72);
    expect(next.keyframes['erika-gym'].snapshots.old.abilityId).toBe(61);
  });

  it('rejects an apply confirmation after the previewed timeline changes', () => {
    const timeline = timelineWithReplacementBoundary();
    const edit = editAbility('old', 72);
    const preview = previewPropagation(timeline, edit, 'all-populated', order);
    const changed = {
      ...timeline,
      keyframes: {
        ...timeline.keyframes,
        'erika-gym': {
          ...timeline.keyframes['erika-gym'],
          snapshots: {
            ...timeline.keyframes['erika-gym'].snapshots,
            old: { ...timeline.keyframes['erika-gym'].snapshots.old, level: 32 },
          },
        },
      },
    };

    expect(() => applyPropagation(changed, edit, 'all-populated', order, preview)).toThrow(/stale/i);
  });

  it('reports nodes before the replacement identity acquisition as conflicts', () => {
    const timeline: TimelineState = {
      ...timelineWithReplacementBoundary(),
      members: {
        old: member('old'),
        late: member('late', 'koga-gym'),
      },
      keyframes: {
        'misty-gym': frame('misty-gym', 'old', { old: snapshot() }),
        'erika-gym': frame('erika-gym', 'old', { old: snapshot({ level: 31 }) }),
        'koga-gym': {
          ...frame('koga-gym', 'old', {
            old: snapshot({ level: 40 }),
            late: snapshot({ speciesId: 25, level: 40, placement: 'reserve', partySlot: null }),
          }),
          reserve: ['late'],
        },
      },
      overrides: {},
    };

    const preview = previewPropagation(timeline, replaceSlotEdit('misty-gym', 0, 'late'), 'forward', order);

    expect(preview.conflictNodeIds).toEqual(['misty-gym', 'erika-gym']);
    expect(preview.targetNodeIds).toEqual(['koga-gym']);
  });

  it('allows a replacement after an acquisition node without its own keyframe', () => {
    const timeline: TimelineState = {
      ...timelineWithReplacementBoundary(),
      members: {
        old: member('old'),
        late: member('late', 'route-22'),
      },
      keyframes: {
        'misty-gym': frame('misty-gym', 'old', { old: snapshot() }),
        'koga-gym': {
          ...frame('koga-gym', 'old', {
            old: snapshot({ level: 40 }),
            late: snapshot({ speciesId: 25, level: 40, placement: 'reserve', partySlot: null }),
          }),
          reserve: ['late'],
        },
      },
      overrides: {},
    };
    const sparseOrder = ['misty-gym', 'route-22', 'koga-gym'] as const;

    const preview = previewPropagation(timeline, replaceSlotEdit('misty-gym', 0, 'late'), 'forward', sparseOrder);

    expect(preview.targetNodeIds).toEqual(['koga-gym']);
    expect(preview.conflictNodeIds).toEqual(['misty-gym']);
  });
});
