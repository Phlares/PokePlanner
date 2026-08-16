import { useId } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import { hasActiveSearchQuery } from '../../domain/search';
import type {
  BriefingToken,
  MilestoneBriefing,
  WorkbenchSearchQuery,
} from '../../domain/workbench/search';
import { FireRedSearch } from '../search/FireRedSearch';
import type { WorkbenchAction, WorkbenchMode } from './controller';

const MODE_LABEL: Record<WorkbenchMode, string> = {
  routes: 'Routes',
  pokemon: 'Pokémon',
};

function routeLabel(count: number): string {
  return `${count} ${count === 1 ? 'route' : 'routes'}`;
}

export interface WorkbenchToolbarProps {
  pack: FireRedPack;
  /** The controller's query. The toolbar owns no copy of it and holds no filter state. */
  query: WorkbenchSearchQuery;
  mode: WorkbenchMode;
  milestoneFilter: boolean;
  /** The planning target's name, so the scope control says what it is scoping to. */
  targetName: string;
  briefing: MilestoneBriefing;
  totalPokemon: number;
  totalRoutes: number;
  onAction: (action: WorkbenchAction) => void;
}

/**
 * The search rung (spec §7): the filters, the Routes/Pokémon toggle, the milestone scope, the whole
 * totals, the clear action, and the planning target's briefing as runnable search tokens (§18).
 *
 * Every control is controlled — nothing here remembers a filter, a mode or a fold — and each emits
 * one workbench action, so the rung can never disagree with the results below it. The briefing's
 * terms are the ruleset's own: a token carries the query it stands for, and clicking it runs exactly
 * that query rather than a string this file knows how to spell.
 */
export function WorkbenchToolbar({
  pack,
  query,
  mode,
  milestoneFilter,
  targetName,
  briefing,
  totalPokemon,
  totalRoutes,
  onAction,
}: WorkbenchToolbarProps) {
  const baseId = useId();
  const active = hasActiveSearchQuery(query);

  // A term standing in both halves is stated once, where it is asked for, with the note that
  // finishing this milestone is what grants it. Two bare rows would read as a contradiction.
  const unlocks = briefing.unlocks.filter((token) => !token.inBothHalves);
  const half = (tokens: readonly BriefingToken[], heading: string) => {
    if (tokens.length === 0) return null;
    const headingId = `${baseId}-${heading.toLowerCase()}`;
    return (
      <div className="toolbar-briefing-half" role="group" aria-labelledby={headingId}>
        <p className="eyebrow" id={headingId}>{heading}</p>
        <ul className="toolbar-tokens">
          {tokens.map((token) => (
            <li key={token.id} className="toolbar-token" data-kind={token.kind}>
              <button
                type="button"
                className="toolbar-token-select"
                aria-label={`Search for ${token.label}`}
                onClick={() => onAction({ type: 'query-changed', query: token.searchQuery })}
              >
                {token.label}
              </button>
              {token.inBothHalves && <span className="toolbar-token-note">unlocked here</span>}
            </li>
          ))}
        </ul>
      </div>
    );
  };

  return (
    <div className="toolbar">
      <FireRedSearch
        pack={pack}
        query={query}
        onQueryChange={(next) => onAction({ type: 'query-changed', query: next })}
      />

      <div className="toolbar-controls">
        <div className="toolbar-modes" role="group" aria-labelledby={`${baseId}-mode`}>
          <p className="eyebrow" id={`${baseId}-mode`}>View</p>
          {(['routes', 'pokemon'] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="toolbar-mode"
              aria-pressed={mode === option}
              onClick={() => onAction({ type: 'mode-changed', mode: option })}
            >
              {MODE_LABEL[option]}
            </button>
          ))}
        </div>

        <label className="toolbar-scope">
          <input
            type="checkbox"
            checked={milestoneFilter}
            onChange={(event) => onAction({ type: 'milestone-filter-changed', enabled: event.target.checked })}
          />
          Filter by milestone
        </label>

        {/* Polite and out of the tab order: a count that changes while the user types must never
            take focus off the field producing it. */}
        <p className="toolbar-totals" aria-live="polite">
          {totalPokemon} Pokémon · {routeLabel(totalRoutes)}
        </p>

        <button
          type="button"
          className="toolbar-clear"
          disabled={!active}
          onClick={() => onAction({ type: 'query-changed', query: {} })}
        >
          Clear filters
        </button>
      </div>

      <div className="toolbar-briefing" role="group" aria-label={`${targetName} briefing`}>
        {half(briefing.requires, 'Requires')}
        {half(unlocks.filter((token) => token.kind !== 'location'), 'Unlocks')}
        {/* Places are stated apart from the machines and capabilities: completing this milestone
            opens the next leg of the path, which is not the same claim as gating what is on it. */}
        {half(unlocks.filter((token) => token.kind === 'location'), 'Opens')}
      </div>
    </div>
  );
}
