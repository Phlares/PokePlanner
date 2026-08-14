import type { SearchQuery } from '../../domain/search';

export type WorkbenchMode = 'routes' | 'pokemon';
export type WorkbenchDetail =
  | { kind: 'route'; nodeId: string }
  | { kind: 'pokemon-locations' }
  | { kind: 'empty' };
export type WorkbenchSheet = 'closed' | 'inspector' | 'comparison';

export interface WorkbenchState {
  mode: WorkbenchMode;
  milestoneFilter: boolean;
  query: SearchQuery;
  openMilestoneIds: ReadonlySet<string>;
  lastRouteId: string | null;
  candidatePokemonId: number | null;
  selectedMemberId: string | null;
  detail: WorkbenchDetail;
  sheet: WorkbenchSheet;
}

export interface WorkbenchStateSource {
  currentProgressId: string | null;
  planningTargetId: string | null;
  nodeIds: ReadonlySet<string>;
}

export interface WorkbenchValidity {
  currentProgressId?: string | null;
  planningTargetId?: string | null;
  nodeIds: ReadonlySet<string>;
  pokemonIds?: ReadonlySet<number>;
  memberIds?: ReadonlySet<string>;
  milestoneIds?: ReadonlySet<string>;
}

export type WorkbenchAction =
  | { type: 'mode-changed'; mode: WorkbenchMode }
  | { type: 'milestone-filter-changed'; enabled: boolean }
  | { type: 'query-changed'; query: SearchQuery }
  | { type: 'search-activity-changed'; active: boolean }
  | { type: 'milestone-toggled'; milestoneId: string }
  | { type: 'route-selected'; nodeId: string }
  | { type: 'candidate-selected'; pokemonId: number }
  | { type: 'candidate-location-selected'; nodeId: string }
  | { type: 'member-selected'; memberId: string | null }
  | { type: 'detail-cleared' }
  | { type: 'sheet-changed'; sheet: WorkbenchSheet }
  | { type: 'sanitize'; validity: WorkbenchValidity };

export function createWorkbenchState(source: WorkbenchStateSource): WorkbenchState {
  const initialMilestoneId = source.planningTargetId ?? source.currentProgressId;
  return {
    mode: 'routes',
    milestoneFilter: true,
    query: {},
    openMilestoneIds: initialMilestoneId === null ? new Set() : new Set([initialMilestoneId]),
    lastRouteId: null,
    candidatePokemonId: null,
    selectedMemberId: null,
    detail: { kind: 'empty' },
    sheet: 'closed',
  };
}

export function sanitizeWorkbenchState(
  state: WorkbenchState,
  validity: WorkbenchValidity,
): WorkbenchState {
  const lastRouteId = state.lastRouteId !== null && validity.nodeIds.has(state.lastRouteId)
    ? state.lastRouteId
    : null;
  const candidatePokemonId = state.candidatePokemonId !== null
    && (validity.pokemonIds === undefined || validity.pokemonIds.has(state.candidatePokemonId))
    ? state.candidatePokemonId
    : null;
  const selectedMemberId = state.selectedMemberId !== null
    && (validity.memberIds === undefined || validity.memberIds.has(state.selectedMemberId))
    ? state.selectedMemberId
    : null;
  const openMilestoneIds = validity.milestoneIds === undefined
    ? new Set(state.openMilestoneIds)
    : new Set([...state.openMilestoneIds].filter((id) => validity.milestoneIds!.has(id)));
  const targetMilestoneId = validity.planningTargetId ?? validity.currentProgressId;
  if (targetMilestoneId !== undefined && targetMilestoneId !== null
    && (validity.milestoneIds === undefined || validity.milestoneIds.has(targetMilestoneId))) {
    openMilestoneIds.add(targetMilestoneId);
  }

  let detail: WorkbenchDetail = state.detail;
  if (detail.kind === 'route' && !validity.nodeIds.has(detail.nodeId)) {
    detail = state.mode === 'pokemon' && candidatePokemonId !== null
      ? { kind: 'pokemon-locations' }
      : { kind: 'empty' };
  } else if (detail.kind === 'pokemon-locations' && candidatePokemonId === null) {
    detail = { kind: 'empty' };
  }

  let sheet = state.sheet;
  if (sheet === 'inspector' && candidatePokemonId === null) sheet = 'closed';
  if (sheet === 'comparison' && (candidatePokemonId === null || selectedMemberId === null)) sheet = 'closed';

  return {
    ...state,
    openMilestoneIds,
    lastRouteId,
    candidatePokemonId,
    selectedMemberId,
    detail,
    sheet,
  };
}

export function reduceWorkbench(state: WorkbenchState, action: WorkbenchAction): WorkbenchState {
  switch (action.type) {
    case 'mode-changed':
      if (action.mode === 'routes') {
        return {
          ...state,
          mode: 'routes',
          candidatePokemonId: null,
          detail: state.lastRouteId === null ? { kind: 'empty' } : { kind: 'route', nodeId: state.lastRouteId },
          sheet: 'closed',
        };
      }
      return {
        ...state,
        mode: 'pokemon',
        detail: state.candidatePokemonId === null ? { kind: 'empty' } : { kind: 'pokemon-locations' },
      };
    case 'milestone-filter-changed':
      return { ...state, milestoneFilter: action.enabled };
    case 'query-changed':
      return { ...state, query: { ...action.query } };
    case 'search-activity-changed': {
      const currentlyActive = Object.keys(state.query).length > 0;
      if (currentlyActive === action.active) return state;
      return { ...state, query: action.active ? { name: '' } : {} };
    }
    case 'milestone-toggled': {
      const next = new Set(state.openMilestoneIds);
      if (next.has(action.milestoneId)) next.delete(action.milestoneId);
      else next.add(action.milestoneId);
      return { ...state, openMilestoneIds: next };
    }
    case 'route-selected':
      return {
        ...state,
        mode: 'routes',
        lastRouteId: action.nodeId,
        candidatePokemonId: null,
        detail: { kind: 'route', nodeId: action.nodeId },
        sheet: 'closed',
      };
    case 'candidate-selected':
      return {
        ...state,
        mode: 'pokemon',
        lastRouteId: null,
        candidatePokemonId: action.pokemonId,
        detail: { kind: 'pokemon-locations' },
        sheet: 'inspector',
      };
    case 'candidate-location-selected':
      return {
        ...state,
        mode: 'pokemon',
        lastRouteId: action.nodeId,
        detail: { kind: 'route', nodeId: action.nodeId },
        sheet: 'inspector',
      };
    case 'member-selected':
      return { ...state, selectedMemberId: action.memberId };
    case 'detail-cleared':
      return { ...state, lastRouteId: null, detail: { kind: 'empty' } };
    case 'sheet-changed':
      return { ...state, sheet: action.sheet };
    case 'sanitize':
      return sanitizeWorkbenchState(state, action.validity);
  }
}
