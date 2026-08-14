import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FireRedSearch } from './FireRedSearch';
import { loadFireRedPackFixture } from '../../test/firered-pack';

const pack = loadFireRedPackFixture();
const DEBOUNCE = 200;

function renderSearch(overrides: Partial<Parameters<typeof FireRedSearch>[0]> = {}) {
  const onSelectPokemon = vi.fn();
  const onRouteMatchCounts = vi.fn();
  const onQueryChange = vi.fn();
  const initialQuery = overrides.query ?? {};
  function ControlledSearch() {
    const [query, setQuery] = useState(initialQuery);
    return (
      <FireRedSearch
        pack={pack}
        onSelectPokemon={onSelectPokemon}
        onRouteMatchCounts={onRouteMatchCounts}
        debounceMs={DEBOUNCE}
        {...overrides}
        query={query}
        onQueryChange={(next) => {
          onQueryChange(next);
          setQuery(next);
        }}
      />
    );
  }
  render(<ControlledSearch />);
  return { onSelectPokemon, onQueryChange, onRouteMatchCounts };
}

function typeName(value: string): void {
  fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), { target: { value } });
}

function settle(): void {
  act(() => {
    vi.advanceTimersByTime(DEBOUNCE);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('FireRedSearch', () => {
  it('renders the controlled query and emits the complete next query', () => {
    const onQueryChange = vi.fn();
    render(
      <FireRedSearch
        pack={pack}
        query={{ type: 'electric' }}
        onQueryChange={onQueryChange}
        onSelectPokemon={() => undefined}
        debounceMs={DEBOUNCE}
      />,
    );

    expect(screen.getByRole('combobox', { name: /type/i })).toHaveValue('electric');
    typeName('Pikachu');
    expect(onQueryChange).toHaveBeenCalledWith({ type: 'electric', name: 'Pikachu' });
  });

  it('renders the name input and explicit type, ability, and move selects', () => {
    renderSearch();
    expect(screen.getByRole('searchbox', { name: /search/i })).toBeVisible();
    expect(screen.getByRole('combobox', { name: /type/i })).toBeVisible();
    expect(screen.getByRole('combobox', { name: /ability/i })).toBeVisible();
    expect(screen.getByRole('combobox', { name: /move/i })).toBeVisible();
  });

  it('shows a hint and emits no route counts before any filter is set', () => {
    const { onRouteMatchCounts } = renderSearch();
    expect(screen.getByText(/name or pick a filter/i)).toBeVisible();
    expect(onRouteMatchCounts).toHaveBeenLastCalledWith(undefined);
  });

  it('keeps a whitespace-only controlled name inactive', () => {
    renderSearch();
    typeName('   ');
    settle();

    expect(screen.getByText(/name or pick a filter/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /select/i })).toBeNull();
  });

  it('debounces the name input before the result list updates', () => {
    renderSearch();
    typeName('Mankey');
    // Not yet: the debounce window has not elapsed.
    expect(screen.queryByRole('button', { name: /select Mankey/i })).toBeNull();
    settle();
    expect(screen.getByRole('button', { name: /select Mankey/i })).toBeVisible();
  });

  it('surfaces obtainability evidence: a wild species is Standard', () => {
    renderSearch();
    typeName('Mankey');
    settle();
    const result = screen.getByRole('button', { name: /select Mankey/i }).closest('li') as HTMLElement;
    expect(within(result).getByText(/Standard/i)).toBeVisible();
    expect(within(result).getByText(/Fighting/i)).toBeVisible();
    expect(within(result).getByText(/5 routes/i)).toBeVisible();
  });

  it('flags a transfer-only species as evidence', () => {
    renderSearch();
    typeName('Chikorita');
    settle();
    const result = screen.getByRole('button', { name: /select Chikorita/i }).closest('li') as HTMLElement;
    expect(within(result).getByText(/Transfer only/i)).toBeVisible();
  });

  it('intersects a type filter with the name filter', () => {
    renderSearch();
    fireEvent.change(screen.getByRole('combobox', { name: /type/i }), { target: { value: 'electric' } });
    // Selects apply immediately (no debounce), so Pikachu is present without advancing timers.
    expect(screen.getByRole('button', { name: /select Pikachu/i })).toBeVisible();
    // Mankey is fighting, not electric — excluded by the intersection.
    expect(screen.queryByRole('button', { name: /select Mankey/i })).toBeNull();
  });

  it('reports learn-method evidence when a move filter is active', () => {
    renderSearch();
    fireEvent.change(screen.getByRole('combobox', { name: /move/i }), { target: { value: 'thunderbolt' } });
    const result = screen.getByRole('button', { name: /select Pikachu/i }).closest('li') as HTMLElement;
    // A method is named and the FireRed validity is surfaced.
    expect(within(result).getByText(/level-up|machine|tutor/i)).toBeVisible();
    expect(within(result).getByText(/FireRed-legal|Transfer only/i)).toBeVisible();
  });

  it('selects a result into the caller-supplied inspector surface', () => {
    const { onSelectPokemon } = renderSearch();
    typeName('Mankey');
    settle();
    fireEvent.click(screen.getByRole('button', { name: /select Mankey/i }));
    expect(onSelectPokemon).toHaveBeenCalledWith(56);
  });

  it('emits per-route match counts for the active query', () => {
    const { onRouteMatchCounts } = renderSearch();
    typeName('Mankey');
    settle();
    const counts = onRouteMatchCounts.mock.calls.at(-1)?.[0] as Record<string, number>;
    expect(counts['kanto-route-22']).toBe(1);
  });
});
