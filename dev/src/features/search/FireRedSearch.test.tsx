import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FireRedSearch } from './FireRedSearch';
import type { SearchQuery } from '../../domain/search';
import { loadFireRedPackFixture } from '../../test/firered-pack';

const pack = loadFireRedPackFixture();

function renderSearch(initialQuery: SearchQuery = {}) {
  const onQueryChange = vi.fn();
  function ControlledSearch() {
    const [query, setQuery] = useState(initialQuery);
    return (
      <FireRedSearch
        pack={pack}
        query={query}
        onQueryChange={(next) => {
          onQueryChange(next);
          setQuery(next);
        }}
      />
    );
  }
  render(<ControlledSearch />);
  return { onQueryChange };
}

const nameBox = () => screen.getByRole('searchbox', { name: /search/i });

afterEach(cleanup);

describe('FireRedSearch', () => {
  it('renders the name input and explicit type, ability, and move selects', () => {
    renderSearch();
    expect(nameBox()).toBeVisible();
    expect(screen.getByRole('combobox', { name: /type/i })).toBeVisible();
    expect(screen.getByRole('combobox', { name: /ability/i })).toBeVisible();
    expect(screen.getByRole('combobox', { name: /move/i })).toBeVisible();
  });

  it('renders the controlled query and emits the complete next query', () => {
    const { onQueryChange } = renderSearch({ type: 'electric' });

    expect(screen.getByRole('combobox', { name: /type/i })).toHaveValue('electric');
    expect(nameBox()).toHaveValue('');

    fireEvent.change(nameBox(), { target: { value: 'Pikachu' } });

    expect(onQueryChange).toHaveBeenCalledWith({ type: 'electric', name: 'Pikachu' });
    expect(nameBox()).toHaveValue('Pikachu');
  });

  it('drops a field from the query when it is emptied, keeping the rest', () => {
    const { onQueryChange } = renderSearch({ name: 'Pikachu', ability: 'static' });

    fireEvent.change(nameBox(), { target: { value: '' } });

    expect(onQueryChange).toHaveBeenLastCalledWith({ ability: 'static' });
  });

  it('carries filters it does not own through untouched', () => {
    // The workbench-only capability filter has no field here; typing must not silently drop it.
    const { onQueryChange } = renderSearch({ capability: 'surf' } as SearchQuery);

    fireEvent.change(screen.getByRole('combobox', { name: /type/i }), { target: { value: 'water' } });

    expect(onQueryChange).toHaveBeenLastCalledWith({ capability: 'surf', type: 'water' });
  });

  it('offers the type, ability and move vocabularies the pack generated', () => {
    renderSearch();

    const types = screen.getByRole('combobox', { name: /type/i });
    expect(types).toHaveTextContent('Electric');
    fireEvent.change(types, { target: { value: 'electric' } });
    expect(types).toHaveValue('electric');

    const moves = screen.getByRole('combobox', { name: /move/i });
    fireEvent.change(moves, { target: { value: 'thunderbolt' } });
    expect(moves).toHaveValue('thunderbolt');
  });

  it('renders no result list of its own', () => {
    renderSearch({ name: 'Mankey' });

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('button', { name: /select/i })).toBeNull();
  });
});
