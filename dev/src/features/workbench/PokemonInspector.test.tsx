import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import { PokemonInspector } from './PokemonInspector';
import { createWorkbenchState } from './controller';
import { selectPokemonLocations, type PokemonLocationsResult } from './selectors';

const pack = loadFireRedPackFixture();

/** The ruleset's own name for a milestone, so no assertion spells a ruleset term itself. */
const milestoneName = (id: string): string =>
  FIRE_RED_RULES.milestones.find((milestone) => milestone.id === id)!.name;

/** The same Where & When view model the centre pane reads; the inspector never derives its own. */
function locationsOf(pokemonId: number, target = 'brock-gym'): PokemonLocationsResult | null {
  return selectPokemonLocations(pokemonId, {
    pack,
    rules: FIRE_RED_RULES,
    state: createWorkbenchState({ currentProgressId: null, planningTargetId: target }),
    currentMilestoneId: null,
    targetMilestoneId: target,
  });
}

function renderInspector(
  pokemonId = 56,
  overrides: Partial<Parameters<typeof PokemonInspector>[0]> = {},
) {
  render(
    <PokemonInspector
      pokemonId={pokemonId}
      pack={pack}
      rules={FIRE_RED_RULES}
      context={{ currentMilestoneId: null }}
      locations={locationsOf(pokemonId)}
      {...overrides}
    />,
  );
}

/** The cells of one reference-range row, read by the stat it heads. */
function rangeRow(tableName: string, stat: string): (string | null)[] {
  const table = screen.getByRole('table', { name: tableName });
  const row = within(table).getByRole('rowheader', { name: stat }).closest('tr')!;
  return within(row).getAllByRole('cell').map((cell) => cell.textContent);
}

afterEach(cleanup);

