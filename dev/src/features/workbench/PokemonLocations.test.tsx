import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import { PokemonLocations } from './PokemonLocations';
import { createWorkbenchState } from './controller';
import { selectPokemonLocations, type PokemonLocationsResult } from './selectors';

const pack = loadFireRedPackFixture();

/** The pack's own name for a milestone, so no assertion spells a ruleset term itself. */
const milestoneName = (id: string): string =>
  FIRE_RED_RULES.milestones.find((milestone) => milestone.id === id)!.name;

function locationsOf(pokemonId: number, target = 'brock-gym'): PokemonLocationsResult {
  const locations = selectPokemonLocations(pokemonId, {
    pack,
    rules: FIRE_RED_RULES,
    state: createWorkbenchState({ currentProgressId: null, planningTargetId: target }),
    currentMilestoneId: null,
    targetMilestoneId: target,
  });
  if (locations === null) throw new Error(`No locations for species ${pokemonId}`);
  return locations;
}

function renderLocations(
  locations: PokemonLocationsResult,
  overrides: Partial<Parameters<typeof PokemonLocations>[0]> = {},
) {
  const onSelectLocation = vi.fn();
  render(
    <PokemonLocations
      locations={locations}
      selectedNodeId={null}
      onSelectLocation={onSelectLocation}
      {...overrides}
    />,
  );
  return { onSelectLocation };
}

/** The path row for one location, found by the control that opens it. */
function pathRow(speciesName: string, locationName: string): HTMLElement {
  return screen
    .getByRole('button', { name: `Inspect ${speciesName} at ${locationName}` })
    .closest('li') as HTMLElement;
}

afterEach(cleanup);

describe('PokemonLocations', () => {
  it('heads the pane with the species and the pane it is', () => {
    renderLocations(locationsOf(56));
    const heading = screen.getByRole('heading', { name: 'Mankey · Where & When' });
    expect(heading.textContent).toBe('Mankey · Where & When');
    expect(screen.queryByRole('heading', { name: 'Bulbasaur · Where & When' })).toBeNull();
  });

  it('lists every acquisition path in progression order', () => {
    renderLocations(locationsOf(56));
    const names = within(screen.getByRole('list', { name: 'Mankey acquisition paths' }))
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'));
    expect(names).toEqual([
      'Inspect Mankey at Route 22',
      'Inspect Mankey at Route 3',
      'Inspect Mankey at Route 4',
      'Inspect Mankey at Rock Tunnel',
      'Inspect Mankey at Route 23',
    ]);
  });

  it('states each path with its location, milestone, method, level and access', () => {
    renderLocations(locationsOf(56));

    const route22 = within(pathRow('Mankey', 'Route 22'));
    expect(route22.getByText('Route 22').textContent).toBe('Route 22');
    expect(route22.getByText('Optional').textContent).toBe('Optional');
    const meta = `${milestoneName('brock-gym')} · Walk · Lv 2–5`;
    expect(route22.getByText(meta).textContent).toBe(meta);

    // A path past the planning target reads Locked, and names the story event it waits on.
    const route23 = within(pathRow('Mankey', 'Route 23'));
    expect(route23.getByText('Locked').textContent).toBe('Locked');
    expect(route23.getByText('Needs Giovanni Gym').textContent).toBe('Needs Giovanni Gym');
    expect(route22.queryByText('Locked')).toBeNull();
    expect(route22.queryByText(/^Needs /)).toBeNull();
  });

  it('states a non-wild acquisition in the pack’s own method words', () => {
    renderLocations(locationsOf(1));
    const pallet = within(pathRow('Bulbasaur', 'Pallet Town'));
    const meta = `${milestoneName('starter')} · Gift, Starter · Lv 5`;
    expect(pallet.getByText(meta).textContent).toBe(meta);
    expect(pallet.queryByText('Walk')).toBeNull();
  });

  it('says so when the pack records no level for a path', () => {
    renderLocations(locationsOf(83, 'surge-gym'));
    const vermilion = within(pathRow('Farfetch’d', 'Vermilion City'));
    const meta = `${milestoneName('surge-gym')} · Trade · Level unrecorded`;
    expect(vermilion.getByText(meta).textContent).toBe(meta);
  });

  it('labels a species outside ordinary play and places it nowhere it is not', () => {
    renderLocations(locationsOf(152));
    expect(screen.getByText('Transfer only').textContent).toBe('Transfer only');
    expect(screen.getByText('The pack places Chikorita nowhere on the golden path.')).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Chikorita acquisition paths' })).toBeNull();

    cleanup();
    renderLocations(locationsOf(56));
    expect(screen.queryByText('Transfer only')).toBeNull();
  });

  it('opens a location and marks the one already open', () => {
    const { onSelectLocation } = renderLocations(locationsOf(56), { selectedNodeId: 'kanto-route-3' });
    const route22 = screen.getByRole('button', { name: 'Inspect Mankey at Route 22' });
    expect(route22).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Inspect Mankey at Route 3' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(route22);
    expect(onSelectLocation).toHaveBeenCalledWith('kanto-route-22');
  });
});
