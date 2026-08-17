import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamManifest, type ManifestDraft } from './TeamManifest';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import { createEmptyTeam, type TeamMember, type TeamState } from '../../domain/team';

const pack = loadFireRedPackFixture();

// Mankey (56) with Vital Spirit (72): Scratch (10) now, Thrash (37) at level 46 in the future.
function mankey(overrides: Partial<TeamMember> = {}): TeamMember {
  return {
    id: 'm1',
    speciesId: 56,
    level: 12,
    abilityId: 72,
    moves: [
      { moveId: 10, status: 'available-now', level: null, milestoneId: null },
      { moveId: 37, status: 'future-level', level: 46, milestoneId: null },
    ],
    ...overrides,
  };
}

function teamWith(primary: (TeamMember | null)[]): TeamState {
  const base = createEmptyTeam();
  const slots = [...primary, ...base.primary.slice(primary.length)] as unknown as TeamState['primary'];
  return { primary: slots, reserve: base.reserve };
}

const draft: ManifestDraft = {
  speciesId: 56,
  level: 8,
  abilityId: 72,
  moves: [{ moveId: 10, status: 'available-now', level: null, milestoneId: null }],
};

function renderManifest(overrides: Partial<Parameters<typeof TeamManifest>[0]> = {}) {
  const onTeamChange = vi.fn();
  render(
    <TeamManifest
      team={createEmptyTeam()}
      pack={pack}
      draft={null}
      onTeamChange={onTeamChange}
      createId={() => 'new-id'}
      {...overrides}
    />,
  );
  return { onTeamChange };
}

afterEach(cleanup);

describe('TeamManifest', () => {
  it('always renders six primary and six reserve slots', () => {
    renderManifest();
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
  });

  it('displays planned level, ability, and four-move plan with future-move labels', () => {
    renderManifest({ team: teamWith([mankey()]) });
    expect(screen.getByText('Mankey')).toBeVisible();
    expect(screen.getByText(/Lv\.?\s*12/i)).toBeVisible();
    expect(screen.getByText('Vital Spirit')).toBeVisible();
    expect(screen.getByText('Scratch')).toBeVisible();
    const thrash = screen.getByText('Thrash').closest('.member-move') as HTMLElement;
    expect(thrash.textContent).toMatch(/Lv\.?\s*46/i);
  });

  it('adds the current draft into an empty slot', () => {
    const { onTeamChange } = renderManifest({ draft });
    fireEvent.click(screen.getByRole('button', { name: /add to primary slot 1/i }));
    expect(onTeamChange).toHaveBeenCalledTimes(1);
    const next = onTeamChange.mock.calls[0][0] as TeamState;
    expect(next.primary[0]?.speciesId).toBe(56);
    expect(next.primary[0]?.level).toBe(8);
    expect(next.primary[0]?.id).toBe('new-id');
  });

  it('replaces an occupied slot with the current draft', () => {
    const replacement: ManifestDraft = { ...draft, level: 40 };
    const { onTeamChange } = renderManifest({ team: teamWith([mankey()]), draft: replacement });
    fireEvent.click(screen.getByRole('button', { name: /replace primary slot 1/i }));
    const next = onTeamChange.mock.calls[0][0] as TeamState;
    expect(next.primary[0]?.level).toBe(40);
  });

  it('reorders members within the primary section', () => {
    const a = mankey({ id: 'm1' });
    const b = mankey({ id: 'm2' });
    const { onTeamChange } = renderManifest({ team: teamWith([a, b]) });
    fireEvent.click(screen.getByRole('button', { name: /move primary slot 1 down/i }));
    const next = onTeamChange.mock.calls[0][0] as TeamState;
    expect(next.primary[0]?.id).toBe('m2');
    expect(next.primary[1]?.id).toBe('m1');
  });

  it('moves a member between primary and reserve', () => {
    const { onTeamChange } = renderManifest({ team: teamWith([mankey()]) });
    fireEvent.click(screen.getByRole('button', { name: /send primary slot 1 to reserve/i }));
    const next = onTeamChange.mock.calls[0][0] as TeamState;
    expect(next.primary[0]).toBeNull();
    expect(next.reserve[0]?.id).toBe('m1');
  });

  it('offers slot actions as focusable buttons for keyboard operation', () => {
    renderManifest({ team: teamWith([mankey()]), draft });
    const action = screen.getByRole('button', { name: /send primary slot 1 to reserve/i });
    expect(action.tagName).toBe('BUTTON');
    action.focus();
    expect(action).toHaveFocus();
  });
});
