import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadFireRedPack, type FireRedDigest, type FireRedPack } from './data/game-pack';
import { MILESTONE_ORDER } from './domain/availability';
import { type Playthrough, type PlaythroughPackIndex } from './domain/playthrough';
import { preparePlaythroughImport, serializePlaythroughExport } from './persistence/export-import';
import {
  MemoryPlaythroughRepository,
  type PlaythroughRepository,
  type RepositoryOptions,
} from './persistence/repository';
import { openIndexedDbRepository } from './persistence/indexeddb-repository';
import { GameSetup } from './features/setup/GameSetup';
import { Workbench } from './features/workbench/Workbench';

/** Build the injected id-resolution surface from a loaded pack; embeds no canonical data. */
function packIndexOf(pack: FireRedPack): PlaythroughPackIndex {
  const pokemonById = new Map(pack.pokemon.map((record) => [record.id, record]));
  const learnsetByPokemon = new Map(pack.learnsets.map((record) => [record.pokemonId, record]));
  const milestones = new Set<string>(MILESTONE_ORDER);
  const acquisitions = new Set(pack.acquisitions.map((record) => record.id));
  return {
    hasSpecies: (id) => pokemonById.has(id),
    legalAbilityIds: (id) => pokemonById.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id, moveId) =>
      (learnsetByPokemon.get(id)?.moves ?? []).some((move) => move.moveId === moveId),
    hasMilestone: (id) => milestones.has(id),
    hasAcquisition: (id) => acquisitions.has(id),
  };
}

/** The default browser SHA-256 digest; injectable so tests supply a deterministic one. */
const subtleDigest: FireRedDigest = (bytes) => crypto.subtle.digest('SHA-256', bytes as BufferSource);

/** Open a repository for the given options. Factory-shaped so tests inject a memory/failing adapter. */
export type OpenRepository = (options: RepositoryOptions) => Promise<PlaythroughRepository>;

const openIndexedDb: OpenRepository = (options) => openIndexedDbRepository(indexedDB, options);

export interface AppProps {
  fetcher?: typeof fetch;
  digest?: FireRedDigest;
  baseUrl?: string;
  openRepository?: OpenRepository;
  now?: () => number;
  createId?: () => string;
}

type BootState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; pack: PlaythroughPackIndex; repo: PlaythroughRepository; temporary: boolean };

function mostRecent(records: Playthrough[]): Playthrough | null {
  if (records.length === 0) return null;
  return [...records].sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

/**
 * The application boundary coordinator. It performs the whole boot flow — load and hash-verify the
 * FireRed pack, open the persistence repository (falling back to an explicit in-memory session when
 * IndexedDB is unavailable), then list, restore, or create a playthrough — before rendering either
 * game setup or the workbench. Only validated playthrough records are ever written; a corrupt pack
 * surfaces an actionable error instead of a partial UI, and a failed import never overwrites the
 * saved record. FireRed canonical data stays in the pack and is never persisted.
 */
export function App({
  fetcher = fetch,
  digest = subtleDigest,
  baseUrl = import.meta.env.BASE_URL,
  openRepository = openIndexedDb,
  now = Date.now,
  createId = () => crypto.randomUUID(),
}: AppProps) {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });
  const [active, setActive] = useState<Playthrough | null>(null);
  const [pack, setPack] = useState<FireRedPack | null>(null);
  const [exportText, setExportText] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setBoot({ status: 'loading' });
    setActive(null);
    setPack(null);

    (async () => {
      let loaded: FireRedPack;
      try {
        loaded = await loadFireRedPack(fetcher, digest, baseUrl, controller.signal);
      } catch (error) {
        if (alive) {
          setBoot({
            status: 'error',
            message: error instanceof Error ? error.message : 'FireRed data could not be loaded.',
          });
        }
        return;
      }
      if (!alive) return;

      const index = packIndexOf(loaded);
      const options: RepositoryOptions = { pack: index, now };
      let repo: PlaythroughRepository;
      let temporary = false;
      try {
        repo = await openRepository(options);
      } catch {
        repo = new MemoryPlaythroughRepository(options);
        temporary = true;
      }
      if (!alive) return;

      let restored: Playthrough | null = null;
      try {
        restored = mostRecent(await repo.list());
      } catch {
        restored = null;
      }
      if (!alive) return;

      setPack(loaded);
      setActive(restored);
      setBoot({ status: 'ready', pack: index, repo, temporary });
    })();

    return () => {
      alive = false;
      controller.abort();
    };
  }, [fetcher, digest, baseUrl, openRepository, now]);

  const persist = useCallback(
    async (record: Playthrough): Promise<void> => {
      if (boot.status !== 'ready') return;
      // The repository validates against the schema + pack index before it writes, so an invalid or
      // canonical-tainted record can never reach storage; the returned record is the validated one.
      const stored = await boot.repo.put(record);
      setActive(stored);
      setExportText(null);
    },
    [boot],
  );

  const handleCreate = (record: Playthrough): void => {
    void persist(record);
  };

  const handleChange = (record: Playthrough): void => {
    void persist(record);
  };

  const handleExport = (): void => {
    if (active !== null) setExportText(serializePlaythroughExport(active));
  };

  const handleImport = (): void => {
    if (boot.status !== 'ready') return;
    let imported: Playthrough;
    try {
      imported = preparePlaythroughImport(importText, boot.pack);
    } catch (error) {
      // Validation ran before any write, so the existing record is preserved untouched.
      setImportError(error instanceof Error ? error.message : 'Import failed validation.');
      return;
    }
    setImportError(null);
    setImportText('');
    void persist(imported);
  };

  return (
    <main className="app-shell">
      <header className="app-header">
        <p className="eyebrow">Generation III vertical slice</p>
        <h1>PokéPlanner</h1>
      </header>

      {boot.status === 'loading' && <p role="status">Loading FireRed data…</p>}

      {boot.status === 'error' && (
        <p role="alert" className="app-error">
          FireRed data could not be loaded: {boot.message} Reload to try again.
        </p>
      )}

      {boot.status === 'ready' && (
        <>
          {boot.temporary && (
            <p role="status" className="app-banner">
              Temporary session — changes are not saved to this browser. Export your run to keep it.
            </p>
          )}

          {active !== null && (
            <section className="app-tools" aria-label="Run data">
              <div className="app-tool">
                <button type="button" className="app-tool-button" onClick={handleExport}>
                  Export run
                </button>
                {exportText !== null && (
                  <textarea
                    className="app-export"
                    aria-label="Playthrough export JSON"
                    readOnly
                    value={exportText}
                    rows={6}
                  />
                )}
              </div>
              <div className="app-tool">
                <label className="app-tool-label" htmlFor="app-import">Import run JSON</label>
                <textarea
                  id="app-import"
                  className="app-import"
                  value={importText}
                  onChange={(event) => setImportText(event.target.value)}
                  rows={3}
                />
                <button type="button" className="app-tool-button" onClick={handleImport}>
                  Import run
                </button>
                {importError !== null && (
                  <p role="alert" className="app-error">Import failed: {importError}</p>
                )}
              </div>
            </section>
          )}

          {pack !== null && active === null && (
            <GameSetup pack={pack} onCreate={handleCreate} createId={createId} now={now} />
          )}

          {pack !== null && active !== null && (
            <Workbench pack={pack} playthrough={active} onPlaythroughChange={handleChange} now={now} />
          )}
        </>
      )}
    </main>
  );
}
