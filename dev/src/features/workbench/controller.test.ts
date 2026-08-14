import { describe, expect, it } from 'vitest';
import {
  createWorkbenchState,
  reduceWorkbench,
  sanitizeWorkbenchState,
  type WorkbenchState,
} from './controller';

const initial = createWorkbenchState({
  currentProgressId: 'pallet-town',
  planningTargetId: 'brock-gym',
  nodeIds: new Set(['pallet-town', 'route-22']),
});

function withCandidate(pokemonId: number): WorkbenchState {
  return reduceWorkbench(initial, { type: 'candidate-selected', pokemonId });
}

describe('workbench controller', () => {
  it('selecting a species switches modes and clears stale route detail', () => {
    const routed = reduceWorkbench(initial, { type: 'route-selected', nodeId: 'route-22' });
    const state = reduceWorkbench(routed, { type: 'candidate-selected', pokemonId: 56 });

    expect(state.mode).toBe('pokemon');
    expect(state.lastRouteId).toBeNull();
    expect(state.candidatePokemonId).toBe(56);
    expect(state.detail.kind).toBe('pokemon-locations');
  });

  it('retains a candidate when its location opens', () => {
    const state = reduceWorkbench(withCandidate(56), {
      type: 'candidate-location-selected',
      nodeId: 'route-22',
    });

    expect(state.candidatePokemonId).toBe(56);
    expect(state.detail).toEqual({ kind: 'route', nodeId: 'route-22' });
  });

  it('opens the durable planning target without copying progress into route state', () => {
    const state = createWorkbenchState({
      currentProgressId: 'route-22',
      planningTargetId: 'brock-gym',
      nodeIds: new Set(['pallet-town', 'route-22']),
    });

    expect(state.openMilestoneIds).toEqual(new Set(['brock-gym']));
    expect(state.lastRouteId).toBeNull();
    expect(state.detail).toEqual({ kind: 'empty' });
  });

  it('sanitizes route, candidate and member selections against fresh domain ids', () => {
    const stale: WorkbenchState = {
      ...withCandidate(56),
      lastRouteId: 'route-22',
      selectedMemberId: 'removed-member',
      detail: { kind: 'route', nodeId: 'route-22' },
      sheet: 'comparison',
    };

    const state = sanitizeWorkbenchState(stale, {
      nodeIds: new Set(['pallet-town']),
      pokemonIds: new Set([1]),
      memberIds: new Set(['starter']),
    });

    expect(state.lastRouteId).toBeNull();
    expect(state.candidatePokemonId).toBeNull();
    expect(state.selectedMemberId).toBeNull();
    expect(state.detail).toEqual({ kind: 'empty' });
    expect(state.sheet).toBe('closed');
  });

  it('opens the fresh planning target while sanitizing selections', () => {
    const routed = reduceWorkbench(initial, { type: 'route-selected', nodeId: 'route-22' });
    const state = sanitizeWorkbenchState(routed, {
      currentProgressId: 'brock-gym',
      planningTargetId: 'misty-gym',
      nodeIds: new Set(['pallet-town']),
      milestoneIds: new Set(['brock-gym', 'misty-gym']),
    });

    expect(state.openMilestoneIds).toContain('misty-gym');
    expect(state.detail).toEqual({ kind: 'empty' });
  });
});
