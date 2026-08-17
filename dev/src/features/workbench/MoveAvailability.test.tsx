import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MoveAvailability } from './MoveAvailability';
import { loadFireRedPackFixture } from '../../test/firered-pack';

const pack = loadFireRedPackFixture();

function renderMoves(overrides: Partial<Parameters<typeof MoveAvailability>[0]> = {}) {
  return render(
    <MoveAvailability
      pokemonId={56}
      pack={pack}
      context={{ currentMilestoneId: null }}
      {...overrides}
    />,
  );
}

function drawer(container: HTMLElement, group: string): HTMLDetailsElement {
  const element = container.querySelector(`details[data-group="${group}"]`);
  if (!element) throw new Error(`Expected a disclosure for group "${group}"`);
  return element as HTMLDetailsElement;
}

/** The row for one move inside one drawer, found by the name the row heads. */
function moveRow(container: HTMLElement, group: string, name: string): HTMLElement {
  return within(drawer(container, group)).getByText(name).closest('li') as HTMLElement;
}

afterEach(cleanup);

describe('MoveAvailability', () => {
  it('renders four separate native disclosure groups', () => {
    const { container } = renderMoves();
    expect(drawer(container, 'current-level-up')).toBeInstanceOf(HTMLDetailsElement);
    expect(drawer(container, 'future-level-up')).toBeInstanceOf(HTMLDetailsElement);
    expect(drawer(container, 'machine-tutor')).toBeInstanceOf(HTMLDetailsElement);
    expect(drawer(container, 'future-milestone')).toBeInstanceOf(HTMLDetailsElement);
  });

  it('expands the current level-up group by default and collapses the future groups', () => {
    const { container } = renderMoves();
    expect(drawer(container, 'current-level-up').open).toBe(true);
    expect(drawer(container, 'future-level-up').open).toBe(false);
    expect(drawer(container, 'machine-tutor').open).toBe(false);
    expect(drawer(container, 'future-milestone').open).toBe(false);
  });

  it('places a current level-up move in the current group', () => {
    const { container } = renderMoves();
    expect(within(drawer(container, 'current-level-up')).getByText(/Scratch/)).toBeVisible();
  });

  it('shows a future level-up move with its required level as evidence', () => {
    const { container } = renderMoves();
    const group = within(drawer(container, 'future-level-up'));
    expect(group.getByText(/Karate Chop/)).toBeInTheDocument();
    expect(group.getByText(/level\s*11/i)).toBeInTheDocument();
  });

  it('places machine and tutor moves in the machine/tutor group', () => {
    const { container } = renderMoves();
    expect(within(drawer(container, 'machine-tutor')).getAllByText(/Thunderbolt/).length).toBeGreaterThan(0);
  });

  it('shows future-milestone moves with milestone, location, and prerequisite evidence', () => {
    const { container } = renderMoves();
    const group = within(drawer(container, 'future-milestone'));
    expect(group.getByText('Body Slam')).toBeInTheDocument();
    expect(group.getAllByText(/champion/i).length).toBeGreaterThan(0); // gating milestone
    expect(group.getByText('Body Slam Tutor')).toBeInTheDocument(); // location
    expect(group.getAllByText(/Four Island/).length).toBeGreaterThan(0); // reason evidence
  });

  it('states each move’s own type, not the species’ type', () => {
    const { container } = renderMoves(); // Mankey is pure Fighting
    expect(within(moveRow(container, 'current-level-up', 'Scratch')).getByText('Normal').textContent)
      .toBe('Normal');
    expect(within(moveRow(container, 'machine-tutor', 'Thunderbolt')).getByText('Electric').textContent)
      .toBe('Electric');
  });

  it('names the damage class and the stat a damaging move attacks with', () => {
    const { container } = renderMoves();
    expect(within(moveRow(container, 'future-level-up', 'Karate Chop')).getByText('Karate Chop'))
      .toHaveAccessibleDescription('Physical move · uses Attack');
    expect(within(moveRow(container, 'machine-tutor', 'Thunderbolt')).getByText('Thunderbolt'))
      .toHaveAccessibleDescription('Special move · uses Sp. Atk');
  });

  it('names no attacking stat for a move that deals no damage', () => {
    const { container } = renderMoves();
    expect(within(moveRow(container, 'current-level-up', 'Leer')).getByText('Leer'))
      .toHaveAccessibleDescription('Status move');
  });

  it('states nothing it cannot read when the pack names a move nowhere', () => {
    const { container } = renderMoves({
      pack: { ...pack, moves: pack.moves.filter((move) => move.id !== 2) },
    });
    const row = moveRow(container, 'future-level-up', 'Move #2');
    expect(within(row).getByText('Move #2')).not.toHaveAccessibleDescription();
    // Neither the type nor the class is guessed at, and nothing points at a description that is
    // not there — the row states the id it could not resolve and stops.
    expect(row.querySelectorAll('.move-entry-type, .move-entry-class')).toHaveLength(0);
    expect(row.querySelector('.move-entry-name')).not.toHaveAttribute('aria-describedby');
  });

  it('never offers to edit a member’s moves', () => {
    const { container } = renderMoves();
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(screen.queryByText('Planned')).toBeNull();
  });

  it('never surfaces simulation or expected-time math', () => {
    renderMoves();
    expect(screen.queryByText(/expected time|per hour|average time|simulat|catch odds/i)).toBeNull();
  });
});
