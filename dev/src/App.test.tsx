import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { gamePackManifestUrl } from './data/manifest-url';

const manifest = {
  schemaVersion: 1,
  packVersion: 'firered-bootstrap-1',
  game: { id: 'firered', name: 'Pokémon FireRed', versionId: 10, versionGroupId: 7, generationId: 3 },
  sources: [{ id: 'pokeapi-api-data', revision: '0fb5313cb77f46269502e987a53a0bf751ae883d' }],
  files: {},
};

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('gamePackManifestUrl', () => {
  it('anchors the manifest at the root Vite base', () => {
    expect(gamePackManifestUrl('/')).toBe('/data/firered/manifest.json');
  });

  it('anchors the manifest at a project subpath Vite base', () => {
    expect(gamePackManifestUrl('/PokePlanner/')).toBe('/PokePlanner/data/firered/manifest.json');
  });
});

describe('App', () => {
  it('shows a validated FireRed pack revision', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest)));
    render(<App fetcher={fetcher} />);
    expect(await screen.findByText('FireRed data ready')).toBeVisible();
    expect(screen.getByText(/0fb5313c/)).toBeVisible();
  });

  it('shows a recoverable message when the pack cannot load', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    render(<App fetcher={fetcher} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('FireRed data could not be loaded');
  });

  it('fetches from the Vite base instead of a deep browser route', async () => {
    window.history.pushState({}, '', '/PokePlanner/routes/deep');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest)));
    render(<App fetcher={fetcher} baseUrl="/PokePlanner/" />);
    await screen.findByText('FireRed data ready');
    expect(fetcher).toHaveBeenCalledWith('/PokePlanner/data/firered/manifest.json');
  });

  it('returns to a polite loading status when its fetcher changes', async () => {
    const firstFetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(manifest)));
    const secondFetcher = vi.fn(() => new Promise<Response>(() => {}));
    const { rerender } = render(<App fetcher={firstFetcher} baseUrl="/" />);
    await screen.findByText('FireRed data ready');

    rerender(<App fetcher={secondFetcher} baseUrl="/" />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading FireRed data…');
  });
});
