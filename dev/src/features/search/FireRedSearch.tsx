import { useMemo } from 'react';
import type { FireRedPack } from '../../data/game-pack';
import type { PokemonType, SearchQuery } from '../../domain/search';
import { titleCase } from '../text';

export interface FireRedSearchProps {
  pack: FireRedPack;
  query: SearchQuery;
  onQueryChange: (query: SearchQuery) => void;
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

/**
 * The FireRed filter fields: a free-text name plus explicit type, ability and move selects, read
 * from the pack's own generated indexes. There is no query language and no result list — the fields
 * are fully controlled and emit the complete next query, and the surface that owns that query
 * decides what the filters produce. Every filter it does not know about is carried through
 * untouched, so a workbench-only filter set elsewhere survives typing here.
 */
export function FireRedSearch({ pack, query, onQueryChange }: FireRedSearchProps) {
  const typeOptions = useMemo(() => Object.keys(pack.indexes.pokemonByType).sort(), [pack]);
  const abilityOptions = useMemo(() => Object.keys(pack.indexes.pokemonByAbility).sort(), [pack]);
  const moveOptions = useMemo(
    () => [...pack.moves].map((record) => ({ slug: record.slug, name: record.name })).sort((a, b) => a.name.localeCompare(b.name)),
    [pack],
  );

  return (
    <search className="search" aria-label="FireRed search">
      <div className="search-fields">
        <div className="search-field">
          <label htmlFor="firered-search-name">Search FireRed</label>
          <input
            id="firered-search-name"
            type="search"
            className="search-name-input"
            value={query.name ?? ''}
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
    </search>
  );
}
