import { useEffect, useMemo, useState } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import {
  searchFireRed,
  type ObtainabilityStatus,
  type PokemonType,
  type SearchQuery,
  type SearchResult,
} from '../../domain/search';
import { titleCase } from '../text';

/** The most results rendered at once, so a broad filter stays a restrained list, not a wall. */
const RESULT_LIMIT = 50;

const OBTAIN_LABEL: Record<ObtainabilityStatus, string> = {
  standard: 'Standard',
  postgame: 'Postgame',
  'version-exclusive': 'Version exclusive',
  'event-only': 'Event only',
  'transfer-only': 'Transfer only',
};

export interface FireRedSearchProps {
  pack: FireRedPack;
  query: SearchQuery;
  onQueryChange: (query: SearchQuery) => void;
  /** Selecting a result opens the shared inspector surface in place; no navigation, no result cards. */
  onSelectPokemon: (pokemonId: number) => void;
  /** Node-id → matching-species count for the active query, or `undefined` when no filter is set. */
  onRouteMatchCounts?: (counts: Record<string, number> | undefined) => void;
  selectedPokemonId?: number | null;
  /** Debounce window for the free-text name field; selects apply immediately. */
  debounceMs?: number;
}

function withQueryValue(
  query: SearchQuery,
  key: keyof SearchQuery,
  value: string,
): SearchQuery {
  const next = { ...query };
  if (value === '') delete next[key];
  else if (key === 'type') next.type = value as PokemonType;
  else next[key] = value;
  return next;
}

function hasFilter(query: SearchQuery): boolean {
  return (query.name !== undefined && query.name.trim() !== '')
    || query.type !== undefined
    || query.ability !== undefined
    || query.move !== undefined;
}

function routeCountsFor(results: readonly SearchResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const nodeId of result.routes) counts[nodeId] = (counts[nodeId] ?? 0) + 1;
  }
  return counts;
}

/**
 * The FireRed-scoped search rail: a debounced free-text name field plus explicit type, ability, and
 * move selects. Every provided filter is intersected through the pure `searchFireRed` over the pack's
 * generated indexes — there is no query language. Each result carries obtainability (current /
 * transfer-only) and, when a move filter is active, its learn methods and FireRed validity. Selecting
 * a result reuses the caller's inspector surface rather than opening a separate product surface, and
 * the active query's per-route match counts are emitted upward for the progression rail.
 */
