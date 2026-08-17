import { titleCase } from '../text';
import { ACCESS_LABEL, OBTAIN_LABEL, levelLabel, methodLabel } from './labels';
import type { PokemonLocationsResult } from './selectors';

export interface PokemonLocationsProps {
  /** The species' whole acquisition history; see `selectPokemonLocations`. */
  locations: PokemonLocationsResult;
  /** The location whose route evidence is open, so the path that opened it stays marked. */
  selectedNodeId: string | null;
  onSelectLocation: (nodeId: string) => void;
}

/**
 * The centre pane in Pokémon mode — Where & When (spec §12): every way of obtaining one species,
 * in progression order. Each path names its location, the milestone it belongs to, how the species
 * is obtained there, the level it arrives at, and how reachable the location is from where the run
 * stands, with any story event the location waits on stated in words.
 *
 * Selecting a path opens that location's route evidence; the candidate is the caller's to keep, so
 * this pane never drops it. It derives nothing — the paths arrive resolved and chronological.
 */
export function PokemonLocations({ locations, selectedNodeId, onSelectLocation }: PokemonLocationsProps) {
  const obtainLabel = OBTAIN_LABEL[locations.obtainability.status];

  return (
    <div className="pokemon-locations">
      <h3 className="workbench-region-heading">{`${locations.name} · Where & When`}</h3>
      {obtainLabel !== undefined && (
        <p className="pokemon-locations-obtain" data-status={locations.obtainability.status}>{obtainLabel}</p>
      )}

      {locations.paths.length === 0 ? (
        <p className="workbench-placeholder">
          {`The pack places ${locations.name} nowhere on the golden path.`}
        </p>
      ) : (
        <ol className="pokemon-locations-paths" aria-label={`${locations.name} acquisition paths`}>
          {locations.paths.map((path) => (
            <li key={path.nodeId} className="pokemon-locations-path" data-access={path.access}>
              <button
                type="button"
                className="pokemon-locations-select"
                aria-label={`Inspect ${locations.name} at ${path.name}`}
                aria-pressed={selectedNodeId === path.nodeId}
                onClick={() => onSelectLocation(path.nodeId)}
              >
                <span className="pokemon-locations-name">{path.name}</span>
                <span className="pokemon-locations-access">{ACCESS_LABEL[path.access]}</span>
              </button>
              <p className="pokemon-locations-meta">
                {[
                  path.milestoneName,
                  methodLabel(path.methods),
                  levelLabel(path.minLevel, path.maxLevel) ?? 'Level unrecorded',
                ].join(' · ')}
              </p>
              {path.prerequisites.length > 0 && (
                <p className="pokemon-locations-gates">Needs {path.prerequisites.map(titleCase).join(' · ')}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
