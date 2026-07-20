import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MoveAvailability } from './MoveAvailability';
import { loadFireRedPackFixture } from '../../test/firered-pack';

const pack = loadFireRedPackFixture();

function renderMoves(overrides: Partial<Parameters<typeof MoveAvailability>[0]> = {}) {
  const onPlanMove = vi.fn();
  const utils = render(
    <MoveAvailability
      pokemonId={56}
      pack={pack}
      context={{ currentMilestoneId: null }}
      onPlanMove={onPlanMove}
      {...overrides}
    />,
  );
  return { onPlanMove, ...utils };
}

function drawer(container: HTMLElement, group: string): HTMLDetailsElement {
  const element = container.querySelector(`details[data-group="${group}"]`);
  if (!element) throw new Error(`Expected a disclosure for group "${group}"`);
  return element as HTMLDetailsElement;
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

  it('labels a future choice when it is planned', () => {
    const { container, onPlanMove } = renderMoves();
    const group = within(drawer(container, 'future-milestone'));
    fireEvent.click(group.getByRole('button', { name: /Plan Body Slam/i }));
    expect(onPlanMove).toHaveBeenCalledTimes(1);
    const move = onPlanMove.mock.calls[0][0];
    expect(move.status).toBe('future-milestone');
    expect(move.milestoneId).toBe('champion');
    expect(group.getByText(/Planned/i)).toBeInTheDocument();
  });

  it('never surfaces simulation or expected-time math', () => {
    renderMoves();
    expect(screen.queryByText(/expected time|per hour|average time|simulat|catch odds/i)).toBeNull();
  });
});
