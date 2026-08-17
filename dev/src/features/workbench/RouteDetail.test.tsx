import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import { RouteDetail } from './RouteDetail';
import { createWorkbenchState, type WorkbenchState } from './controller';
import { selectRouteDetail, type RouteResult } from './selectors';
import type { WorkbenchSearchQuery } from '../../domain/workbench/search';

const pack = loadFireRedPackFixture();

/** The pack's own name for a milestone, so no assertion spells a ruleset term itself. */
const milestoneName = (id: string): string =>
  FIRE_RED_RULES.milestones.find((milestone) => milestone.id === id)!.name;

function stateWith(query: WorkbenchSearchQuery, target: string): WorkbenchState {
  return {
    ...createWorkbenchState({ currentProgressId: null, planningTargetId: target }),
    query,
  };
}

function routeOf(nodeId: string, query: WorkbenchSearchQuery = {}, target = 'brock-gym'): RouteResult {
  const route = selectRouteDetail(nodeId, {
    pack,
    rules: FIRE_RED_RULES,
    state: stateWith(query, target),
    currentMilestoneId: null,
    targetMilestoneId: target,
  });
  if (route === null) throw new Error(`No route detail for ${nodeId}`);
  return route;
}

function renderDetail(route: RouteResult, overrides: Partial<Parameters<typeof RouteDetail>[0]> = {}) {
  const onSelectPokemon = vi.fn();
  render(
    <RouteDetail
      route={route}
      milestoneName={milestoneName(route.milestoneId)}
      pack={pack}
      selectedPokemonId={null}
      matchedPokemonIds={null}
      onSelectPokemon={onSelectPokemon}
      {...overrides}
    />,
  );
  return { onSelectPokemon };
}

/** The match row for one species, found by the control that opens it. */
function matchRow(speciesName: string, routeName: string): HTMLElement {
  return screen
    .getByRole('button', { name: `Inspect ${speciesName} at ${routeName}` })
    .closest('li') as HTMLElement;
}

afterEach(cleanup);

describe('RouteDetail', () => {
  it('heads the pane with the route and states its group, access, count and band', () => {
    renderDetail(routeOf('kanto-route-22'));

    const heading = screen.getByRole('heading', { name: 'Route 22' });
    expect(heading.textContent).toBe('Route 22');
    // Spec §20: the heading is the focus target when a route is selected, so it must take focus.
    expect(heading.tabIndex).toBe(-1);
    const meta = `${milestoneName('brock-gym')} · Optional · 9 matches · Lv 2–40`;
    expect(screen.getByText(meta).textContent).toBe(meta);
    // Route 22 is a detour, never a reached leg, and never Viridian Forest.
    expect(screen.queryByText('Reached')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Viridian Forest' })).toBeNull();
  });

  it('lists every match as name, acquisition method and level band', () => {
    const route = routeOf('kanto-route-22');
    renderDetail(route);

    const mankey = within(matchRow('Mankey', route.name));
    expect(mankey.getByText('Mankey').textContent).toBe('Mankey');
    expect(mankey.getByText('Walk').textContent).toBe('Walk');
    expect(mankey.getByText('Lv 2–5').textContent).toBe('Lv 2–5');

    // A species on the same route through the water reads its own methods, not Mankey's.
    const psyduck = within(matchRow('Psyduck', route.name));
    expect(psyduck.getByText('Super Rod, Surf').textContent).toBe('Super Rod, Surf');
    expect(psyduck.queryByText('Walk')).toBeNull();
    expect(screen.queryByRole('button', { name: `Inspect Chikorita at ${route.name}` })).toBeNull();
  });

  it('states the gates a route stands behind, and none where there are none', () => {
    const cave = routeOf('cerulean-cave', {}, 'champion');
    renderDetail(cave, { milestoneName: milestoneName('champion') });
    const gates = 'Needs Rock Smash · Surf · Champion · Network Machine Restored';
    expect(screen.getByText(gates).textContent).toBe(gates);

    cleanup();
    renderDetail(routeOf('kanto-route-22'));
    expect(screen.queryByText(/^Needs /)).toBeNull();
  });

  it('labels an encounter outside ordinary play in words, not by emphasis alone', () => {
    const cave = routeOf('cerulean-cave', {}, 'champion');
    renderDetail(cave, { milestoneName: milestoneName('champion') });

    const mewtwo = within(matchRow('Mewtwo', cave.name));
    expect(mewtwo.getByText('Postgame').textContent).toBe('Postgame');
    // An ordinary encounter in the same cave carries no such label.
    expect(within(matchRow('Psyduck', cave.name)).queryByText('Postgame')).toBeNull();
  });

  it('renders the wild-encounter ledger as a semantic table and marks the matched rows', () => {
    const route = routeOf('kanto-route-22', { name: 'Mankey' });
    renderDetail(route, { matchedPokemonIds: new Set([56]) });

    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Method' })).toBeVisible();
    const mankey = within(table).getByRole('button', { name: 'Mankey' }).closest('tr') as HTMLElement;
    expect(mankey).toHaveAttribute('data-match', 'true');
    expect(within(mankey).getByText('Match').textContent).toBe('Match');

    const rattata = within(table).getByRole('button', { name: 'Rattata' }).closest('tr') as HTMLElement;
    expect(rattata).not.toHaveAttribute('data-match');
    expect(within(rattata).queryByText('Match')).toBeNull();
  });

  it('selects a species from the match list and from the ledger alike', () => {
    const route = routeOf('kanto-route-22');
    const { onSelectPokemon } = renderDetail(route);

    fireEvent.click(screen.getByRole('button', { name: `Inspect Mankey at ${route.name}` }));
    expect(onSelectPokemon).toHaveBeenCalledWith(56);

    fireEvent.click(within(screen.getByRole('table')).getByRole('button', { name: 'Rattata' }));
    expect(onSelectPokemon).toHaveBeenLastCalledWith(19);
  });

  it('says so when the pack records no wild encounters at the location', () => {
    // Pewter City is on the golden path and hosts no encounter area at all.
    renderDetail(routeOf('pewter-city'));
    expect(screen.getByRole('heading', { name: 'Pewter City' }).textContent).toBe('Pewter City');
    expect(screen.getByText('No wild encounters recorded for this location.')).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();

    cleanup();
    renderDetail(routeOf('kanto-route-22'));
    expect(screen.queryByText('No wild encounters recorded for this location.')).toBeNull();
    expect(screen.getByRole('table')).toBeVisible();
  });

  it('says so when the active filters place nothing on the route', () => {
    const forest = routeOf('viridian-forest', { name: 'Mankey' });
    renderDetail(forest);

    expect(screen.getByRole('heading', { name: 'Viridian Forest' }).textContent).toBe('Viridian Forest');
    const meta = `${milestoneName('brock-gym')} · Ahead · 0 matches`;
    expect(screen.getByText(meta).textContent).toBe(meta);
    expect(screen.getByText('No Pokémon here match the active filters.')).toBeVisible();
    expect(screen.queryByRole('button', { name: `Inspect Mankey at ${forest.name}` })).toBeNull();
  });
});
