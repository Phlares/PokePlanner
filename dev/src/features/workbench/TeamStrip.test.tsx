import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamStrip, type TeamStripProps, type TeamStripSlot } from './TeamStrip';

/**
 * Two filled slots at positions 2 and 4 — neither the first slot nor every slot — so an assertion
 * about which member a click emits cannot pass by hitting the only, or the first, candidate.
 */
const SLOTS: readonly TeamStripSlot[] = [
  { memberId: null, name: null, level: null },
  { memberId: 'member-charmeleon', name: 'Charmeleon', level: 18 },
  { memberId: null, name: null, level: null },
  { memberId: 'member-pidgey', name: 'Pidgey', level: 12 },
  { memberId: null, name: null, level: null },
  { memberId: null, name: null, level: null },
];

function renderStrip(overrides: Partial<TeamStripProps> = {}) {
  const onSelectMember = vi.fn();
  const onOpenTimeline = vi.fn();
  const view = render(
    <TeamStrip
      targetName="Brock"
      targetLevel={14}
      slots={SLOTS}
      reserveCount={2}
      findingCount={3}
      levelPolicyLabel="Manual levels"
      selectedMemberId={null}
      onSelectMember={onSelectMember}
      onOpenTimeline={onOpenTimeline}
      {...overrides}
    />,
  );
  return { onSelectMember, onOpenTimeline, ...view };
}

afterEach(cleanup);

describe('TeamStrip', () => {
  it('lays out six numbered slots and names the filled ones', () => {
    renderStrip();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Party slot 2: Charmeleon, level 18' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Party slot 4: Pidgey, level 12' })).toBeVisible();
    expect(screen.getAllByText('Empty')).toHaveLength(4);
  });

  it('leaves empty slots without a selection control', () => {
    renderStrip();
    expect(screen.queryByRole('button', { name: /Party slot 1/ })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Party slot/ })).toHaveLength(2);
  });

  it('emits the member of the clicked slot rather than the first filled one', () => {
    const { onSelectMember } = renderStrip();
    fireEvent.click(screen.getByRole('button', { name: 'Party slot 4: Pidgey, level 12' }));
    expect(onSelectMember).toHaveBeenCalledTimes(1);
    expect(onSelectMember).toHaveBeenCalledWith('member-pidgey');
  });

  it('marks only the selected slot, and marks it without colour alone', () => {
    renderStrip({ selectedMemberId: 'member-pidgey' });
    const selected = screen.getByRole('button', { name: 'Party slot 4: Pidgey, level 12' });
    const other = screen.getByRole('button', { name: 'Party slot 2: Charmeleon, level 18' });
    expect(selected).toHaveAttribute('aria-pressed', 'true');
    expect(selected).toHaveAttribute('data-selected', 'true');
    expect(other).toHaveAttribute('aria-pressed', 'false');
    expect(other).not.toHaveAttribute('data-selected');
  });

  it('emits selection only and offers no team mutation', () => {
    renderStrip({ selectedMemberId: 'member-pidgey' });
    expect(screen.queryByRole('button', { name: /edit|release|reserve|compare|remove/i })).toBeNull();
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('names the planning target it is showing the team at', () => {
    renderStrip();
    expect(screen.getByText('Brock · Target Lv 14')).toBeVisible();
  });

  it('summarises the reserve, the findings and the level policy', () => {
    renderStrip();
    expect(screen.getByText('Reserve 2 · Findings 3 · Manual levels')).toBeVisible();
  });

  it('reads its summary numbers from the run rather than from constants', () => {
    renderStrip({ reserveCount: 0, findingCount: 5, levelPolicyLabel: 'Auto match' });
    expect(screen.getByText('Reserve 0 · Findings 5 · Auto match')).toBeVisible();
  });

  it('opens the timeline from a real button', () => {
    const { onOpenTimeline } = renderStrip();
    fireEvent.click(screen.getByRole('button', { name: 'Open timeline' }));
    expect(onOpenTimeline).toHaveBeenCalledTimes(1);
  });
});
