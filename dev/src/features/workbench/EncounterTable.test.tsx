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

/** The primary Route 22 Mankey slot: walk method, level 3, slot chance 20%. */
function primaryMankeyRow(): HTMLElement {
  const rows = screen
    .getAllByRole('row')
    .filter((row) => within(row).queryByRole('button', { name: 'Mankey' }));
  const row = rows.find((candidate) => within(candidate).queryByText('20%'));
  if (!row) throw new Error('Expected a Route 22 Mankey row with a 20% slot chance');
  return row;
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
    expect(screen.getByRole('columnheader', { name: /slot chance/i })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /method rate/i })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /conditions/i })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /ev yield/i })).toBeVisible();
  });

  it('lists Mankey on Route 22 with its exact level, slot chance, method rate, and EV yield', () => {
    renderTable();
    const row = within(primaryMankeyRow());
    expect(row.getByRole('button', { name: 'Mankey' })).toBeVisible();
    expect(row.getByText('walk')).toBeVisible();
    expect(row.getByText('3')).toBeVisible(); // level
    expect(row.getByText('20%')).toBeVisible(); // slot chance
    expect(row.getByText('21%')).toBeVisible(); // SEPARATE method rate for walk
    expect(row.getByText('45%')).toBeVisible(); // SEPARATE max chance
    expect(row.getByText(/Atk\s*1/)).toBeVisible(); // EV yield
  });

  it('keeps slot chance, method rate, and max chance as three separate column quantities', () => {
    renderTable();
    expect(screen.getByRole('columnheader', { name: /slot chance/i })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /method rate/i })).toBeVisible();
    expect(screen.getByRole('columnheader', { name: /max chance/i })).toBeVisible();
    const row = within(primaryMankeyRow());
    // All three quantities coexist in one row as distinct factual cells.
    expect(row.getByText('20%')).not.toBe(row.getByText('21%'));
    expect(row.getByText('21%')).not.toBe(row.getByText('45%'));
  });

  it('selects a Pokémon row through a keyboard-operable button', () => {
    const { onSelectPokemon } = renderTable();
    const button = within(primaryMankeyRow()).getByRole('button', { name: 'Mankey' });
    expect(button.tagName).toBe('BUTTON'); // native button => Enter/Space activate
    fireEvent.click(button);
    expect(onSelectPokemon).toHaveBeenCalledWith(56);
  });

  it('marks the selected species pressed', () => {
    renderTable({ selectedPokemonId: 56 });
    const button = within(primaryMankeyRow()).getByRole('button', { name: 'Mankey' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
  });

  it('never surfaces encounter simulation, expected time, or catch-odds math', () => {
    renderTable();
    expect(screen.queryByText(/expected time|per hour|average time|catch odds|simulat|steps to/i)).toBeNull();
  });
});