describe('PokemonInspector', () => {
  it('heads the panel with the species name and dex number', () => {
    renderInspector();
    expect(screen.getByRole('heading', { name: 'Mankey' }).textContent).toBe('Mankey');
    expect(screen.getByText('#56').textContent).toBe('#56');
  });

  it('names every type the species has in the head', () => {
    renderInspector(56);
    const single = within(screen.getByRole('list', { name: 'Types' }))
      .getAllByRole('listitem').map((item) => item.textContent);
    expect(single).toEqual(['Fighting']);

    cleanup();
    renderInspector(1); // Bulbasaur is dual-typed, so one entry is not simply the shape of the list
    const dual = within(screen.getByRole('list', { name: 'Types' }))
      .getAllByRole('listitem').map((item) => item.textContent);
    expect(dual).toEqual(['Grass', 'Poison']);
  });

  it('shows the Gen III catch rate', () => {
    renderInspector();
    const term = screen.getByText('Catch rate');
    expect(within(term.parentElement!).getByText('190').textContent).toBe('190');
  });

  it('shows base stats in a compact stat table', () => {
    renderInspector();
    const stats = within(screen.getByRole('table', { name: 'Base stats' }));
    const attack = stats.getByRole('rowheader', { name: 'Attack' }).closest('tr')!;
    expect(within(attack).getByRole('cell').textContent).toBe('80');
    const speed = stats.getByRole('rowheader', { name: 'Speed' }).closest('tr')!;
    expect(within(speed).getByRole('cell').textContent).toBe('70');
  });

  it('shows the EV yield', () => {
    renderInspector();
    const term = screen.getByText('EV yield');
    expect(within(term.parentElement!).getByText('Attack 1').textContent).toBe('Attack 1');
  });

  it('shows the derived defensive weaknesses', () => {
    renderInspector();
    const weak = within(screen.getByText('Weaknesses').parentElement!);
    expect(weak.getByText('Flying, Psychic').textContent).toBe('Flying, Psychic');
  });

  it('lists legal abilities with their description visible, not tooltip-only', () => {
    renderInspector();
    expect(screen.getByText('Vital Spirit')).toBeVisible();
    expect(screen.getByText('Prevents sleep.')).toBeVisible();
  });

  it('shows both directions of the evolution chain', () => {
    renderInspector(5);
    expect(screen.getByText('Evolves from Charmander')).toBeInTheDocument();
    expect(screen.getByText('Evolves to Charizard · Level 36')).toBeInTheDocument();
  });

  it('states only the direction the chain actually has', () => {
    renderInspector(56); // Mankey ends no chain, so an evolves-from line would be invented
    expect(screen.getByText('Evolves to Primeape · Level 28')).toBeInTheDocument();
    expect(screen.queryByText(/^Evolves from /)).toBeNull();

    cleanup();
    renderInspector(83); // Farfetch’d evolves in neither direction
    expect(screen.getByText('Does not evolve.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Evolution chain' })).toBeNull();
  });

  it('folds reference stat ranges away and labels them as ranges, not this Pokémon’s stats', () => {
    renderInspector();
    const summary = screen.getByText('Reference ranges');
    const details = summary.closest('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(screen.getByText(/not this Pokémon’s stats/)).toBeInTheDocument();
    fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
  });

  it('spreads a nature-affected stat across the reference ranges and leaves HP alone', () => {
    renderInspector();
    // Attack base 80: hindering, neutral and beneficial each span worst to best hidden values.
    expect(rangeRow('Lv 50 reference ranges', 'Attack')).toEqual(['76–118', '85–132', '93–145']);
    expect(rangeRow('Lv 100 reference ranges', 'Attack')).toEqual(['148–233', '165–259', '181–284']);
    // HP takes no nature modifier, so its three columns must agree.
    expect(rangeRow('Lv 50 reference ranges', 'HP')).toEqual(['100–147', '100–147', '100–147']);
  });

  it('summarises where the species is obtained, folded away, from the shared derivation', () => {
    renderInspector(56);
    const summary = screen.getByText('Acquisition summary (5)');
    const details = summary.closest('details')!;
    expect(details).not.toHaveAttribute('open');

    const rows = within(screen.getByRole('list', { name: 'Mankey acquisition summary' }))
      .getAllByRole('listitem').map((item) => item.textContent);
    expect(rows[0]).toBe(`Route 22 · ${milestoneName('brock-gym')} · Optional · Lv 2–5`);
    expect(rows[1]).toBe(`Route 3 · ${milestoneName('misty-gym')} · Locked · Lv 7`);
    expect(rows.at(-1)).toBe(`Route 23 · ${milestoneName('champion')} · Locked · Lv 32–34`);
  });

  it('omits the level from a path the pack records none for', () => {
    renderInspector(83, { locations: locationsOf(83, 'surge-gym') });
    const rows = within(screen.getByRole('list', { name: 'Farfetch’d acquisition summary' }))
      .getAllByRole('listitem').map((item) => item.textContent);
    expect(rows).toEqual([`Vermilion City · ${milestoneName('surge-gym')} · Ahead`]);
  });

  it('says so when the pack places the species nowhere', () => {
    renderInspector(5); // Charmeleon is only ever reached by evolving
    expect(screen.getByText('Acquisition summary (0)')).toBeInTheDocument();
    expect(screen.getByText('The pack places Charmeleon nowhere on the golden path.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Charmeleon acquisition summary' })).toBeNull();
  });

  it('offers the candidate actions its owner supplies, and only those', () => {
    const addToParty = vi.fn();
    const addToReserve = vi.fn();
    renderInspector(56, {
      actions: [
        { label: 'Add Mankey to Brock party', onSelect: addToParty },
        { label: 'Add Mankey to reserve', onSelect: addToReserve },
      ],
    });
    const actions = within(screen.getByRole('group', { name: 'Mankey actions' }));
    expect(actions.getAllByRole('button').map((button) => button.textContent))
      .toEqual(['Add Mankey to Brock party', 'Add Mankey to reserve']);

    fireEvent.click(actions.getByRole('button', { name: 'Add Mankey to reserve' }));
    expect(addToReserve).toHaveBeenCalledTimes(1);
    expect(addToParty).not.toHaveBeenCalled();
  });

  it('offers no action surface when its owner supplies none', () => {
    renderInspector(56);
    expect(screen.queryByRole('group', { name: 'Mankey actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add / })).toBeNull();
  });

  it('states the owner’s note about why an action is unavailable, and nothing when there is none', () => {
    renderInspector(56, { actionNote: 'Choose a party member to compare with Mankey.' });
    expect(screen.getByText('Choose a party member to compare with Mankey.')).toBeVisible();

    cleanup();
    renderInspector(56);
    expect(screen.queryByText(/Choose a party member/)).toBeNull();
  });

  it('labels move class and attacking stat', () => {
    renderInspector(56);
    expect(screen.getByText('Karate Chop')).toHaveAccessibleDescription('Physical move · uses Attack');
  });

  it('does not edit owned-member level', () => {
    renderInspector(56);
    expect(screen.queryByLabelText('Planned level')).not.toBeInTheDocument();
  });

  it('never edits the candidate at all — no ability choice and no move planning', () => {
    renderInspector(19); // Rattata carries two abilities, which once rendered a chooser
    expect(screen.getByText('Run Away')).toBeVisible(); // both are still stated, read-only
    expect(screen.getByText('Guts')).toBeVisible();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Plan / })).toBeNull();
  });

  it('surfaces provenance visibly', () => {
    renderInspector();
    expect(screen.getByText(/pokeapi-api-data/)).toBeVisible();
  });

  it('never blocks data on a missing sprite', () => {
    renderInspector(); // Mankey sprite is null in the pack
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('190')).toBeVisible(); // data still present
  });

  it('never surfaces opponent, exposure, or catch-odds analysis', () => {
    renderInspector();
    expect(screen.queryByText(/exposure|opponent|super.?effective|catch odds|expected time|simulat/i)).toBeNull();
  });
});
