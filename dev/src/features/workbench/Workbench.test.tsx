import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Workbench } from './Workbench';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import {
  createStandardPlaythrough,
  parsePlaythrough,
  type Playthrough,
  type PlaythroughPackIndex,
} from '../../domain/playthrough';
import { MILESTONE_ORDER } from '../../domain/availability';

const pack = loadFireRedPackFixture();

function packIndex(): PlaythroughPackIndex {
  const byId = new Map(pack.pokemon.map((record) => [record.id, record]));
  const milestones = new Set<string>(MILESTONE_ORDER);
  const acquisitions = new Set(pack.acquisitions.map((record) => record.id));
  return {
    hasSpecies: (id) => byId.has(id),
    legalAbilityIds: (id) => byId.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id, moveId) =>
      (pack.learnsets.find((record) => record.pokemonId === id)?.moves ?? []).some((move) => move.moveId === moveId),
    hasMilestone: (id) => milestones.has(id),
    hasAcquisition: (id) => acquisitions.has(id),
  };
}

function emptyPlaythrough(): Playthrough {
  return createStandardPlaythrough(
    { id: 'run-1', name: 'Test run', starterSpeciesId: 1, createdAt: 0, updatedAt: 0, packVersion: pack.manifest.packVersion },
    packIndex(),
  );
}

function renderWorkbench(overrides: Partial<Parameters<typeof Workbench>[0]> = {}) {
  const onPlaythroughChange = vi.fn();
  render(
    <Workbench
      pack={pack}
      playthrough={emptyPlaythrough()}
      onPlaythroughChange={onPlaythroughChange}
      now={() => 1000}
      {...overrides}
    />,
  );
  return { onPlaythroughChange };
}

afterEach(cleanup);

describe('Workbench', () => {
  it('renders the three regions and the team manifest', () => {
    renderWorkbench();
    expect(screen.getByRole('region', { name: /progression/i })).toBeVisible();
    expect(screen.getByRole('region', { name: /route detail/i })).toBeVisible();
    expect(screen.getByRole('region', { name: /inspector/i })).toBeVisible();
    expect(screen.getByRole('region', { name: /team manifest/i })).toBeVisible();
  });

  it('shows six primary and six reserve slots in the manifest', () => {
    renderWorkbench();
    const manifest = screen.getByRole('region', { name: /team manifest/i });
    expect(within(manifest).getAllByRole('listitem')).toHaveLength(12);
  });

  it('selects a route into the table region without touching saved state', () => {
    const { onPlaythroughChange } = renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: 'Route 22' }));
    const table = screen.getByRole('region', { name: /route detail/i });
    expect(within(table).getByText(/Route 22/i)).toBeVisible();
    expect(onPlaythroughChange).not.toHaveBeenCalled();
  });

  it('emits a validated playthrough when the current milestone is set', () => {
    const { onPlaythroughChange } = renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: /Set current milestone.*Brock/i }));
    expect(onPlaythroughChange).toHaveBeenCalledTimes(1);
    const next = onPlaythroughChange.mock.calls[0][0];
    expect(next.currentMilestoneId).toBe('brock-gym');
    expect(next.previewMilestoneId).toBeNull();
    expect(() => parsePlaythrough(next, packIndex())).not.toThrow();
  });

  it('previews a milestone without moving the saved current milestone', () => {
    const { onPlaythroughChange } = renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: /Preview milestone.*Brock/i }));
    const next = onPlaythroughChange.mock.calls[0][0];
    expect(next.previewMilestoneId).toBe('brock-gym');
    expect(next.currentMilestoneId).toBeNull();
  });

  it('hides the progression rail and shows only the matches when a search query is active', async () => {
    renderWorkbench();
    // The rail is present before any query.
    expect(screen.getByRole('button', { name: 'Route 22' })).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), { target: { value: 'Mankey' } });
    // Once the query resolves, the result is shown and the progression rail is gone.
    expect(await screen.findByRole('button', { name: /select Mankey/i })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Route 22' })).toBeNull());
  });

  it('restores the progression rail when the search query is cleared', async () => {
    renderWorkbench();
    const box = screen.getByRole('searchbox', { name: /search/i });
    fireEvent.change(box, { target: { value: 'Mankey' } });
    await screen.findByRole('button', { name: /select Mankey/i });
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Route 22' })).toBeNull());
    fireEvent.change(box, { target: { value: '' } });
    expect(await screen.findByRole('button', { name: 'Route 22' })).toBeVisible();
  });

  it('never surfaces opponent or exposure analysis in the workbench shell', () => {
    renderWorkbench({ playthrough: { ...emptyPlaythrough(), currentMilestoneId: 'brock-gym' } });
    expect(screen.queryByText(/exposure/i)).toBeNull();
    expect(screen.queryByText(/opponent/i)).toBeNull();
    expect(screen.queryByText(/super.?effective/i)).toBeNull();
  });
});
