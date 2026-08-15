import { useCallback, useEffect, useRef, useState } from 'react';
import { loadFireRedPack, type FireRedDigest, type FireRedPack } from './data/game-pack';
import { MILESTONE_ORDER } from './domain/availability';
import { parsePlaythrough, type Playthrough, type PlaythroughPackIndex } from './domain/playthrough';
import { FIRE_RED_RULES } from './domain/rules/firered-rules';
import { createPlaythroughDownloadHref } from './persistence/export-import';
import { prepareRunImport } from './persistence/import-source';
import {
  MemoryPlaythroughRepository,
  type PlaythroughRepository,
  type RepositoryOptions,
} from './persistence/repository';
import { openIndexedDbRepository } from './persistence/indexeddb-repository';
import { GameSetup } from './features/setup/GameSetup';
import { RunMenu, type RunSaveStatus } from './features/workbench/RunMenu';
import { Workbench } from './features/workbench/Workbench';
import { applyTheme, readStoredTheme, type Theme } from './theme';

/** Build the injected id-resolution surface from a loaded pack; embeds no canonical data. */
function packIndexOf(pack: FireRedPack): PlaythroughPackIndex {
  const pokemonById = new Map(pack.pokemon.map((record) => [record.id, record]));
  const learnsetByPokemon = new Map(pack.learnsets.map((record) => [record.pokemonId, record]));
  const milestones = new Set<string>([
    ...MILESTONE_ORDER,
    ...FIRE_RED_RULES.milestones.map((milestone) => milestone.id),
  ]);
  const acquisitions = new Set(pack.acquisitions.map((record) => record.id));
  const nodes = new Set(pack.progression.nodes.map((node) => node.id));
  return {
    hasSpecies: (id) => pokemonById.has(id),
    legalAbilityIds: (id) => pokemonById.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id, moveId) =>
      (learnsetByPokemon.get(id)?.moves ?? []).some((move) => move.moveId === moveId),
    hasMilestone: (id) => milestones.has(id),
    hasAcquisition: (id) => acquisitions.has(id),
    hasNode: (id) => nodes.has(id) || milestones.has(id),
    starterNodeId: () => FIRE_RED_RULES.initialProgress().currentNodeId,
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
  | {
      status: 'repository-error';
      message: string;
      pack: PlaythroughPackIndex;
      repo: PlaythroughRepository;
      temporary: boolean;
    }
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
  const [lastDurable, setLastDurable] = useState<Playthrough | null>(null);
  const [activeDraft, setActiveDraft] = useState<Playthrough | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [repositoryRetrying, setRepositoryRetrying] = useState(false);
  const saveAttempt = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const repositoryGeneration = useRef(0);
  const [pack, setPack] = useState<FireRedPack | null>(null);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  // Keep the document and localStorage in step with the chosen theme; dark is the default.
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setBoot({ status: 'loading' });
    saveAttempt.current += 1;
    repositoryGeneration.current += 1;
    saveQueue.current = Promise.resolve();
    setLastDurable(null);
    setActiveDraft(null);
    setSaveError(null);
    setRepositoryRetrying(false);
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
      } catch (error) {
        if (alive) {
          setPack(loaded);
          setBoot({
            status: 'repository-error',
            message: error instanceof Error ? error.message : 'The saved-run repository could not be read.',
            pack: index,
            repo,
            temporary,
          });
        }
        return;
      }
      if (!alive) return;

      setPack(loaded);
      setLastDurable(restored);
      setActiveDraft(restored);
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
      const attempt = ++saveAttempt.current;
      const generation = repositoryGeneration.current;
      // The draft becomes the rendered source of truth immediately; persistence success only
      // advances the durable checkpoint and must never be required to keep an edit on screen.
      setActiveDraft(record);
      // The repository validates against the schema + pack index before it writes, so an invalid or
      // canonical-tainted record can never reach storage; the returned record is the validated one.
      // Serialize writes so an older request cannot finish after and overwrite a newer draft.
      const operation = saveQueue.current.then(() => boot.repo.put(record));
      saveQueue.current = operation.then(
        () => undefined,
        () => undefined,
      );
      try {
        const stored = await operation;
        if (repositoryGeneration.current === generation) setLastDurable(stored);
        if (saveAttempt.current === attempt) {
          setActiveDraft(stored);
          setSaveError(null);
        }
      } catch (error) {
        if (saveAttempt.current === attempt) {
          setSaveError(error instanceof Error ? error.message : 'The save failed.');
        }
      }
    },
    [boot],
  );

  const handleCreate = (record: Playthrough): void => {
    void persist(record);
  };

  const handleChange = (record: Playthrough): void => {
    void persist(record);
  };

  /**
   * The one import path for every source. Validation and migration happen here, against the loaded
   * pack, and nothing is written — the menu previews the result and only a confirmation calls back
   * into `persist`, so a rejected or cancelled import leaves the stored record untouched.
   */
  const prepareImport = (input: string) => {
    if (boot.status !== 'ready') throw new Error('FireRed data is still loading.');
    return prepareRunImport(input, boot.pack, pack?.manifest.packVersion);
  };

  const handleRename = (name: string): void => {
    if (boot.status !== 'ready' || activeDraft === null) return;
    void persist(parsePlaythrough({ ...activeDraft, name, updatedAt: now() }, boot.pack));
  };

  const handleDuplicate = (): void => {
    if (boot.status !== 'ready' || activeDraft === null) return;
    void persist(parsePlaythrough({
      ...activeDraft,
      id: createId(),
      name: `${activeDraft.name} (copy)`,
      createdAt: now(),
      updatedAt: now(),
    }, boot.pack));
  };

  const handleDelete = async (): Promise<void> => {
    if (boot.status !== 'ready' || activeDraft === null) return;
    const generation = repositoryGeneration.current;
    saveAttempt.current += 1;
    try {
      await boot.repo.delete(activeDraft.id);
      const remaining = mostRecent(await boot.repo.list());
      if (repositoryGeneration.current !== generation) return;
      setLastDurable(remaining);
      setActiveDraft(remaining);
      setSaveError(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The run could not be deleted.');
    }
  };

  const retryRepositoryLoad = async (): Promise<void> => {
    if (boot.status !== 'repository-error' || repositoryRetrying) return;
    setRepositoryRetrying(true);
    try {
      const restored = mostRecent(await boot.repo.list());
      setLastDurable(restored);
      setActiveDraft(restored);
      setBoot({ status: 'ready', pack: boot.pack, repo: boot.repo, temporary: boot.temporary });
    } catch (error) {
      setBoot((current) =>
        current.status === 'repository-error'
          ? {
              ...current,
              message: error instanceof Error ? error.message : 'The saved-run repository could not be read.',
            }
          : current,
      );
    } finally {
      setRepositoryRetrying(false);
    }
  };

  const temporary = boot.status === 'ready' && boot.temporary;
  const saveStatus: RunSaveStatus = saveError !== null
    ? 'failed'
    : temporary
      ? 'temporary'
      : activeDraft === null
        ? 'none'
        : activeDraft === lastDurable
          ? 'saved'
          : 'unsaved';

  const runMenu = (
    <RunMenu
      playthrough={activeDraft}
      saveStatus={saveStatus}
      theme={theme}
      onThemeChange={setTheme}
      prepareImport={prepareImport}
      onImport={(imported) => void persist(imported)}
      onRename={handleRename}
      onDuplicate={handleDuplicate}
      onDelete={() => void handleDelete()}
    />
  );

  const unsavedDownload = saveError !== null && activeDraft !== null
    ? createPlaythroughDownloadHref(activeDraft)
    : null;

  // Recovery surfaces, kept out of the rungs: a temporary session and a failed save both preserve
  // whatever is on screen and keep an export within one click of the failure itself.
  const notices = (
    <>
      {temporary && (
        <p role="status" className="app-banner">
          Changes are not saved to this browser. Download JSON or copy a plan code to keep this run.
        </p>
      )}
      {saveError !== null && activeDraft !== null && unsavedDownload !== null && (
        <div role="alert" className="app-error">
          <p>
            Changes are not saved: {saveError}.{' '}
            {lastDurable === null
              ? 'This run has not been saved yet.'
              : 'The last saved version remains safe.'}
          </p>
          <button type="button" className="app-tool-button" onClick={() => void persist(activeDraft)}>
            Retry save
          </button>
          <a className="app-tool-button" href={unsavedDownload.href} download={unsavedDownload.filename}>
            Export unsaved changes
          </a>
        </div>
      )}
    </>
  );

  // With a run open the workbench shell owns the whole viewport, header included; before there is
  // one, the same run menu rides the setup header so import and theme are never out of reach.
  if (boot.status === 'ready' && pack !== null && activeDraft !== null) {
    return (
      <Workbench
        pack={pack}
        playthrough={activeDraft}
        onPlaythroughChange={handleChange}
        now={now}
        createId={createId}
        runMenu={runMenu}
        notices={notices}
      />
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-header-titles">
          <p className="eyebrow">Generation III vertical slice</p>
          <h1>PokéPlanner</h1>
        </div>
        {boot.status === 'ready' && runMenu}
      </header>

      {boot.status === 'loading' && <p role="status">Loading FireRed data…</p>}

      {boot.status === 'error' && (
        <p role="alert" className="app-error">
          FireRed data could not be loaded: {boot.message} Reload to try again.
        </p>
      )}

      {boot.status === 'repository-error' && (
        <div role="alert" className="app-error">
          <p>
            Saved runs could not be read or migrated: {boot.message}. Your browser data was left unchanged.
          </p>
          <button
            type="button"
            className="app-tool-button"
            disabled={repositoryRetrying}
            onClick={() => void retryRepositoryLoad()}
          >
            {repositoryRetrying ? 'Retrying saved runs…' : 'Retry loading saved runs'}
          </button>
        </div>
      )}

      {boot.status === 'ready' && (
        <>
          {notices}
          {pack !== null && <GameSetup pack={pack} onCreate={handleCreate} createId={createId} now={now} />}
        </>
      )}
    </main>
  );
}
