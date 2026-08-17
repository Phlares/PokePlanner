import { useEffect, useMemo, useRef } from 'react';
import { hasActiveSearchQuery } from '../../domain/search';
import type { CapabilityState } from '../../domain/timeline/capabilities';
import { PokemonLocations } from './PokemonLocations';
import { RouteDetail } from './RouteDetail';
import {
  selectPokemonLocations,
  selectRouteDetail,
  type MilestoneResultsInput,
} from './selectors';

export interface WorkbenchDetailProps {
  /**
   * The pack, the ruleset, the run's milestones and the controller state — everything the detail
   * selectors read. The selection itself is `input.state.detail`, so the pane and the reducer can
   * never hold two opinions about what is open.
   */
  input: MilestoneResultsInput;
  /** Species id → capability verdict while a capability search runs, absent otherwise. */
  capabilityStates?: ReadonlyMap<number, CapabilityState>;
  onSelectPokemon: (pokemonId: number) => void;
  onSelectLocation: (nodeId: string) => void;
}

/**
 * The workbench's centre pane (spec §11, §12): the region, its accessible name, and whichever of
 * the two details the controller currently holds — one route stated whole, or one species' Where &
 * When. It owns the derivation of both, so the shell hands it selections and gets a pane back.
 *
 * It also owns the route half of spec §20: a newly selected route hands focus to its own heading.
 * That effect is keyed on the selected NODE, never on the derived row — a query re-derives the open
 * route on every keystroke, and pulling focus back to the heading each time would take it off the
 * field the user is typing in.
 */
export function WorkbenchDetail({
  input,
  capabilityStates,
  onSelectPokemon,
  onSelectLocation,
}: WorkbenchDetailProps) {
  const { pack, rules, state } = input;
  const nodeId = state.detail.kind === 'route' ? state.detail.nodeId : null;
  const candidatePokemonId = state.candidatePokemonId;

  const route = useMemo(
    () => (nodeId === null ? null : selectRouteDetail(nodeId, input)),
    [input, nodeId],
  );
  const locations = useMemo(
    () => (state.detail.kind !== 'pokemon-locations' || candidatePokemonId === null
      ? null
      : selectPokemonLocations(candidatePokemonId, input)),
    [candidatePokemonId, input, state.detail.kind],
  );

  // The ref is attached only while a route pane is mounted, so a change to any other detail
  // reaches a null heading and does nothing. No guard restates that.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: 'start' });
  }, [nodeId]);

  return (
    <section
      className="workbench-table"
      aria-label={locations !== null ? 'Where & When' : 'Route detail'}
    >
      {route !== null ? (
        <RouteDetail
          route={route}
          milestoneName={rules.milestones
            .find((milestone) => milestone.id === route.milestoneId)?.name ?? route.milestoneId}
          pack={pack}
          selectedPokemonId={candidatePokemonId}
          matchedPokemonIds={hasActiveSearchQuery(state.query)
            ? new Set(route.matches.map((match) => match.pokemonId))
            : null}
          capabilityStates={capabilityStates}
          onSelectPokemon={onSelectPokemon}
          headingRef={heading}
        />
      ) : locations !== null ? (
        <PokemonLocations locations={locations} onSelectLocation={onSelectLocation} />
      ) : (
        <p className="workbench-placeholder">Choose a route from a milestone group.</p>
      )}
    </section>
  );
}
