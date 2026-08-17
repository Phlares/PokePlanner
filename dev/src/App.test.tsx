import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { MILESTONE_ORDER } from './domain/availability';
import type { Playthrough } from './domain/playthrough';
import { encodePlanCode } from './persistence/plan-code';
import {
  MemoryPlaythroughRepository,
  type PlaythroughRepository,
  type RepositoryOptions,
} from './persistence/repository';
import {
  loadFireRedPackFixture,
} from './test/firered-pack';

const PACK_DIR = resolve(process.cwd(), 'public/data/firered');
const pack = loadFireRedPackFixture();

/** Serve the committed pack bytes so the App boot exercises the real load + hash-verify path. */
function realFetcher(): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const rel = url.slice(url.indexOf('data/firered/') + 'data/firered/'.length);
    return new Response(readFileSync(resolve(PACK_DIR, rel)));
  }) as unknown as typeof fetch;
}

const realDigest = async (bytes: Uint8Array): Promise<string> =>
  createHash('sha256').update(bytes).digest('hex');

function packIndex() {
  const byId = new Map(pack.pokemon.map((record) => [record.id, record]));
  const milestones = new Set<string>(MILESTONE_ORDER);
  const acquisitions = new Set(pack.acquisitions.map((record) => record.id));
  return {
    hasSpecies: (id: number) => byId.has(id),
    legalAbilityIds: (id: number) => byId.get(id)?.abilities.map((ability) => ability.id) ?? [],
    isVersionValidMove: (id: number, moveId: number) =>
      (pack.learnsets.find((record) => record.pokemonId === id)?.moves ?? []).some((move) => move.moveId === moveId),
    hasMilestone: (id: string) => milestones.has(id),
    hasAcquisition: (id: string) => acquisitions.has(id),
    hasNode: (id: string) => id === 'starter-selection' || milestones.has(id),
    starterNodeId: () => 'starter-selection',
  };
}

/** A single shared in-memory repository, so an unmount/remount can restore the saved run. */
function sharedRepoFactory(seed?: MemoryPlaythroughRepository) {
  let repo = seed;
  const factory = async (options: RepositoryOptions): Promise<PlaythroughRepository> => {
    repo ??= new MemoryPlaythroughRepository(options);
    return repo;
  };
  return { factory, get: () => repo };
}

function seededRepoFactory(record: Playthrough) {
  let repo: MemoryPlaythroughRepository | undefined;
  const factory = async (options: RepositoryOptions): Promise<PlaythroughRepository> => {
    if (!repo) {
      repo = new MemoryPlaythroughRepository(options);
      await repo.put(record);
    }
    return repo;
  };
  return { factory, get: () => repo };
}

function baseProps(overrides: Partial<Parameters<typeof App>[0]> = {}) {
  let counter = 0;
  return {
    fetcher: realFetcher(),
    digest: realDigest,
    baseUrl: '/',
    now: () => 1000,
    createId: () => `id-${(counter += 1)}`,
    ...overrides,
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function createRun(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /start firered/i }));
  await screen.findByRole('region', { name: /team timeline/i });
}

function openRunMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Run menu' }));
}

/** Lift the milestone scope, which is how the results surface reveals milestones past the target. */
function revealFutureMilestones(): void {
  fireEvent.click(screen.getByRole('checkbox', { name: 'Filter by milestone' }));
}

function openImportDialog(): void {
  openRunMenu();
  fireEvent.click(screen.getByRole('menuitem', { name: 'Import JSON file or plan code' }));
}

