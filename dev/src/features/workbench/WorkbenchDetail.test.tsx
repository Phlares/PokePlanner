import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIRE_RED_RULES } from '../../domain/rules/firered-rules';
import { loadFireRedPackFixture } from '../../test/firered-pack';
import { WorkbenchDetail } from './WorkbenchDetail';
import {
  createWorkbenchState,
  reduceWorkbench,
  type WorkbenchAction,
  type WorkbenchState,
} from './controller';
import type { MilestoneResultsInput } from './selectors';

const pack = loadFireRedPackFixture();
const TARGET = 'brock-gym';

/** Drive the real reducer, so no test here can pin a state the controller cannot produce. */
function stateAfter(...actions: readonly WorkbenchAction[]): WorkbenchState {
  return actions.reduce(
    reduceWorkbench,
    createWorkbenchState({ currentProgressId: null, planningTargetId: TARGET }),
  );
}

function inputFor(state: WorkbenchState): MilestoneResultsInput {
  return { pack, rules: FIRE_RED_RULES, state, currentMilestoneId: null, targetMilestoneId: TARGET };
}

function renderDetail(state: WorkbenchState) {
  const onSelectPokemon = vi.fn();
  const onSelectLocation = vi.fn();
  const element = (next: WorkbenchState) => (
    <WorkbenchDetail
      input={inputFor(next)}
      onSelectPokemon={onSelectPokemon}
      onSelectLocation={onSelectLocation}
    />
  );
  const view = render(element(state));
  return {
    onSelectPokemon,
    onSelectLocation,
    rerender: (next: WorkbenchState) => view.rerender(element(next)),
  };
}

const ROUTE_22: WorkbenchAction = { type: 'route-selected', nodeId: 'kanto-route-22' };
const MANKEY: WorkbenchAction = { type: 'candidate-selected', pokemonId: 56 };

afterEach(cleanup);

describe('WorkbenchDetail', () => {
  it('names the region for the route it is holding', () => {
    renderDetail(stateAfter(ROUTE_22));
    const region = screen.getByRole('region', { name: 'Route detail' });
    expect(within(region).getByRole('heading', { name: 'Route 22' }).textContent).toBe('Route 22');
    expect(screen.queryByRole('region', { name: 'Where & When' })).toBeNull();
  });

  it('names the region for the species it is holding', () => {
    renderDetail(stateAfter(MANKEY));
    const region = screen.getByRole('region', { name: 'Where & When' });
    expect(within(region).getByRole('heading', { name: 'Mankey · Where & When' }).textContent)
      .toBe('Mankey · Where & When');
    expect(screen.queryByRole('region', { name: 'Route detail' })).toBeNull();
  });

  it('offers the placeholder when nothing is selected', () => {
    renderDetail(stateAfter());
    const region = screen.getByRole('region', { name: 'Route detail' });
    expect(within(region).getByText('Choose a route from a milestone group.')).toBeVisible();
    expect(within(region).queryByRole('heading')).toBeNull();
  });

  it('marks matched encounter rows only while a query narrows them', () => {
    const { rerender } = renderDetail(stateAfter(ROUTE_22));
    // Browsing places every species on the route, so a mark on every row would say nothing.
    expect(screen.queryByText('Match')).toBeNull();

    rerender(stateAfter(ROUTE_22, { type: 'query-changed', query: { name: 'Mankey' } }));

    const marks = screen.getAllByText('Match');
    expect(marks).toHaveLength(1);
    expect(within(marks[0].closest('tr') as HTMLElement).getByRole('button').textContent).toBe('Mankey');
  });

  it('focuses the route heading on a selection, and never on a mere re-derivation', () => {
    const { rerender } = renderDetail(stateAfter());

    rerender(stateAfter(ROUTE_22));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Route 22' }));

    // A query re-derives the open route's whole detail. That is not a selection, so focus stays
    // wherever the user put it — this is what an effect keyed on the derived row would break.
    (document.activeElement as HTMLElement).blur();
    rerender(stateAfter(ROUTE_22, { type: 'query-changed', query: { name: 'Mankey' } }));

    expect(document.activeElement).toBe(document.body);
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { name: 'Route 22' }));
  });

  it('reports a species selection to its caller', () => {
    const { onSelectPokemon, onSelectLocation } = renderDetail(stateAfter(ROUTE_22));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Mankey at Route 22' }));
    expect(onSelectPokemon).toHaveBeenCalledWith(56);
    expect(onSelectLocation).not.toHaveBeenCalled();
  });

  it('reports a location selection to its caller', () => {
    const { onSelectPokemon, onSelectLocation } = renderDetail(stateAfter(MANKEY));
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Mankey at Route 22' }));
    expect(onSelectLocation).toHaveBeenCalledWith('kanto-route-22');
    expect(onSelectPokemon).not.toHaveBeenCalled();
  });
});
