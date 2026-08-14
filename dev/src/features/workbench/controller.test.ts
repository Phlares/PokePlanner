import { describe, expect, it } from 'vitest';
import {
  createWorkbenchState,
  reduceWorkbench,
  sameWorkbenchValidity,
  sanitizeWorkbenchState,
  type WorkbenchState,
  type WorkbenchValidity,
} from './controller';

const initial = createWorkbenchState({
  currentProgressId: 'pallet-town',
  planningTargetId: 'brock-gym',
});

function withCandidate(pokemonId: number): WorkbenchState {
  return reduceWorkbench(initial, { type: 'candidate-selected', pokemonId });
}

describe('workbench controller', () => {
  it('restores the last route after selecting a species and switching back to routes', () => {
    const routed = reduceWorkbench(initial, { type: 'route-selected', nodeId: 'route-22' });
    const candidate = reduceWorkbench(routed, { type: 'candidate-selected', pokemonId: 56 });
    const state = reduceWorkbench(candidate, { type: 'mode-changed', mode: 'routes' });

    expect(state.mode).toBe('routes');
    expect(state.lastRouteId).toBe('route-22');
    expect(state.candidatePokemonId).toBe(56);
    expect(state.detail).toEqual({ kind: 'route', nodeId: 'route-22' });
  });

  it('restores the candidate after selecting a route and switching back to pokemon', () => {
    const candidate = reduceWorkbench(initial, { type: 'candidate-selected', pokemonId: 56 });
    const routed = reduceWorkbench(candidate, { type: 'route-selected', nodeId: 'route-22' });
    const state = reduceWorkbench(routed, { type: 'mode-changed', mode: 'pokemon' });

    expect(state.mode).toBe('pokemon');
    expect(state.lastRouteId).toBe('route-22');
    expect(state.candidatePokemonId).toBe(56);
    expect(state.detail).toEqual({ kind: 'pokemon-locations' });
    expect(state.sheet).toBe('inspector');
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

  it('falls back to a valid route when the selected candidate becomes invalid', () => {
    const routed = reduceWorkbench(initial, { type: 'route-selected', nodeId: 'route-22' });
    const candidate = reduceWorkbench(routed, { type: 'candidate-selected', pokemonId: 56 });
    const state = sanitizeWorkbenchState(candidate, {
      nodeIds: new Set(['route-22']),
      pokemonIds: new Set([1]),
    });

    expect(state.mode).toBe('routes');
    expect(state.lastRouteId).toBe('route-22');
    expect(state.candidatePokemonId).toBeNull();
    expect(state.detail).toEqual({ kind: 'route', nodeId: 'route-22' });
    expect(state.sheet).toBe('closed');
  });

  it('closes comparison when the selected member leaves the resolved target party', () => {
    const comparing: WorkbenchState = {
      ...withCandidate(56),
      selectedMemberId: 'starter',
      sheet: 'comparison',
    };
    const state = sanitizeWorkbenchState(comparing, {
      nodeIds: new Set(['route-22']),
      pokemonIds: new Set([56]),
      memberIds: new Set(),
    });

    expect(state.selectedMemberId).toBeNull();
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

describe('workbench validity comparison', () => {
  const base: WorkbenchValidity = {
    currentProgressId: 'starter',
    planningTargetId: 'brock-gym',
    nodeIds: new Set(['pallet-town']),
    pokemonIds: new Set([1]),
    memberIds: new Set(['starter']),
    milestoneIds: new Set(['brock-gym']),
  };

  it('treats a re-derived validity with the same content as already sanitized against', () => {
    expect(sameWorkbenchValidity(base, {
      currentProgressId: 'starter',
      planningTargetId: 'brock-gym',
      nodeIds: new Set(['pallet-town']),
      pokemonIds: new Set([1]),
      memberIds: new Set(['starter']),
      milestoneIds: new Set(['brock-gym']),
    })).toBe(true);
  });

  it.each<[string, Partial<WorkbenchValidity>]>([
    ['current progress moves', { currentProgressId: 'brock-gym' }],
    ['the planning target moves', { planningTargetId: 'misty-gym' }],
    ['an equally sized node scope names other nodes', { nodeIds: new Set(['viridian-city']) }],
    ['the species scope grows', { pokemonIds: new Set([1, 4]) }],
    ['the target party changes', { memberIds: new Set<string>() }],
    ['the milestone set changes', { milestoneIds: new Set(['brock-gym', 'misty-gym']) }],
    ['a set stops being constrained', { pokemonIds: undefined }],
  ])('needs sanitizing again when %s', (_case, change) => {
    expect(sameWorkbenchValidity(base, { ...base, ...change })).toBe(false);
  });
});