function pasteImport(text: string): void {
  fireEvent.change(screen.getByLabelText('Plan code or share link'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Preview import' }));
}

/** Read back what a download control actually hands the user: the encoded run behind its href. */
function downloadText(link: HTMLElement): string {
  const href = link.getAttribute('href') ?? '';
  return decodeURIComponent(href.slice(href.indexOf(',') + 1));
}

function downloadedRun(): Playthrough {
  return JSON.parse(downloadText(screen.getByRole('menuitem', { name: 'Download JSON' })));
}

function regionLabels(): (string | null)[] {
  return screen.getAllByRole('region').map((node) => node.getAttribute('aria-label'));
}

afterEach(cleanup);

describe('App boot and persistence', () => {
  it('shows game setup when there are no saved records', async () => {
    const { factory } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    expect(await screen.findByText(/set up a run/i)).toBeVisible();
    // The header is honest about there being nothing to save yet, rather than claiming either state.
    expect(screen.getByText('No run yet')).toBeVisible();
  });

  it('blocks normal setup and retries the original repository when saved records cannot be listed', async () => {
    const list = vi.fn()
      .mockRejectedValueOnce(new Error('legacy migration failed'))
      .mockResolvedValueOnce([]);
    const put = vi.fn();
    const remove = vi.fn();
    const factory = vi.fn(async (): Promise<PlaythroughRepository> => ({
      list,
      get: vi.fn(),
      put,
      delete: remove,
    }));

    render(<App {...baseProps({ openRepository: factory })} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/saved runs.*could not be (read|loaded|migrated)/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/left unchanged/i);
    expect(screen.queryByText(/set up a run/i)).toBeNull();
    expect(screen.queryByRole('region', { name: /team timeline/i })).toBeNull();
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    // The recovery screen is not a dead end: theme and import stay reachable while it is up.
    openRunMenu();
    expect(screen.getByRole('menuitemcheckbox', { name: 'Dark theme' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Import JSON file or plan code' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: /retry loading saved runs/i }));

    expect(await screen.findByText(/set up a run/i)).toBeVisible();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('creates the selected starter member and targets Brock', async () => {
    const { factory, get } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Charmander' }));
    fireEvent.click(screen.getByRole('button', { name: 'Start FireRed' }));

    await screen.findByRole('region', { name: /team timeline/i });
    await waitFor(async () => expect((await get()!.list()).length).toBe(1));
    const saved = (await get()!.list())[0];
    const starterMemberId = Object.keys(saved.timeline.members)[0];
    expect(saved.currentMilestoneId).toBe('starter');
    expect(saved.previewMilestoneId).toBe('brock-gym');
    expect(saved.timeline.members[starterMemberId].originalSpeciesId).toBe(4);
    expect(saved.timeline.keyframes.starter.party[0]).toBe(starterMemberId);
    expect(screen.getByRole('button', { name: /preview milestone.*brock/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('restores the saved run after a reload', async () => {
    const { factory } = sharedRepoFactory();
    const props = baseProps({ openRepository: factory });
    const first = render(<App {...props} />);
    await createRun();
    first.unmount();

    render(<App {...props} />);
    // No setup this time — the saved run is restored straight into the workbench.
    expect(await screen.findByRole('region', { name: /team timeline/i })).toBeVisible();
    expect(screen.queryByText(/set up a run/i)).toBeNull();
  });

  it('saves after a milestone edit in the workbench', async () => {
    const { factory, get } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    fireEvent.click(screen.getByRole('button', { name: /set current milestone.*brock/i }));
    await waitFor(async () => {
      const records = await get()!.list();
      expect(records[0].currentMilestoneId).toBe('brock-gym');
    });
    await waitFor(() => expect(screen.getByText('Saved')).toBeVisible());
    expect(screen.queryByText('Unsaved changes')).toBeNull();
  });

  it('keeps the latest rapid edit durable when save completions arrive in reverse order', async () => {
    let repo: MemoryPlaythroughRepository | undefined;
    let putCount = 0;
    const brockSave = deferred();
    const mistySave = deferred();
    const factory = async (options: RepositoryOptions): Promise<PlaythroughRepository> => {
      repo ??= new MemoryPlaythroughRepository(options);
      return {
        list: () => repo!.list(),
        get: (id) => repo!.get(id),
        put: async (record) => {
          putCount += 1;
          if (putCount > 1) {
            const completion = record.currentMilestoneId === 'brock-gym' ? brockSave : mistySave;
            await completion.promise;
          }
          return repo!.put(record);
        },
        delete: (id) => repo!.delete(id),
      };
    };
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    await waitFor(() => expect(putCount).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /set current milestone.*brock/i }));
    revealFutureMilestones();
    fireEvent.click(screen.getByRole('button', { name: /set current milestone.*misty/i }));

    // Both writes are still in flight, so the header says so rather than claiming a durable save.
    expect(screen.getByText('Unsaved changes')).toBeVisible();
    expect(screen.queryByText('Saved')).toBeNull();

    await act(async () => {
      mistySave.resolve();
      await Promise.resolve();
      brockSave.resolve();
    });

    await waitFor(async () => {
      expect((await repo!.list())[0].currentMilestoneId).toBe('misty-gym');
    });
    expect(screen.getByRole('button', { name: /set current milestone.*misty/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('keeps unsaved edits rendered and offers Retry and Export when a write fails', async () => {
    let repo: MemoryPlaythroughRepository | undefined;
    let putCount = 0;
    const factory = async (options: RepositoryOptions): Promise<PlaythroughRepository> => {
      repo ??= new MemoryPlaythroughRepository(options);
      return {
        list: () => repo!.list(),
        get: (id) => repo!.get(id),
        put: async (record) => {
          putCount += 1;
          if (putCount === 2) throw new Error('disk full');
          return repo!.put(record);
        },
        delete: (id) => repo!.delete(id),
      };
    };
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    await waitFor(() => expect(putCount).toBe(1));

    fireEvent.click(screen.getByRole('button', { name: /set current milestone.*brock/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not saved/i);
    expect(screen.getByText('Save failed')).toBeVisible();
    expect(screen.getByRole('button', { name: /set current milestone.*brock/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Retry save' })).toBeEnabled();
    expect((await repo!.list())[0].currentMilestoneId).toBe('starter');

    // Export stays immediately available on the failure itself, carrying the unsaved edit.
    const unsaved = JSON.parse(downloadText(screen.getByRole('link', { name: 'Export unsaved changes' })));
    expect(unsaved.currentMilestoneId).toBe('brock-gym');

    fireEvent.click(screen.getByRole('button', { name: 'Retry save' }));
    await waitFor(() => expect(screen.queryByText(/not saved/i)).toBeNull());
    expect((await repo!.list())[0].currentMilestoneId).toBe('brock-gym');
  });

  it('centres the workbench on the team by placing its rung before the workspace', async () => {
    const { factory } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();

    const regions = regionLabels();
    expect(regions).toContain('Team at Brock');
    expect(regions).toContain('Workbench results');
    expect(regions.indexOf('Team at Brock')).toBeLessThan(regions.indexOf('Workbench results'));
  });

  it('moves run data out of prime space into one menu', async () => {
    const { factory } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();

    expect(screen.queryByLabelText('Playthrough export JSON')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Import run JSON')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Run data' })).toBeNull();

    openRunMenu();
    expect(screen.getByRole('menuitem', { name: 'Download JSON' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy plan code' })).toBeInTheDocument();
  });

  it('exports the active run as validated JSON', async () => {
    const { factory } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    openRunMenu();
    const text = downloadText(screen.getByRole('menuitem', { name: 'Download JSON' }));
    expect(text).toContain('"schemaVersion": 2');
    expect(text).toContain('"game": "firered"');
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('renames, duplicates and deletes the run from the same menu', async () => {
    const { factory, get } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();

    openRunMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename run' }));
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Renamed run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(async () => expect((await get()!.list())[0].name).toBe('Renamed run'));

    openRunMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate run' }));
    await waitFor(async () => expect(await get()!.list()).toHaveLength(2));
    const copy = (await get()!.list()).find((record) => record.name === 'Renamed run (copy)');
    expect(copy).toBeDefined();
    expect(copy!.id).not.toBe((await get()!.list()).find((record) => record.name === 'Renamed run')!.id);

    openRunMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete run' }));
    expect(await get()!.list()).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(async () => expect(await get()!.list()).toHaveLength(1));
    expect((await get()!.list())[0].name).toBe('Renamed run');
  });

  it('lets a queued save finish before it deletes, so nothing is resurrected', async () => {
    let repo: MemoryPlaythroughRepository | undefined;
    const completions: string[] = [];
    let putCount = 0;
    const blocked = deferred();
    const factory = async (options: RepositoryOptions): Promise<PlaythroughRepository> => {
      repo ??= new MemoryPlaythroughRepository(options);
      return {
        list: () => repo!.list(),
        get: (id) => repo!.get(id),
        put: async (record) => {
          putCount += 1;
          if (putCount === 2) await blocked.promise;
          const stored = await repo!.put(record);
          completions.push('put');
          return stored;
        },
        delete: async (id) => {
          await repo!.delete(id);
          completions.push('delete');
        },
      };
    };
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    await waitFor(() => expect(completions).toEqual(['put']));

    fireEvent.click(screen.getByRole('button', { name: /set current milestone.*brock/i }));
    openRunMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    // The write is still blocked, so the delete must not have overtaken it.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(completions).toEqual(['put']);

    await act(async () => {
      blocked.resolve();
      await Promise.resolve();
    });

    // Order is the whole point: a delete that ran first would be undone by the write behind it.
    await waitFor(() => expect(completions).toEqual(['put', 'put', 'delete']));
    expect(await repo!.list()).toHaveLength(0);
  });

  it('returns to setup with focus on the run menu after the last run is deleted', async () => {
    const { factory, get } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();

    openRunMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));

    expect(await screen.findByText(/set up a run/i)).toBeVisible();
    expect(await get()!.list()).toHaveLength(0);
    // The run menu is remounted in the setup header; focus has to follow it there, not fall to body.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run menu' })).toHaveFocus());
  });

  it('reaches every stored run from the menu after a duplicate', async () => {
    const { factory, get } = sharedRepoFactory();
    // A moving clock, so the two runs are distinguishable by age and the newest sorts first —
    // which puts the run this test switches to *second* in the list rather than at the top.
    let clock = 1000;
    render(<App {...baseProps({ openRepository: factory, now: () => (clock += 1) })} />);
    await createRun();

    // Whole-string, not `toHaveTextContent`: a duplicate is named after the run it copies, so
    // "Original" is a substring of "Original (copy)" and a containment check would call the switch
    // a success without it having happened.
    const openRunName = (): string | null => screen.getByRole('heading', { level: 1 }).textContent;

    openRunMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename run' }));
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Original' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(openRunName()).toBe('Original'));

    openRunMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Duplicate run' }));
    await waitFor(() => expect(openRunName()).toBe('Original (copy)'));

    openRunMenu();
    expect(screen.getAllByRole('menuitemradio').map((entry) => entry.textContent)).toEqual([
      'Original (copy)',
      'Original',
    ]);
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Original' }));

    // The duplicate is still stored; switching just changes which run is open.
    await waitFor(() => expect(openRunName()).toBe('Original'));
    // What was opened came straight out of storage, so it is durable — reporting it as unsaved
    // would invite a pointless rewrite of a record nothing has touched.
    expect(screen.getByText('Saved')).toBeVisible();
    expect(await get()!.list()).toHaveLength(2);
  });

  it('preserves the existing record when an import fails validation', async () => {
    const { factory, get } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    const before = await get()!.list();

    openImportDialog();
    pasteImport('{ not valid json');

    expect(await screen.findByRole('alert')).toHaveTextContent(/import/i);
    // The workbench and stored record are untouched — no overwrite on failure.
    expect(screen.getByRole('region', { name: /team timeline/i })).toBeVisible();
    const after = await get()!.list();
    expect(after).toEqual(before);
  });

  it('sanitizes stale workbench selections when an imported run replaces the mounted one', async () => {
    const { factory, get } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();

    // Plan against Misty so Cerulean City is inside the target's scope, then select it. Misty is
    // past the run's own target, so the scope is lifted to reach it and put back once it is set.
    revealFutureMilestones();
    fireEvent.click(screen.getByRole('button', { name: /preview milestone.*misty/i }));
    await waitFor(async () => expect((await get()!.list())[0].previewMilestoneId).toBe('misty-gym'));
    revealFutureMilestones();
    fireEvent.click(screen.getByRole('button', { name: 'Cerulean City' }));
    expect(within(screen.getByRole('region', { name: 'Route detail' }))
      .getByRole('heading', { name: 'Cerulean City' }).textContent).toBe('Cerulean City');

    openRunMenu();
    const exported = downloadedRun();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import JSON file or plan code' }));
    pasteImport(JSON.stringify({
      ...exported,
      id: 'imported-run',
      name: 'Imported run',
      previewMilestoneId: 'brock-gym',
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Import run' }));

    // The import replaces the durable target under a still-mounted workbench.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /preview milestone.*brock/i })).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.queryByRole('heading', { name: 'Cerulean City' })).toBeNull();
  });

  it('shows an actionable error and no partial UI when the pack is corrupt', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch;
    const { factory } = sharedRepoFactory();
    render(<App {...baseProps({ fetcher, openRepository: factory })} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not|failed|unable/i);
    expect(screen.queryByText(/set up a run/i)).toBeNull();
    expect(screen.queryByRole('region', { name: /team timeline/i })).toBeNull();
  });

  it('falls back to a labeled temporary session with working export when IndexedDB fails', async () => {
    const failingFactory = async (): Promise<PlaythroughRepository> => {
      throw new Error('IndexedDB is unavailable');
    };
    render(<App {...baseProps({ openRepository: failingFactory })} />);
    // A new run still works, held only in memory, with a visible temporary-session banner.
    await createRun();
    expect(screen.getByText(/not saved to this browser/i)).toBeVisible();
    expect(screen.getByText('Temporary session')).toBeVisible();
    openRunMenu();
    expect(downloadText(screen.getByRole('menuitem', { name: 'Download JSON' }))).toContain('"game": "firered"');
    expect(screen.getByRole('menuitem', { name: 'Copy plan code' })).toBeInTheDocument();
  });

  it('never writes FireRed canonical data to storage', async () => {
    const putSpy = vi.spyOn(MemoryPlaythroughRepository.prototype, 'put');
    const { factory, get } = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: factory })} />);
    await createRun();
    fireEvent.click(screen.getByRole('button', { name: /set current milestone.*brock/i }));
    await waitFor(() => expect(putSpy).toHaveBeenCalled());

    const canonicalKeys = ['pokemon', 'moves', 'encounters', 'learnsets', 'typeChart', 'indexes', 'acquisitions'];
    for (const call of putSpy.mock.calls) {
      expect(Object.keys(call[0] as object)).not.toContain('pokemon');
    }
    const stored = await get()!.list();
    for (const key of canonicalKeys) {
      expect(stored[0]).not.toHaveProperty(key);
    }
    putSpy.mockRestore();
  });

  it('completes the milestone timeline acceptance journey and reconstructs its plan code', async () => {
    const active = sharedRepoFactory();
    const first = render(<App {...baseProps({ openRepository: active.factory })} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Charmander' }));
    fireEvent.change(screen.getByLabelText('Run name'), { target: { value: 'Timeline acceptance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start FireRed' }));
    await screen.findByRole('region', { name: /team timeline/i });

    // App creates and persists the requested target; the rendered timeline then creates Brock.
    expect(screen.getByRole('button', { name: /preview milestone.*brock/i })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Copy previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Brock keyframe' }));

    // Capture two separate identities through the App inspector, at the same acquisition sequence.
    fireEvent.change(screen.getByRole('searchbox', { name: /search firered/i }), { target: { value: 'Mankey' } });
    fireEvent.click(await screen.findByRole('button', { name: /^Select Mankey at / }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Mankey to Brock party' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Mankey to Brock party' }));
    const created = await waitFor(async () => {
      const saved = (await active.get()!.list())[0];
      const ids = Object.values(saved.timeline.members)
        .filter((member) => member.originalSpeciesId === 56)
        .sort((left, right) => left.speciesSequence - right.speciesSequence)
        .map((member) => member.id);
      expect(ids).toHaveLength(2);
      return { saved, ids };
    });
    const [mankeyOneId, mankeyTwoId] = created.ids;
    const starterMemberId = created.saved.timeline.keyframes.starter.party[0]!;
    expect(mankeyOneId).not.toBe(mankeyTwoId);
    expect(created.saved.timeline.members[mankeyOneId].speciesSequence).toBe(1);
    expect(created.saved.timeline.members[mankeyTwoId].speciesSequence).toBe(2);
    const timeline = () => within(screen.getByRole('region', { name: /team timeline/i }));
    expect(timeline().getByText('Mankey #1')).toBeVisible();
    expect(timeline().getByText('Mankey #2')).toBeVisible();

    // Box the second level-5 Mankey at Brock through its editor.
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move Mankey #2 to reserve' }));

    // Promote Mt Moon through App editing so it becomes the later protected explicit override.
    fireEvent.click(screen.getByRole('button', { name: 'Detailed Planning' }));
    fireEvent.click(screen.getByRole('button', { name: /Mt\. Moon.*Auto-filled/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));

    // Copy Brock to Misty. Only active members auto-level, so boxed Mankey #2 stays at the level
    // the pack records for its earliest acquisition — the inspector no longer types one in.
    fireEvent.click(screen.getByRole('button', { name: 'Major Events' }));
    fireEvent.click(screen.getByRole('button', { name: /Misty.*Auto-filled/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy previous' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-level active party' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create Misty keyframe' }));
    const mistyReserve = screen.getByRole('region', { name: /Reserve.*1 Pok/i });
    // Whole-string reads on the specific nodes: `Lv 21` is a live value elsewhere in this journey,
    // and a substring match on `Lv 2` would pass against it.
    expect(within(mistyReserve).getByText('Mankey #2').textContent).toBe('Mankey #2');
    expect(within(mistyReserve).getByText('Lv 2').textContent).toBe('Lv 2');
    await waitFor(async () => {
      const timeline = (await active.get()!.list())[0].timeline;
      expect(timeline.keyframes['misty-gym'].snapshots[starterMemberId].level).toBe(21);
      expect(timeline.keyframes['misty-gym'].snapshots[mankeyOneId].level).toBe(21);
      expect(timeline.keyframes['misty-gym'].snapshots[mankeyTwoId].level).toBe(2);
    });

    // A forward replacement affects Brock but stops at the explicit Mt Moon override.
    fireEvent.click(screen.getByRole('button', { name: /Brock.*Explicit/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replace party slot 1 with Mankey #2' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Here and future populated milestones' }));
    expect(screen.getByRole('status')).toHaveTextContent('1 protected');
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    await waitFor(async () => {
      const timeline = (await active.get()!.list())[0].timeline;
      expect(timeline.keyframes['brock-gym'].party[0]).toBe(mankeyTwoId);
      expect(timeline.overrides['mt-moon'].party[0]).toBe(starterMemberId);
      expect(timeline.keyframes['misty-gym'].party[0]).toBe(starterMemberId);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Detailed Planning' }));
    fireEvent.click(screen.getByRole('button', { name: /^Route 1 .*Auto-filled/i }));
    expect(timeline().queryByText(/^Mankey #/)).toBeNull();
    // Adding a candidate pins its acquisition route from what the run resolved there, so the route
    // reads Overridden rather than the empty explicit keyframe an unseeded write used to stamp.
    fireEvent.click(screen.getByRole('button', { name: /^Route 22 .*Overridden/i }));
    expect(timeline().getByText('Mankey #1')).toBeVisible();
    expect(timeline().getByText('Mankey #2')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Major Events' }));
    fireEvent.click(screen.getByRole('button', { name: /Misty.*Explicit/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release Mankey #2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm release' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore Mankey #2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
    await waitFor(async () => {
      const member = (await active.get()!.list())[0].timeline.members[mankeyTwoId];
      expect(member.lifecycle.slice(-2).map((event) => event.type)).toEqual(['released', 'restored']);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #2' }));
    const restoredEditor = await screen.findByRole('dialog', { name: /Edit Mankey #2 at Misty/i });
    expect(within(restoredEditor).getByText('Restored Pokémon')).toBeVisible();
    fireEvent.click(within(restoredEditor).getByText('Restored Pokémon'));
    expect(within(restoredEditor).getByText(/audit finding is permanent/i)).toBeVisible();

    fireEvent.change(screen.getByLabelText('Move 1'), { target: { value: '96' } });
    fireEvent.click(screen.getByRole('radio', { name: 'This milestone only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));
    await waitFor(() => expect(within(restoredEditor).getByText('Move requires an egg origin')).toBeVisible());
    fireEvent.click(within(restoredEditor).getByText('Move requires an egg origin'));
    fireEvent.click(within(restoredEditor).getByRole('button', { name: 'Mark as hatched' }));
    fireEvent.click(screen.getByRole('radio', { name: 'This milestone only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Apply change' }));
    await waitFor(async () => {
      expect((await active.get()!.list())[0].timeline.members[mankeyTwoId].origin.type).toBe('hatched');
    });
    await waitFor(() => expect(within(restoredEditor).getByText('Hatched Pokémon')).toBeVisible());
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));

    const overrideIdsBeforePromotion = Object.keys((await active.get()!.list())[0].timeline.overrides).sort();
    fireEvent.click(screen.getByRole('button', { name: 'Detailed Planning' }));
    fireEvent.click(screen.getByRole('button', { name: /^Route 2 .*Auto-filled/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Mankey #1' }));
    await waitFor(async () => {
      const overrideIds = Object.keys((await active.get()!.list())[0].timeline.overrides).sort();
      expect(overrideIds).toEqual([...overrideIdsBeforePromotion, 'kanto-route-2'].sort());
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    fireEvent.click(screen.getByRole('button', { name: /Viridian Forest.*Auto-filled/i }));
    expect(screen.getByText('Auto-filled', { selector: '.timeline-state-label' })).toBeVisible();

    openRunMenu();
    expect(screen.getByRole('menuitem', { name: 'Download JSON' })).toHaveAttribute('download', 'timeline-acceptance.json');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy plan code' }));
    const planCode = ((await screen.findByLabelText('Plan code')) as HTMLInputElement).value;
    expect(planCode).toMatch(/^PP1\./);
    const exportedState = (await active.get()!.list())[0];

    // Preview, cancel, and invalid input are non-mutating even with a live run and repository.
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import JSON file or plan code' }));
    pasteImport('PP1.not-valid');
    expect(await screen.findByRole('alert')).toHaveTextContent(/import failed/i);
    expect(await active.get()!.list()).toEqual([exportedState]);
    expect(screen.getByRole('region', { name: /team timeline/i })).toBeVisible();
    const differentPlanCode = encodePlanCode({
      ...exportedState,
      id: 'different-valid-preview',
      name: 'Different valid preview',
    });
    pasteImport(differentPlanCode);
    expect(await screen.findByRole('dialog', { name: 'Import FireRed Run?' })).toHaveTextContent('Different valid preview');
    expect(await active.get()!.list()).toEqual([exportedState]);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel import' }));
    expect(screen.queryByRole('dialog', { name: 'Import FireRed Run?' })).toBeNull();
    expect(await active.get()!.list()).toEqual([exportedState]);
    // The cancelled preview never became the exported run.
    openRunMenu();
    expect(downloadedRun().name).toBe('Timeline acceptance');

    first.unmount();

    const clean = sharedRepoFactory();
    render(<App {...baseProps({ openRepository: clean.factory })} />);
    await screen.findByText(/set up a run/i);
    openImportDialog();
    pasteImport(`https://pokeplanner.example/plan#plan=${planCode}`);
    expect(await screen.findByRole('dialog', { name: 'Import FireRed Run?' })).toHaveTextContent(
      'Timeline acceptance',
    );
    expect(await clean.get()!.list()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Import run' }));
    await waitFor(async () => expect((await clean.get()!.list())[0]).toEqual(exportedState));
    expect(await screen.findByRole('region', { name: /team timeline/i })).toBeVisible();
  }, 30_000);

  it('reports a schema-valid oversized plan-code export without crashing or mutating the run', async () => {
    const active = sharedRepoFactory();
    const props = baseProps({ openRepository: active.factory });
    const first = render(<App {...props} />);
    await createRun();
    const original = (await active.get()!.list())[0];
    const oversized = { ...original, notes: 'x'.repeat(4 * 1024 * 1024 + 1) };
    await active.get()!.put(oversized);
    first.unmount();

    render(<App {...props} />);
    await screen.findByRole('region', { name: /team timeline/i });
    openRunMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy plan code' }));

    const exportError = await screen.findByRole('alert');
    expect(exportError).toHaveTextContent(/export.*too large|expanded size/i);
    expect(exportError).toHaveTextContent(/shorten notes/i);
    expect(exportError).toHaveTextContent(/download json/i);
    // The JSON route stays reachable in the same menu and still carries the whole run.
    expect(screen.getByRole('menuitem', { name: 'Download JSON' })).toHaveAttribute('download', 'firered-run.json');
    expect(downloadedRun()).toEqual(oversized);
    expect(screen.queryByLabelText('Plan code')).toBeNull();
    expect(screen.getByRole('region', { name: /team timeline/i })).toBeVisible();
    expect(await active.get()!.list()).toEqual([oversized]);
    // A four-megabyte run is deliberately expensive: it is the only way to cross the plan code's
    // *expanded* ceiling, and the budget has to survive the rest of the file running alongside it.
  }, 180_000);
});
