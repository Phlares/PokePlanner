import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const manifest = {
  schemaVersion: 1,
  packVersion: 'firered-bootstrap-1',
  game: { id: 'firered', name: 'Pokémon FireRed', versionId: 10, versionGroupId: 7, generationId: 3 },
  sources: [{ id: 'pokeapi-api-data', revision: '0fb5313cb77f46269502e987a53a0bf751ae883d' }],
  files: {},
};

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
});
