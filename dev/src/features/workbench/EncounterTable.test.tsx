import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EncounterTable } from './EncounterTable';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import type { EncounterArea } from '../../domain/pack';

const pack = loadFireRedPackFixture();
const route22: EncounterArea = pack.encounters.find((area) => area.nodeId === 'kanto-route-22')!;

function renderTable(overrides: Partial<Parameters<typeof EncounterTable>[0]> = {}) {
  const onSelectPokemon = vi.fn();
  render(
    <EncounterTable
      area={route22}
      pack={pack}
      selectedPokemonId={null}
      onSelectPokemon={onSelectPokemon}
      {...overrides}
    />,
  );
  return { onSelectPokemon };
}

/**
 * The single deduped Route 22 walk row for Mankey: the five recorded walk slots
 * (chances 20/10/10/4/1, levels 3/4/2/5/5) aggregate into one row.
 */
function mankeyRow(): HTMLElement {
  const rows = screen
    .getAllByRole('row')
    .filter((row) => within(row).queryByRole('button', { name: 'Mankey' }));
  if (rows.length !== 1) throw new Error(`Expected exactly one Mankey row, found ${rows.length}`);
  return rows[0];
}

afterEach(cleanup);

describe('EncounterTable', () => {
  it('renders a semantic table captioned with the route name and column headers', () => {
    renderTable();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Route 22')).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /pok[eé]mon/i })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: 'Method' })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /levels/i })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /^chance$/i })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /method rate/i })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /conditions/i })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /ev yield/i })).toBeVisible();
  });

  it('aggregates Mankey on Route 22 into one row: level range, total chance, method rate, EV yield', () => {
    renderTable();
    const row = within(mankeyRow());
    expect(row.getByRole('button', { name: 'Mankey' })).toBeVisible();
    expect(row.getByText('walk')).toBeVisible();
    expect(row.getByText('2–5')).toBeVisible(); // min–max level across the slots
    expect(row.getByText('45%')).toBeVisible(); // SUM of slot chances 20+10+10+4+1
    expect(row.getByText('21%')).toBeVisible(); // SEPARATE method rate for walk
    expect(row.getByText(/Atk\s*1/)).toBeVisible(); // EV yield
  });

  it('replaces the slot/max chance columns with one total Chance column, keeping method rate separate', () => {
    renderTable();
    expect(screen.getByRole('columnheader', { name: /^chance$/i })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /method rate/i })).toBeVisible();
    expect(screen.queryByRole('columnheader', { name: /slot chance/i })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: /max chance/i })).toBeNull();
    const row = within(mankeyRow());
    // Total chance and method rate are distinct factual quantities in the one row.
    expect(row.getByText('45%')).not.toBe(row.getByText('21%'));
  });

  it('shows no duplicate species rows within a method', () => {
    renderTable();
    const bodyRows = screen
      .getAllByRole('row')
      .filter((row) => within(row).queryByRole('button'));
    const seen = new Map<string, Set<string>>();
    for (const row of bodyRows) {
      const method = within(row).getByText(
        /walk|surf|old-rod|good-rod|super-rod|rock-smash|gift|only-one|pokeflute|event/,
      ).textContent!;
      const species = within(row).getByRole('button').textContent!;
      const key = seen.get(method) ?? new Set<string>();
      expect(key.has(species)).toBe(false); // species appears at most once per method
      key.add(species);
      seen.set(method, key);
    }
  });

  it('selects a Pokémon row through a keyboard-operable button', () => {
    const { onSelectPokemon } = renderTable();
    const button = within(mankeyRow()).getByRole('button', { name: 'Mankey' });
    expect(button.tagName).toBe('BUTTON'); // native button => Enter/Space activate
    fireEvent.click(button);
    expect(onSelectPokemon).toHaveBeenCalledWith(56);
  });

  it('marks the selected species pressed', () => {
    renderTable({ selectedPokemonId: 56 });
    const button = within(mankeyRow()).getByRole('button', { name: 'Mankey' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('never surfaces encounter simulation, expected time, or catch-odds math', () => {
    renderTable();
    expect(screen.queryByText(/expected time|per hour|average time|catch odds|simulat|steps to/i)).toBeNull();
  });
});
