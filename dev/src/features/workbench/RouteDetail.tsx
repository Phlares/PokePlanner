import { useMemo, type Ref } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import type { CapabilityState } from '../../domain/timeline/capabilities';
import { EncounterTable } from './EncounterTable';
import {
  ACCESS_LABEL,
  CAPABILITY_LABEL,
  EXACT_MATCH_LABEL,
  OBTAIN_LABEL,
  gateLabel,
  levelLabel,
  matchLabel,
  methodLabel,
} from './labels';
import type { RouteResult } from './selectors';

export interface RouteDetailProps {
  /** The node's whole row, filters already applied; see `selectRouteDetail`. */
  route: RouteResult;
  /** The milestone group the node belongs to, named as the results surface names it. */
  milestoneName: string;
  pack: FireRedPack;
  selectedPokemonId: number | null;
  /**
   * Species the active query places here, or null while browsing — where every row would carry the
   * mark, so the mark would say nothing.
   */
  matchedPokemonIds: ReadonlySet<number> | null;
  /** Species id → capability verdict while a capability search runs, empty or absent otherwise. */
  capabilityStates?: ReadonlyMap<number, CapabilityState>;
  onSelectPokemon: (pokemonId: number) => void;
  /** The heading the shell focuses when a route is selected (spec §20). */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * The centre pane in Routes mode (spec §11): one node stated whole. The heading names the node —
 * that is what the pane is about — and under it the group it belongs to, how reachable it is, what
 * the filters place here and at which levels, and the gates standing in the way. Beneath that the
 * matches read as `Name · method · levels`, wild and non-wild alike, and then the complete
 * wild-encounter ledger for every area the pack records at the node.
 *
 * It derives nothing about the run: the row arrives resolved, and every state it shows — access,
 * gates, obtainability, capability verdict — is text from the one shared vocabulary, so nothing
 * here needs hover or colour to be read.
 */
export function RouteDetail({
  route,
  milestoneName,
  pack,
  selectedPokemonId,
  matchedPokemonIds,
  capabilityStates,
  onSelectPokemon,
  headingRef,
}: RouteDetailProps) {
  const areas = useMemo(
    () => pack.encounters.filter((area) => area.nodeId === route.nodeId),
    [pack, route.nodeId],
  );

  const band = levelLabel(route.levelRange?.min ?? null, route.levelRange?.max ?? null);
  const meta = [milestoneName, ACCESS_LABEL[route.access], matchLabel(route.matchCount), ...(band === null ? [] : [band])];

  return (
    <div className="route-detail" data-access={route.access}>
      <h3 className="workbench-region-heading" tabIndex={-1} ref={headingRef}>{route.name}</h3>
      <p className="route-detail-meta">{meta.join(' · ')}</p>
      {route.gates.length > 0 && (
        <p className="route-detail-gates">Needs {route.gates.map(gateLabel).join(' · ')}</p>
      )}

      {route.matches.length === 0 ? (
        <p className="workbench-placeholder">No Pokémon here match the active filters.</p>
      ) : (
        <ul className="route-detail-matches" aria-label={`Matches at ${route.name}`}>
          {route.matches.map((match) => {
            const obtainLabel = OBTAIN_LABEL[match.obtainability.status];
            const capability = capabilityStates?.get(match.pokemonId);
            const capabilityLabel = capability === undefined ? undefined : CAPABILITY_LABEL[capability];
            const levels = levelLabel(match.minLevel, match.maxLevel);
            return (
              <li
                key={match.pokemonId}
                className="route-detail-match"
                data-exact={match.exactMatch ? 'true' : undefined}
              >
                <button
                  type="button"
                  className="route-detail-match-select"
                  aria-label={`Inspect ${match.name} at ${route.name}`}
                  aria-pressed={selectedPokemonId === match.pokemonId}
                  onClick={() => onSelectPokemon(match.pokemonId)}
                >
                  <span className="route-detail-match-name">{match.name}</span>
                  <span className="route-detail-match-methods">{methodLabel(match.methods)}</span>
                </button>
                {levels !== null && <span className="route-detail-match-level">{levels}</span>}
                {match.exactMatch && <span className="route-detail-match-exact">{EXACT_MATCH_LABEL}</span>}
                {obtainLabel !== undefined && (
                  <span className="route-detail-match-obtain" data-status={match.obtainability.status}>
                    {obtainLabel}
                  </span>
                )}
                {capabilityLabel !== undefined && (
                  <span className="route-detail-match-capability" data-state={capability}>{capabilityLabel}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {areas.length === 0 ? (
        <p className="workbench-placeholder">No wild encounters recorded for this location.</p>
      ) : areas.map((area) => (
        <EncounterTable
          key={area.slug}
          area={area}
          pack={pack}
          selectedPokemonId={selectedPokemonId}
          matchedPokemonIds={matchedPokemonIds ?? undefined}
          capabilityStates={capabilityStates}
          onSelectPokemon={onSelectPokemon}
        />
      ))}
    </div>
  );
}
