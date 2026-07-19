import { useEffect, useState } from 'react';
import { loadGamePackManifest, type GamePackManifest } from './data/manifest';
import { gamePackManifestUrl } from './data/manifest-url';

interface AppProps {
  fetcher?: typeof fetch;
  baseUrl?: string;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; manifest: GamePackManifest }
  | { status: 'error' };

export function App({ fetcher = fetch, baseUrl = import.meta.env.BASE_URL }: AppProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const manifestUrl = gamePackManifestUrl(baseUrl);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });

    loadGamePackManifest(fetcher, manifestUrl)
      .then((manifest) => {
        if (active) setState({ status: 'ready', manifest });
      })
      .catch(() => {
        if (active) setState({ status: 'error' });
      });

    return () => {
      active = false;
    };
  }, [fetcher, manifestUrl]);

  return (
    <main className="app-shell">
      <header>
        <p className="eyebrow">Generation III vertical slice</p>
        <h1>PokéPlanner</h1>
      </header>
      {state.status === 'loading' && <p role="status">Loading FireRed data…</p>}
      {state.status === 'error' && <p role="alert">FireRed data could not be loaded. Reload to try again.</p>}
      {state.status === 'ready' && (
        <section aria-labelledby="data-status-heading">
          <h2 id="data-status-heading">FireRed data ready</h2>
          <p>Source revision <code>{state.manifest.sources[0].revision.slice(0, 8)}</code></p>
        </section>
      )}
    </main>
  );
}
