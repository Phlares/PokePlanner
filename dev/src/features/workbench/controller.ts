import type { WorkbenchSearchQuery } from '../../domain/workbench/search';

export type WorkbenchMode = 'routes' | 'pokemon';
export type WorkbenchDetail =
  | { kind: 'route'; nodeId: string }
  | { kind: 'pokemon-locations' }
  | { kind: 'empty' };
export type WorkbenchSheet = 'closed' | 'inspector' | 'comparison';

/**
 * The two result sections that stand for something other than a milestone. Their ids are their own
 * discriminants, so a section always names its fold with the value it already carries and no second
 * identity scheme exists. A milestone whose id collided with one of these would share its fold; no
 * ruleset names a milestone after a result row, and the reserved words are not milestone-shaped.
 */
export const FUTURE_TEASER_SECTION_ID = 'future-teaser';
export const NO_MATCH_SUMMARY_SECTION_ID = 'no-match-summary';

const RESERVED_SECTION_IDS: ReadonlySet<string> = new Set([
  FUTURE_TEASER_SECTION_ID,
  NO_MATCH_SUMMARY_SECTION_ID,
]);

export interface WorkbenchState {
  mode: WorkbenchMode;
  milestoneFilter: boolean;
  /** Every filter the toolbar can emit; the controller is their single owner. */
  query: WorkbenchSearchQuery;
  /**
   * Every result section standing open, keyed by section identity: a milestone id, or one of the
   * two reserved ids above. Three sections that fold identically are stored one way.
   */
  openSectionIds: ReadonlySet<string>;
  lastRouteId: string | null;
  candidatePokemonId: number | null;
  selectedMemberId: string | null;
  detail: WorkbenchDetail;
  sheet: WorkbenchSheet;
}

export interface WorkbenchStateSource {
  currentProgressId: string | null;
  planningTargetId: string | null;
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
  | { type: 'query-changed'; query: WorkbenchSearchQuery }
  | { type: 'section-toggled'; sectionId: string }
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
    openSectionIds: initialMilestoneId === null ? new Set() : new Set([initialMilestoneId]),
    lastRouteId: null,
    candidatePokemonId: null,
    selectedMemberId: null,
    detail: { kind: 'empty' },
    sheet: 'closed',
  };
}

function sameIds<Id>(left: ReadonlySet<Id> | undefined, right: ReadonlySet<Id> | undefined): boolean {
  if (left === right) return true;
  if (left === undefined || right === undefined) return false;
  return left.size === right.size && [...left].every((id) => right.has(id));
}

/**
 * Compare two validities by the selections they accept. Sanitization is idempotent whenever this
 * holds, so callers reconcile on content rather than on the identity of a freshly derived object.
 */
export function sameWorkbenchValidity(left: WorkbenchValidity, right: WorkbenchValidity): boolean {
  return left.currentProgressId === right.currentProgressId
    && left.planningTargetId === right.planningTargetId
    && sameIds(left.nodeIds, right.nodeIds)
    && sameIds(left.pokemonIds, right.pokemonIds)
    && sameIds(left.memberIds, right.memberIds)
    && sameIds(left.milestoneIds, right.milestoneIds);
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
  const candidateBecameInvalid = state.candidatePokemonId !== null && candidatePokemonId === null;
  const selectedMemberId = state.selectedMemberId !== null
    && (validity.memberIds === undefined || validity.memberIds.has(state.selectedMemberId))
    ? state.selectedMemberId
    : null;
  // The reserved sections belong to the results surface, not to the run, so no milestone set can
  // judge them; every other fold is a milestone the run must still admit.
  const openSectionIds = validity.milestoneIds === undefined
    ? new Set(state.openSectionIds)
    : new Set([...state.openSectionIds]
      .filter((id) => RESERVED_SECTION_IDS.has(id) || validity.milestoneIds!.has(id)));
  const targetMilestoneId = validity.planningTargetId ?? validity.currentProgressId;
  if (targetMilestoneId !== undefined && targetMilestoneId !== null
    && (validity.milestoneIds === undefined || validity.milestoneIds.has(targetMilestoneId))) {
    openSectionIds.add(targetMilestoneId);
  }

  let mode = state.mode;
  let detail: WorkbenchDetail = state.detail;
  if (candidateBecameInvalid) {
    mode = 'routes';
    detail = lastRouteId === null ? { kind: 'empty' } : { kind: 'route', nodeId: lastRouteId };
  } else if (detail.kind === 'route' && !validity.nodeIds.has(detail.nodeId)) {
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
    mode,
    openSectionIds,
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
          detail: state.lastRouteId === null ? { kind: 'empty' } : { kind: 'route', nodeId: state.lastRouteId },
          sheet: 'closed',
        };
      }
      return {
        ...state,
        mode: 'pokemon',
        detail: state.candidatePokemonId === null ? { kind: 'empty' } : { kind: 'pokemon-locations' },
        sheet: state.candidatePokemonId === null ? 'closed' : 'inspector',
      };
    case 'milestone-filter-changed':
      return { ...state, milestoneFilter: action.enabled };
    case 'query-changed':
      return { ...state, query: { ...action.query } };
    case 'section-toggled': {
      const next = new Set(state.openSectionIds);
      if (next.has(action.sectionId)) next.delete(action.sectionId);
      else next.add(action.sectionId);
      return { ...state, openSectionIds: next };
    }
    case 'route-selected':
      return {
        ...state,
        mode: 'routes',
        lastRouteId: action.nodeId,
        detail: { kind: 'route', nodeId: action.nodeId },
        sheet: 'closed',
      };
    case 'candidate-selected':
      return {
        ...state,
        mode: 'pokemon',
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
