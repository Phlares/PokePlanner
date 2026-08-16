import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';
import {
  selectMilestoneBriefing,
  type BriefingToken,
  type MilestoneBriefing,
} from '../../domain/workbench/search';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import { WorkbenchToolbar } from './WorkbenchToolbar';

const pack = loadFireRedPackFixture();

function token(overrides: Partial<BriefingToken> = {}): BriefingToken {
  return {
    id: 'surf',
    label: 'Surf',
    kind: 'capability',
    inBothHalves: false,
    searchQuery: { capability: 'surf' },
    ...overrides,
  };
}

const emptyBriefing: MilestoneBriefing = { requires: [], unlocks: [] };

function renderToolbar(overrides: Partial<Parameters<typeof WorkbenchToolbar>[0]> = {}) {
  const onAction = vi.fn();
  const view = render(
    <WorkbenchToolbar
      pack={pack}
      query={{}}
      mode="routes"
      milestoneFilter
      targetName="Brock"
      briefing={{ requires: [token()], unlocks: [] }}
      totalPokemon={12}
      totalRoutes={5}
      onAction={onAction}
      {...overrides}
    />,
  );
  return { onAction, ...view };
}

afterEach(cleanup);

describe('WorkbenchToolbar', () => {
  it('turns a briefing token into search', () => {
    const { onAction } = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Search for Surf' }));

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ query: { capability: 'surf' } }));
  });

  it('runs the terms the ruleset itself supplies, not a hand-written list', () => {
    const { onAction } = renderToolbar({
      briefing: selectMilestoneBriefing('koga-gym', { pack, rules: FIRE_RED_RULES }),
      targetName: 'Koga',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Search for Surf' }));

    expect(onAction).toHaveBeenCalledWith({ type: 'query-changed', query: { capability: 'surf' } });
  });

  it('keeps the places a milestone opens out of what it gates', () => {
    renderToolbar({
      briefing: {
        requires: [token()],
        unlocks: [
          token({ id: 'hm04-strength', label: 'HM04 Strength', kind: 'hm', searchQuery: { move: 'strength' } }),
          token({ id: 'kanto-route-3', label: 'Route 3', kind: 'location', searchQuery: { nodeId: 'kanto-route-3' } }),
        ],
      },
    });

    const requires = screen.getByRole('group', { name: 'Requires' });
    const unlocks = screen.getByRole('group', { name: 'Unlocks' });
    const opens = screen.getByRole('group', { name: 'Opens' });

    expect(within(requires).getByRole('button', { name: 'Search for Surf' })).toBeVisible();
    expect(within(unlocks).getByRole('button', { name: 'Search for HM04 Strength' })).toBeVisible();
    expect(within(unlocks).queryByRole('button', { name: 'Search for Route 3' })).toBeNull();
    expect(within(opens).getByRole('button', { name: 'Search for Route 3' })).toBeVisible();
    // The split is a partition, not a copy: neither half repeats the other's terms.
    expect(within(opens).queryByRole('button', { name: 'Search for HM04 Strength' })).toBeNull();
    expect(within(requires).queryByRole('button', { name: 'Search for Route 3' })).toBeNull();
  });

  it('attributes the briefing to the milestone it is about', () => {
    renderToolbar({ targetName: 'Koga' });

    const briefing = screen.getByRole('group', { name: 'Koga briefing' });
    expect(within(briefing).getByRole('button', { name: 'Search for Surf' })).toBeVisible();
  });

  it('omits a briefing half that has nothing to say', () => {
    renderToolbar({ briefing: emptyBriefing });

    expect(screen.queryByRole('group', { name: 'Requires' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Unlocks' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Opens' })).toBeNull();
  });

  it('states a term standing in both halves once, as required and granted here', () => {
    const surf = token({ inBothHalves: true });
    renderToolbar({ briefing: { requires: [surf], unlocks: [surf] } });

    expect(screen.getAllByRole('button', { name: 'Search for Surf' })).toHaveLength(1);
    const requires = screen.getByRole('group', { name: 'Requires' });
    expect(within(requires).getByText('unlocked here')).toBeVisible();
    expect(screen.queryByRole('group', { name: 'Unlocks' })).toBeNull();
  });

  it('switches result mode without touching the query', () => {
    const { onAction } = renderToolbar();
    const routes = screen.getByRole('button', { name: 'Routes' });
    const pokemon = screen.getByRole('button', { name: 'Pokémon' });
    expect(routes).toHaveAttribute('aria-pressed', 'true');
    expect(pokemon).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(pokemon);

    expect(onAction).toHaveBeenCalledWith({ type: 'mode-changed', mode: 'pokemon' });
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('reflects the mode it is given rather than one of its own', () => {
    renderToolbar({ mode: 'pokemon' });

    expect(screen.getByRole('button', { name: 'Pokémon' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Routes' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('toggles the milestone scope in both directions', () => {
    const { onAction, rerender } = renderToolbar();
    const scope = () => screen.getByRole('checkbox', { name: 'Filter by milestone' });
    expect(scope()).toBeChecked();

    fireEvent.click(scope());
    expect(onAction).toHaveBeenCalledWith({ type: 'milestone-filter-changed', enabled: false });

    rerender(
      <WorkbenchToolbar
        pack={pack}
        query={{}}
        mode="routes"
        milestoneFilter={false}
        targetName="Brock"
        briefing={emptyBriefing}
        totalPokemon={12}
        totalRoutes={5}
        onAction={onAction}
      />,
    );
    expect(scope()).not.toBeChecked();

    fireEvent.click(scope());
    expect(onAction).toHaveBeenLastCalledWith({ type: 'milestone-filter-changed', enabled: true });
  });

  it('announces the whole totals politely, without moving focus', () => {
    const { rerender, onAction } = renderToolbar();
    const totals = screen.getByText('12 Pokémon · 5 routes');
    expect(totals).toHaveAttribute('aria-live', 'polite');

    const name = screen.getByRole('searchbox', { name: /search/i });
    name.focus();
    rerender(
      <WorkbenchToolbar
        pack={pack}
        query={{ name: 'Mankey' }}
        mode="routes"
        milestoneFilter
        targetName="Brock"
        briefing={emptyBriefing}
        totalPokemon={1}
        totalRoutes={1}
        onAction={onAction}
      />,
    );

    expect(screen.getByText('1 Pokémon · 1 route')).toBeVisible();
    expect(name).toHaveFocus();
  });

  it('clears every filter at once, and offers nothing to clear when none is set', () => {
    const { onAction } = renderToolbar({ query: { name: 'Mankey', capability: 'surf' } });
    const clear = screen.getByRole('button', { name: 'Clear filters' });
    expect(clear).toBeEnabled();

    fireEvent.click(clear);
    expect(onAction).toHaveBeenCalledWith({ type: 'query-changed', query: {} });

    cleanup();
    renderToolbar();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeDisabled();
  });

  it('emits the whole next query when a field changes', () => {
    const { onAction } = renderToolbar({ query: { type: 'electric' } });

    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), { target: { value: 'Pikachu' } });

    expect(onAction).toHaveBeenCalledWith({ type: 'query-changed', query: { type: 'electric', name: 'Pikachu' } });
  });
});
