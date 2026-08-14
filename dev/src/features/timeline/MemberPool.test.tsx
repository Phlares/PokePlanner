import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('confirms restoration, retains its permanent warning and restores trigger focus', () => {
    const node = resolved(0, 1);
    const memberId = node.released[0];
    const members = {
      'mankey-1': member('mankey-1', 56),
      [memberId]: { ...member(memberId, 56), speciesSequence: 2 },
    };
    const onRequestRestore = vi.fn();
    render(
      <MemberPool
        kind="released"
        memberIds={node.released}
        members={members}
        snapshots={node.snapshots}
        speciesName={() => 'Mankey'}
        onRequestRestore={onRequestRestore}
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Restore Mankey #2' });
    fireEvent.click(trigger);
    expect(onRequestRestore).not.toHaveBeenCalled();
    const confirmation = screen.getByRole('alertdialog', { name: 'Restore Mankey #2?' });
    expect(within(confirmation).getByText(/permanent restored warning/i)).toBeVisible();
    expect(within(confirmation).getByRole('button', { name: 'Cancel restore' })).toHaveFocus();
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm restore' }));

    expect(onRequestRestore).toHaveBeenCalledWith(memberId);
    expect(screen.getByText('Restored Pokémon')).toBeVisible();
    expect(trigger).toHaveFocus();
  });

  it('collapses and restores a member pool from a visible keyboard button', () => {
    const node = resolved(2, 0);
    const members = Object.fromEntries(node.reserve.map((id, index) => [id, member(id, index + 1)]));
    render(
      <MemberPool kind="reserve" memberIds={node.reserve} members={members} snapshots={node.snapshots} speciesName={(id) => `Pokemon ${id}`} />,
    );

    const toggle = screen.getByRole('button', { name: 'Toggle Reserve pool' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByRole('list')).toBeVisible();
  });
});
