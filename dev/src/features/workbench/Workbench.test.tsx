import { useState } from 'react';
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

function speciesPlaythrough(speciesId: number, moveIds: readonly number[]): Playthrough {
  const pokemon = pack.pokemon.find((record) => record.id === speciesId)!;
  const base = emptyPlaythrough();
  return parsePlaythrough({
    ...base,
    currentMilestoneId: 'starter',
    previewMilestoneId: 'brock-gym',
    timeline: {
      members: {
        member: {
          id: 'member', originalSpeciesId: speciesId, speciesSequence: 1, nickname: null, natureId: null,
          origin: { type: 'inferred', acquisitionId: null, note: null }, acquiredAtNodeId: 'starter', notes: '', lifecycle: [],
        },
      },
      keyframes: {
        starter: {
          nodeId: 'starter', kind: 'major', party: ['member', null, null, null, null, null], reserve: [], released: [],
          snapshots: {
            member: {
              speciesId, level: 7, abilityId: pokemon.abilities.find((ability) => ability.slot === 1)!.id,
              moves: moveIds.map((moveId) => ({ moveId, status: 'available-now' as const, level: null, milestoneId: null })),
              heldItemId: null, placement: 'party', partySlot: 0, review: { moves: false, heldItem: false },
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

function starterReservedAtMistyPlaythrough(): Playthrough {
  const run = starterPlaythrough();
  const starter = run.timeline.keyframes.starter.snapshots.starter;
  return parsePlaythrough({
    ...run,
    timeline: {
      ...run.timeline,
      keyframes: {
        ...run.timeline.keyframes,
        'misty-gym': {
          nodeId: 'misty-gym', kind: 'major', party: [null, null, null, null, null, null],
          reserve: ['starter'], released: [],
          snapshots: {
            starter: { ...starter, placement: 'reserve', partySlot: null },
          },
        },
      },
    },
  }, packIndex());
}

function renderWorkbench(overrides: Partial<Parameters<typeof Workbench>[0]> = {}) {
  const onPlaythroughChange = vi.fn();
  const view = render(
    <Workbench
      pack={pack}
      playthrough={emptyPlaythrough()}
      onPlaythroughChange={onPlaythroughChange}
      now={() => 1000}
      {...overrides}
    />,
  );
  return { onPlaythroughChange, ...view };
}

/** Render behind a state-holding parent, so emitted changes return as props the way App feeds them. */
function renderControlledWorkbench(initial: Playthrough = emptyPlaythrough()) {
  function ControlledWorkbench() {
    const [playthrough, setPlaythrough] = useState(initial);
    return <Workbench pack={pack} playthrough={playthrough} onPlaythroughChange={setPlaythrough} now={() => 1000} />;
  }
  return render(<ControlledWorkbench />);
}

function siblingBranchesOutside(boundary: HTMLElement): HTMLElement[] {
  const branches = new Set<HTMLElement>();
  let branch: HTMLElement = boundary;
  while (branch.parentElement && branch !== document.body) {
    const parent = branch.parentElement;
    Array.from(parent.children).forEach((candidate) => {
      if (candidate !== branch && candidate instanceof HTMLElement) branches.add(candidate);
    });
    branch = parent;
  }
  return [...branches];
}

function expectFullModalBoundary(boundary: HTMLElement): void {
  const branches = siblingBranchesOutside(boundary);
  expect(branches.length).toBeGreaterThan(4);
  branches.forEach((branch) => {
    expect(branch).toHaveAttribute('inert');
    expect(branch).toHaveAttribute('aria-hidden', 'true');
  });
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

  it('reads the team rung from the party the run resolves at its planning target', () => {
    renderWorkbench({ playthrough: restoredStarterPlaythrough() });
    const team = screen.getByRole('region', { name: 'Team at Brock' });
    expect(within(team).getByText('Brock · Target Lv 14')).toBeVisible();
    expect(within(team).getByRole('button', { name: 'Party slot 1: Bulbasaur, level 5' })).toBeVisible();
    expect(within(team).getAllByText('Empty')).toHaveLength(5);
    expect(within(team).getByText('Reserve 0 · Findings 1 · Manual levels')).toBeVisible();
  });

  it('follows the durable planning target when it moves, in name and in content', () => {
    renderControlledWorkbench(starterReservedAtMistyPlaythrough());
    expect(screen.getByRole('region', { name: 'Team at Brock' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /Preview milestone.*Misty/i }));

    const team = screen.getByRole('region', { name: 'Team at Misty' });
    expect(screen.queryByRole('region', { name: 'Team at Brock' })).toBeNull();
    expect(within(team).getByText('Misty · Target Lv 21')).toBeVisible();
    // The starter is boxed at Misty, so the rung reports an empty party and a held reserve.
    expect(within(team).queryByRole('button', { name: /^Party slot/ })).toBeNull();
    expect(within(team).getByText(/^Reserve 1 · /)).toBeVisible();
  });

  it('names the level policy the run is actually using', () => {
    const base = starterPlaythrough();
    renderWorkbench({
      playthrough: parsePlaythrough({
        ...base,
        timeline: { ...base.timeline, preferences: { levelMode: 'match', autoEvolveLevel: false } },
      }, packIndex()),
    });
    expect(screen.getByText(/· Auto match target$/)).toBeVisible();
  });

  it('selects a team-rung member without touching the run', () => {
    const { onPlaythroughChange } = renderWorkbench({ playthrough: starterPlaythrough() });
    const slot = screen.getByRole('button', { name: 'Party slot 1: Bulbasaur, level 5' });
    expect(slot).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(slot);

    expect(screen.getByRole('button', { name: 'Party slot 1: Bulbasaur, level 5' })).toHaveAttribute('aria-pressed', 'true');
    expect(onPlaythroughChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('moves focus to the timeline from the team rung', () => {
    renderWorkbench({ playthrough: starterPlaythrough() });
    fireEvent.click(screen.getByRole('button', { name: 'Open timeline' }));
    expect(screen.getByRole('region', { name: /team timeline/i })).toHaveFocus();
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
    // Scoped to the timeline: the sticky team rung names the same member at the planning target.
    expect(within(screen.getByRole('region', { name: /team timeline/i })).getByText(starter.name)).toBeVisible();
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

  it('makes restore confirmation modal across the full shell and releases the boundary on cancel and confirm', async () => {
    const sentinel = document.createElement('button');
    sentinel.setAttribute('aria-hidden', 'false');
    document.body.append(sentinel);
    renderControlledWorkbench(starterPlaythrough('released'));

    fireEvent.click(screen.getByRole('button', { name: 'Restore Bulbasaur' }));
    let confirmation = screen.getByRole('alertdialog', { name: 'Restore Bulbasaur?' });
    expectFullModalBoundary(confirmation);
    expect(sentinel).toHaveAttribute('inert');
    fireEvent.keyDown(confirmation, { key: 'Escape' });
    expect(sentinel).not.toHaveAttribute('inert');
    expect(sentinel).toHaveAttribute('aria-hidden', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Restore Bulbasaur' }));
    confirmation = screen.getByRole('alertdialog', { name: 'Restore Bulbasaur?' });
    expectFullModalBoundary(confirmation);
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm restore' }));

    await screen.findByRole('region', { name: /Reserve .* 1 Pok/i });
    expect(sentinel).not.toHaveAttribute('inert');
    expect(sentinel).toHaveAttribute('aria-hidden', 'false');
    sentinel.remove();
  });

  it('moves focus to the restored reserve member after the controlled rerender', async () => {
    renderControlledWorkbench(starterPlaythrough('released'));
    fireEvent.click(screen.getByRole('button', { name: 'Restore Bulbasaur' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));

    const reserve = await screen.findByRole('region', { name: /Reserve .* 1 Pok/i });
    const edit = within(reserve).getByRole('button', { name: 'Edit Bulbasaur' });
    await waitFor(() => expect(edit).toHaveFocus());
    expect(screen.queryByRole('button', { name: 'Restore Bulbasaur' })).toBeNull();
  });

  it('opens the milestone member editor from its visible keyboard action', async () => {
    renderWorkbench({ playthrough: starterPlaythrough() });
    const trigger = screen.getByRole('button', { name: 'Edit Bulbasaur' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Edit Bulbasaur at Brock' });
    expect(within(dialog).getByLabelText('Level')).toHaveValue(5);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close editor' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('nests release confirmation inside the modal editor and restores all boundaries on confirm and unmount', async () => {
    const sentinel = document.createElement('button');
    sentinel.setAttribute('aria-hidden', 'false');
    document.body.append(sentinel);
    const { unmount } = renderWorkbench({ playthrough: starterPlaythrough() });

    const editTrigger = screen.getByRole('button', { name: 'Edit Bulbasaur' });
    editTrigger.focus();
    fireEvent.click(editTrigger);
    const progression = document.querySelector<HTMLElement>('.workbench-rail')!;
    expect(progression).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Release Bulbasaur' }));
    let confirmation = screen.getByRole('alertdialog', { name: 'Release Bulbasaur?' });
    expectFullModalBoundary(confirmation);
    fireEvent.keyDown(confirmation, { key: 'Escape' });

    expect(screen.getByRole('dialog', { name: 'Edit Bulbasaur at Brock' })).toBeVisible();
    expect(screen.getByRole('region', { name: 'Member configuration' })).not.toHaveAttribute('inert');
    expect(progression).toHaveAttribute('inert');

    fireEvent.click(screen.getByRole('button', { name: 'Release Bulbasaur' }));
    confirmation = screen.getByRole('alertdialog', { name: 'Release Bulbasaur?' });
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Confirm release' }));
    expect(screen.queryByRole('dialog', { name: 'Edit Bulbasaur at Brock' })).toBeNull();
    expect(progression).not.toHaveAttribute('inert');
    expect(sentinel).not.toHaveAttribute('inert');
    expect(sentinel).toHaveAttribute('aria-hidden', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Edit Bulbasaur' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release Bulbasaur' }));
    expectFullModalBoundary(screen.getByRole('alertdialog', { name: 'Release Bulbasaur?' }));
    unmount();
    expect(sentinel).not.toHaveAttribute('inert');
    expect(sentinel).toHaveAttribute('aria-hidden', 'false');
    sentinel.remove();
  });

  it('moves focus to the released member Restore control after the controlled rerender', async () => {
    renderControlledWorkbench(starterPlaythrough());
    const originalEdit = screen.getByRole('button', { name: 'Edit Bulbasaur' });
    originalEdit.focus();
    fireEvent.click(originalEdit);
    fireEvent.click(screen.getByRole('button', { name: 'Release Bulbasaur' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm release' }));

    const released = await screen.findByRole('region', { name: /Released .* 1 Pok/i });
    const restore = within(released).getByRole('button', { name: 'Restore Bulbasaur' });
    await waitFor(() => expect(restore).toHaveFocus());
    expect(document.activeElement).toBe(restore);
    expect(originalEdit).not.toBeInTheDocument();
  });

  it('moves focus to the boxed member Reserve Edit control after the controlled rerender', async () => {
    renderControlledWorkbench(starterPlaythrough());
    const originalEdit = screen.getByRole('button', { name: 'Edit Bulbasaur' });
    originalEdit.focus();
    fireEvent.click(originalEdit);
    expect(document.querySelector<HTMLElement>('.workbench-rail')).toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Move Bulbasaur to reserve' }));

    const reserve = await screen.findByRole('region', { name: /Reserve .* 1 Pok/i });
    const reserveEdit = within(reserve).getByRole('button', { name: 'Edit Bulbasaur' });
    await waitFor(() => expect(reserveEdit).toHaveFocus());
    expect(document.activeElement).toBe(reserveEdit);
    expect(document.querySelector<HTMLElement>('.workbench-rail')).not.toHaveAttribute('inert');
    expect(originalEdit).not.toBeInTheDocument();
  });

  it('atomically reconciles Caterpie ability and moves when evolving to Metapod', () => {
    const { onPlaythroughChange } = renderWorkbench({ playthrough: speciesPlaythrough(10, [33, 81]) });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Caterpie' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit Caterpie at Brock' });
    fireEvent.change(within(dialog).getByLabelText('Evolution stage'), { target: { value: '11' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'This milestone only' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply change' }));

    const next = onPlaythroughChange.mock.calls.at(-1)![0] as Playthrough;
    expect(next.timeline.overrides['brock-gym'].snapshots.member).toMatchObject({
      speciesId: 11,
      abilityId: 61,
      moves: [],
      review: { moves: true, heldItem: false },
    });
    expect(() => parsePlaythrough(next, packIndex())).not.toThrow();
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

  it('closes member context when a target change resolves that member to reserve', () => {
    renderControlledWorkbench(starterReservedAtMistyPlaythrough());
    const previewMisty = screen.getByRole('button', { name: /Preview milestone.*Misty/i });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Bulbasaur' }));
    expect(screen.getByRole('dialog', { name: /Edit Bulbasaur at Brock/i })).toBeVisible();

    fireEvent.click(previewMisty);

    expect(screen.queryByRole('dialog', { name: /Edit Bulbasaur/i })).toBeNull();
  });

  it('returns focus to the editor trigger when a target change closes the member editor', async () => {
    renderControlledWorkbench(starterReservedAtMistyPlaythrough());
    // The rail goes inert behind the editor, so its control is captured before the modal opens.
    const previewMisty = screen.getByRole('button', { name: /Preview milestone.*Misty/i });
    const trigger = screen.getByRole('button', { name: 'Edit Bulbasaur' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: /Edit Bulbasaur at Brock/i })).toBeVisible();
    expect(trigger).not.toHaveFocus();

    fireEvent.click(previewMisty);

    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Bulbasaur' })).toHaveFocus());
  });

  it('sanitizes a future route after the planning target moves earlier', () => {
    renderControlledWorkbench();
    fireEvent.click(screen.getByRole('button', { name: 'Cerulean City' }));
    expect(within(screen.getByRole('region', { name: /route detail/i })).getByText('Cerulean City')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /Preview milestone.*Brock/i }));

    expect(within(screen.getByRole('region', { name: /route detail/i })).queryByText('Cerulean City')).toBeNull();
  });

  it('scopes selections to the starter location when the durable run switches to that target', () => {
    const { onPlaythroughChange, rerender } = renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: 'Cerulean City' }));
    expect(within(screen.getByRole('region', { name: /route detail/i })).getByText('Cerulean City')).toBeVisible();

    rerender(
      <Workbench
        pack={pack}
        playthrough={parsePlaythrough({ ...emptyPlaythrough(), currentMilestoneId: 'starter' }, packIndex())}
        onPlaythroughChange={onPlaythroughChange}
        now={() => 1000}
      />,
    );

    expect(within(screen.getByRole('region', { name: /route detail/i })).queryByText('Cerulean City')).toBeNull();
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

  it('explains the progression column instead of blanking it under an active query', async () => {
    renderWorkbench();
    const progression = () => screen.getByRole('region', { name: /progression/i });
    expect(within(progression()).getByRole('button', { name: 'Route 22' })).toBeVisible();
    // Nothing stands in for the rail until there is a reason for the rail to be gone.
    expect(within(progression()).queryByText(/clear the search/i)).toBeNull();

    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), { target: { value: 'Mankey' } });

    await waitFor(() => expect(within(progression()).queryByRole('button', { name: 'Route 22' })).toBeNull());
    expect(within(progression()).getByText(/clear the search/i)).toBeVisible();
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

  it('keeps the progression rail visible for a whitespace-only name query', () => {
    renderWorkbench();
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: 'Route 22' })).toBeVisible();
    expect(screen.getByText(/name or pick a filter/i)).toBeVisible();
  });

  it('clears stale route detail when a search result opens Pokémon locations', async () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: 'Route 22' }));
    expect(within(screen.getByRole('region', { name: /route detail/i })).getByText(/Route 22/i)).toBeVisible();

    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), { target: { value: 'Mankey' } });
    fireEvent.click(await screen.findByRole('button', { name: /select Mankey/i }));

    const detail = screen.getByRole('region', { name: /route detail/i });
    expect(within(detail).queryByText(/Route 22/i)).toBeNull();
    expect(within(screen.getByRole('region', { name: /inspector/i })).getByText('Mankey')).toBeVisible();
  });

  it('retains the selected candidate when an encounter location opens it', () => {
    renderWorkbench();
    fireEvent.click(screen.getByRole('button', { name: 'Route 22' }));
    fireEvent.click(within(screen.getByRole('region', { name: /route detail/i })).getByRole('button', { name: 'Mankey' }));

    expect(within(screen.getByRole('region', { name: /route detail/i })).getByText(/Route 22/i)).toBeVisible();
    expect(within(screen.getByRole('region', { name: /inspector/i })).getByText('Mankey')).toBeVisible();
  });

  it('never surfaces opponent or exposure analysis in the workbench shell', () => {
    renderWorkbench({ playthrough: parsePlaythrough({ ...emptyPlaythrough(), currentMilestoneId: 'brock-gym' }, packIndex()) });
    expect(screen.queryByText(/exposure/i)).toBeNull();
    expect(screen.queryByText(/opponent/i)).toBeNull();
    expect(screen.queryByText(/super.?effective/i)).toBeNull();
  });
});