export function FireRedSearch({
  pack,
  query,
  onQueryChange,
  onSelectPokemon,
  onRouteMatchCounts,
  selectedPokemonId = null,
  debounceMs = 200,
}: FireRedSearchProps) {
  const name = query.name ?? '';
  const [debouncedName, setDebouncedName] = useState(name);

  // Debounce only the free-text name; selects are cheap exact-index lookups and apply immediately.
  useEffect(() => {
    if (debouncedName === name) return;
    const handle = setTimeout(() => setDebouncedName(name), debounceMs);
    return () => clearTimeout(handle);
  }, [name, debouncedName, debounceMs]);

  const typeOptions = useMemo(() => Object.keys(pack.indexes.pokemonByType).sort(), [pack]);
  const abilityOptions = useMemo(() => Object.keys(pack.indexes.pokemonByAbility).sort(), [pack]);
  const moveOptions = useMemo(
    () => [...pack.moves].map((record) => ({ slug: record.slug, name: record.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [pack],
  );

  // Route counts react to the immediate name so the rail stays live; the list uses the debounced name.
  useEffect(() => {
    if (onRouteMatchCounts === undefined) return;
    onRouteMatchCounts(hasFilter(query) ? routeCountsFor(searchFireRed(query, pack)) : undefined);
  }, [query.name, query.type, query.ability, query.move, pack, onRouteMatchCounts]);

  const resultsQuery = { ...query };
  if (debouncedName === '') delete resultsQuery.name;
  else resultsQuery.name = debouncedName;
  const active = hasFilter(resultsQuery);

  const results = useMemo(
    () => (active ? searchFireRed(resultsQuery, pack) : []),
    [active, resultsQuery.name, resultsQuery.type, resultsQuery.ability, resultsQuery.move, pack],
  );
  const shown = results.slice(0, RESULT_LIMIT);

  return (
    <search className="search" aria-label="FireRed search">
      <div className="search-fields">
        <div className="search-field">
          <label htmlFor="firered-search-name">Search FireRed</label>
          <input
            id="firered-search-name"
            type="search"
            className="search-name-input"
            value={name}
            onChange={(event) => onQueryChange(withQueryValue(query, 'name', event.target.value))}
            placeholder="Name"
          />
        </div>
        <div className="search-field">
          <label htmlFor="firered-search-type">Type</label>
          <select id="firered-search-type" value={query.type ?? ''} onChange={(event) => onQueryChange(withQueryValue(query, 'type', event.target.value))}>
            <option value="">Any type</option>
            {typeOptions.map((option) => (
              <option key={option} value={option}>{titleCase(option)}</option>
            ))}
          </select>
        </div>
        <div className="search-field">
          <label htmlFor="firered-search-ability">Ability</label>
          <select id="firered-search-ability" value={query.ability ?? ''} onChange={(event) => onQueryChange(withQueryValue(query, 'ability', event.target.value))}>
            <option value="">Any ability</option>
            {abilityOptions.map((option) => (
              <option key={option} value={option}>{titleCase(option)}</option>
            ))}
          </select>
        </div>
        <div className="search-field">
          <label htmlFor="firered-search-move">Move</label>
          <select id="firered-search-move" value={query.move ?? ''} onChange={(event) => onQueryChange(withQueryValue(query, 'move', event.target.value))}>
            <option value="">Any move</option>
            {moveOptions.map((option) => (
              <option key={option.slug} value={option.slug}>{option.name}</option>
            ))}
          </select>
        </div>
      </div>

      {!active ? (
        <p className="search-hint">Enter a name or pick a filter to search FireRed.</p>
      ) : results.length === 0 ? (
        <p className="search-hint">No FireRed species match this query.</p>
      ) : (
        <>
          <h3 className="search-results-heading" aria-live="polite">
            {results.length} {results.length === 1 ? 'match' : 'matches'}
            {results.length > RESULT_LIMIT ? ` (showing first ${RESULT_LIMIT})` : ''}
          </h3>
          <ol className="search-results">
            {shown.map((result) => (
              <li key={result.pokemonId} className="search-result">
                <button
                  type="button"
                  className="search-result-select"
                  aria-label={`Select ${result.name}`}
                  aria-pressed={selectedPokemonId === result.pokemonId}
                  onClick={() => onSelectPokemon(result.pokemonId)}
                >
                  <span className="search-result-name">{result.name}</span>
                  <code className="search-result-dex">#{result.pokemonId}</code>
                </button>
                <div className="search-result-meta">
                  <span className="search-result-types">
                    {result.types.map((value) => titleCase(value)).join(' / ')}
                  </span>
                  <span className="search-result-obtain" data-status={result.obtainability.status}>
                    {OBTAIN_LABEL[result.obtainability.status]}
                  </span>
                  <span className="search-result-routes">
                    {result.routeCount} {result.routeCount === 1 ? 'route' : 'routes'}
                  </span>
                </div>
                {result.moveMatch !== undefined && (
                  <div className="search-result-move">
                    <span className="search-result-methods">
                      {result.moveMatch.methods.length > 0
                        ? result.moveMatch.methods.map((method) => titleCase(method)).join(', ')
                        : 'No FireRed method'}
                    </span>
                    <span className="search-result-validity">
                      {result.moveMatch.versionValid ? 'FireRed-legal' : 'Transfer only'}
                    </span>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </search>
  );
}
