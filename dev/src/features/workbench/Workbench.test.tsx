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
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';

const pack = loadFireRedPackFixture();

function packIndex(): PlaythroughPackIndex {
  const byId = new Map(pack.pokemon.map((record) => [record.id, record]));
  const milestones = new Set<string>([
    ...MILESTONE_ORDER,
    ...FIRE_RED_RULES.milestones.map((milestone) => milestone.id),
  ]);
  const acquisitions = new Set(pack.acquisitions.map((record) => record.id));
  return {
    hasSpecies: (id) => byId.has(id),
    legalAbilityIds: (id) => byId.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id, moveId) =>
      (pack.learnsets.find((record) => record.pokemonId === id)?.moves ?? []).some((move) => move.moveId === moveId),
    hasMilestone: (id) => milestones.has(id),
    hasAcquisition: (id) => acquisitions.has(id),
    hasNode: (id) => id === 'starter-selection' || milestones.has(id),
    starterNodeId: () => 'starter-selection',
  };
}

function emptyPlaythrough(): Playthrough {
  return createStandardPlaythrough(
    { id: 'run-1', name: 'Test run', starterSpeciesId: 1, createdAt: 0, updatedAt: 0, packVersion: pack.manifest.packVersion },
    packIndex(),
  );
}

function starterPlaythrough(placement: 'party' | 'released' = 'party'): Playthrough {
  const starter = pack.pokemon.find((record) => record.id === 1)!;
  const base = emptyPlaythrough();
  return parsePlaythrough({
    ...base,
    currentMilestoneId: 'starter',
    previewMilestoneId: 'brock-gym',
    timeline: {
      members: {
        starter: {
          id: 'starter', originalSpeciesId: 1, speciesSequence: 1, nickname: null, natureId: null,
          origin: { type: 'inferred', acquisitionId: null, note: null }, acquiredAtNodeId: 'starter', notes: '', lifecycle: [],
        },
      },
      keyframes: {
        starter: {
          nodeId: 'starter', kind: 'major',
          party: placement === 'party' ? ['starter', null, null, null, null, null] : [null, null, null, null, null, null],
          reserve: [], released: placement === 'released' ? ['starter'] : [],
          snapshots: {
            starter: {
              speciesId: 1, level: 5, abilityId: starter.abilities[0].id, moves: [], heldItemId: null,
              placement, partySlot: placement === 'party' ? 0 : null, review: { moves: false, heldItem: false },
            },
          },
        },
      },
      overrides: {},
      preferences: { levelMode: 'manual', autoEvolveLevel: false },
    },
  }, packIndex());
}

function restoredStarterPlaythrough(): Playthrough {
  const run = starterPlaythrough();
  run.timeline.members.starter.lifecycle = [
    { type: 'released', nodeId: 'starter', from: 'party', to: 'released', reason: null },
    { type: 'restored', nodeId: 'starter', from: 'released', to: 'reserve', reason: null },
  ];
  return run;
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
  it('renders the three workbench regions and the timeline entry point', () => {
    renderWorkbench();
    expect(screen.getByRole('region', { name: /progression/i })).toBeVisible();
    expect(screen.getByRole('region', { name: /route detail/i })).toBeVisible();
    expect(screen.getByRole('region', { name: /inspector/i })).toBeVisible();
    expect(screen.getByRole('region', { name: /team timeline/i })).toBeVisible();
  });

  it('shows six active party slots and unbounded reserve and released pools', () => {
    renderWorkbench();
    const timeline = screen.getByRole('region', { name: /team timeline/i });
    expect(within(timeline).getByRole('region', { name: /party · 0 of 6 pokémon/i })).toBeVisible();
    expect(within(timeline).getByRole('region', { name: /reserve · 0 pokémon/i })).toBeVisible();
    expect(within(timeline).getByRole('region', { name: /released · 0 pokémon/i })).toBeVisible();
  });

  it('resolves a starter-acquired member into detailed route states', () => {
    const starter = pack.pokemon.find((record) => record.id === 1)!;
    renderWorkbench({ playthrough: starterPlaythrough() });
    expect(screen.getByRole('region', { name: /party · 1 of 6 pokémon/i })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Detailed Planning' }));
    expect(screen.getByText(starter.name)).toBeVisible();
    expect(screen.getByRole('button', { name: /^Edit /i })).toBeVisible();
    expect(screen.queryByRole('button', { name: /^Restore /i })).toBeNull();
  });

  it('requires confirmation before restoring released members', () => {
    const { onPlaythroughChange } = renderWorkbench({ playthrough: starterPlaythrough('released') });

    expect(screen.getByRole('region', { name: /released .* 1 pok/i })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /^Restore /i }));
    expect(onPlaythroughChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    expect(onPlaythroughChange).toHaveBeenCalledTimes(1);
    expect(onPlaythroughChange.mock.calls[0][0].timeline.members.starter.lifecycle.at(-1)?.type).toBe('restored');
  });

  it('opens the milestone member editor from its visible keyboard action', () => {
    renderWorkbench({ playthrough: starterPlaythrough() });
    const trigger = screen.getByRole('button', { name: 'Edit Bulbasaur' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Edit Bulbasaur at Brock' });
    expect(within(dialog).getByLabelText('Level')).toHaveValue(5);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close editor' }));
    expect(trigger).toHaveFocus();
  });

  it('keys real validation findings into the selected timeline node', () => {
    renderWorkbench({ playthrough: restoredStarterPlaythrough() });
    expect(screen.getByText('Restored Pokémon')).toBeVisible();
    fireEvent.click(screen.getByText('Restored Pokémon'));
    expect(screen.getByText('This member was restored after release. The audit finding is permanent.')).toBeVisible();
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
    renderWorkbench({ playthrough: parsePlaythrough({ ...emptyPlaythrough(), currentMilestoneId: 'brock-gym' }, packIndex()) });
    expect(screen.queryByText(/exposure/i)).toBeNull();
    expect(screen.queryByText(/opponent/i)).toBeNull();
    expect(screen.queryByText(/super.?effective/i)).toBeNull();
  });
});
