import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PersistentMember } from '../../domain/timeline/model';
import type { ResolvedTimelineNode } from '../../domain/timeline/resolver';
import { MemberPool } from './MemberPool';

function member(id: string, speciesId: number): PersistentMember {
  return {
    id,
    originalSpeciesId: speciesId,
    speciesSequence: 1,
    nickname: null,
    natureId: null,
    origin: { type: 'inferred', acquisitionId: null, note: null },
    acquiredAtNodeId: 'starter',
    notes: '',
    lifecycle: [],
  };
}

function resolved(reserveCount: number, releasedCount: number): ResolvedTimelineNode {
  const reserve = Array.from({ length: reserveCount }, (_, index) => `reserve-${index + 1}`);
  const released = Array.from({ length: releasedCount }, (_, index) => `released-${index + 1}`);
  const allIds = [...reserve, ...released];
  return {
    nodeId: 'misty-gym',
    source: 'explicit-major',
    party: [null, null, null, null, null, null],
    reserve,
    released,
    snapshots: Object.fromEntries(allIds.map((id, index) => [id, {
      speciesId: index + 1,
      level: 10,
      abilityId: 1,
      moves: [],
      heldItemId: null,
      placement: id.startsWith('reserve') ? 'reserve' : 'released',
      partySlot: null,
      review: { moves: false, heldItem: false },
    }])),
  };
}

afterEach(cleanup);

describe('MemberPool', () => {
  it('shows reserve as an unbounded pool and released as a separate archive', () => {
    const node = resolved(12, 2);
    const members = Object.fromEntries(
      [...node.reserve, ...node.released].map((id, index) => [id, member(id, index + 1)]),
    );

    const { rerender } = render(
      <MemberPool
        kind="reserve"
        memberIds={node.reserve}
        members={members}
        snapshots={node.snapshots}
        speciesName={(id) => `Pokemon ${id}`}
      />,
    );
    const reserve = screen.getByRole('region', { name: 'Reserve · 12 Pokémon' });
    expect(within(reserve).getAllByRole('listitem')).toHaveLength(12);
    expect(within(reserve).getByText('Unbounded pool')).toBeVisible();

    rerender(
      <MemberPool
        kind="released"
        memberIds={node.released}
        members={members}
        snapshots={node.snapshots}
        speciesName={(id) => `Pokemon ${id}`}
      />,
    );
    const released = screen.getByRole('region', { name: 'Released · 2 Pokémon' });
    expect(within(released).getAllByRole('listitem')).toHaveLength(2);
    expect(within(released).getByText('Historical archive')).toBeVisible();
  });
});
