import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import type { FireRedDigest } from './data/game-pack';
import { openIndexedDbRepository } from './persistence/indexeddb-repository';
import type { RepositoryOptions } from './persistence/repository';
import './styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Expected #root application mount');
}

/** The real Web Crypto SHA-256 digest used to verify every content-addressed pack asset. */
const digest: FireRedDigest = (bytes) => crypto.subtle.digest('SHA-256', bytes as BufferSource);

/** The real client-local IndexedDB repository; `indexedDB` is read lazily at boot. */
const openRepository = (options: RepositoryOptions) => openIndexedDbRepository(indexedDB, options);

/** Bind `fetch` to the window so the loader can call it without an illegal-invocation error. */
const boundFetch: typeof fetch = (input, init) => fetch(input, init);

createRoot(root).render(
  <StrictMode>
    <App fetcher={boundFetch} digest={digest} openRepository={openRepository} />
  </StrictMode>,
);
