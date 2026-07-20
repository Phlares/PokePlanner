import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PokemonInspector } from './PokemonInspector';
import { loadFireRedPackFixture } from '../../test/firered-pack';

const pack = loadFireRedPackFixture();

function renderInspector(overrides: Partial<Parameters<typeof PokemonInspector>[0]> = {}) {
  const onDraftMember = vi.fn();
  render(
    <PokemonInspector
      pokemonId={56}
      pack={pack}
      context={{ currentMilestoneId: null }}
      onDraftMember={onDraftMember}
      {...overrides}
    />,
  );
  return { onDraftMember };
}

afterEach(cleanup);

describe('PokemonInspector', () => {
  it('heads the panel with the species name and dex number', () => {
    renderInspector();
    expect(screen.getByRole('heading', { name: /Mankey/ })).toBeVisible();
    expect(screen.getByText('#56')).toBeVisible();
  });

  it('shows the Gen III catch rate', () => {
    renderInspector();
    const term = screen.getByText('Catch rate');
    const value = term.parentElement && within(term.parentElement).getByText('190');
    expect(value).toBeVisible();
  });

  it('shows base stats in a compact stat table', () => {
    renderInspector();
    const stats = screen.getByRole('table', { name: /base stats/i });
    expect(within(stats).getByText('80')).toBeVisible(); // Attack
    expect(within(stats).getByText('70')).toBeVisible(); // Speed
    expect(within(stats).getByRole('rowheader', { name: /attack/i })).toBeVisible();
  });

  it('shows the EV yield', () => {
    renderInspector();
    expect(screen.getByText(/EV yield/i)).toBeVisible();
    expect(screen.getByText('Attack 1')).toBeVisible();
  });

  it('shows Gen III types and derived weaknesses', () => {
    renderInspector();
    const types = screen.getByText('Types').parentElement!;
    expect(within(types).getByText('Fighting')).toBeVisible();
    const weak = screen.getByText('Weaknesses').parentElement!;
    expect(within(weak).getByText(/Flying/)).toBeVisible();
    expect(within(weak).getByText(/Psychic/)).toBeVisible();
  });

  it('lists legal abilities with their description visible, not tooltip-only', () => {
    renderInspector();
    expect(screen.getByText('Vital Spirit')).toBeVisible();
    expect(screen.getByText('Prevents sleep.')).toBeVisible();
  });

  it('lists evolutions with their gate', () => {
    renderInspector();
    const evolutions = screen.getByRole('list', { name: /evolutions/i });
    expect(within(evolutions).getByText(/Primeape/)).toBeVisible();
    expect(within(evolutions).getByText(/Level 28/)).toBeVisible();
  });

  it('folds acquisition sources into a collapsed disclosure that expands to reveal them', () => {
    renderInspector();
    const summary = screen.getByText(/Acquisition sources \(\d+\)/i);
    const details = summary.closest('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open'); // collapsed by default
    const sources = screen.getByRole('list', { name: /acquisition sources/i });
    expect(within(sources).getByText('Route 22')).not.toBeVisible(); // hidden while folded
    fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
    expect(within(sources).getByText('Route 22')).toBeVisible();
  });

  it('surfaces provenance visibly', () => {
    renderInspector();
    expect(screen.getByText(/pokeapi-api-data/)).toBeVisible();
  });

  it('emits a member draft when the planned level changes', () => {
    const { onDraftMember } = renderInspector();
    const input = screen.getByLabelText(/planned level/i);
    fireEvent.change(input, { target: { value: '30' } });
    expect(onDraftMember).toHaveBeenCalled();
    const draft = onDraftMember.mock.calls.at(-1)![0];
    expect(draft.speciesId).toBe(56);
    expect(draft.level).toBe(30);
    expect(draft.abilityId).toBe(72);
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
