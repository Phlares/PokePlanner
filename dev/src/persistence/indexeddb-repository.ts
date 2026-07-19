import type { Playthrough } from '../domain/playthrough';
import {
  migrateStored,
  validateForStorage,
  type PlaythroughRepository,
  type RepositoryOptions,
} from './repository';

/** The single client-local database name. Nothing else opens IndexedDB. */
const DATABASE_NAME = 'pokeplanner';
/** The versioned object store; keyed by the playthrough `id`. */
const STORE_NAME = 'playthroughs';
/** Current on-disk store version. Bump alongside an `onupgradeneeded` migration if the store shape changes. */
const DATABASE_VERSION = 1;

/** Wrap a single IDBRequest as a promise that resolves with its result or rejects on error. */
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * The native IndexedDB {@link PlaythroughRepository}. Every native call stays behind this class;
 * callers only ever see the repository interface. Reads migrate the raw stored value to the current
 * schema; writes validate (and stamp `updatedAt`) before the transaction so canonical or invalid
 * data never lands in storage.
 */
class IndexedDbPlaythroughRepository implements PlaythroughRepository {
  constructor(
    private readonly db: IDBDatabase,
    private readonly options: RepositoryOptions,
  ) {}

  /** Run `work` inside one transaction, resolving with its produced value only after it commits. */
  private run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = this.db.transaction(STORE_NAME, mode);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      const store = transaction.objectStore(STORE_NAME);
      let value: T;
      let settled = false;
      work(store).then(
        (result) => {
          value = result;
        },
        (error) => {
          settled = true;
          try {
            transaction.abort();
          } catch {
            // Transaction may already be finishing; the abort/error handler still rejects.
          }
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
      transaction.oncomplete = () => {
        if (!settled) resolve(value);
      };
      transaction.onerror = () => {
        if (!settled) reject(transaction.error ?? new Error('IndexedDB transaction failed'));
      };
      transaction.onabort = () => {
        if (!settled) reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
      };
    });
  }

  async list(): Promise<Playthrough[]> {
    const raw = await this.run('readonly', (store) => requestToPromise(store.getAll()));
    return raw.map((value) => migrateStored(value, this.options));
  }

  async get(id: string): Promise<Playthrough | undefined> {
    const raw = await this.run('readonly', (store) => requestToPromise(store.get(id)));
    if (raw === undefined) return undefined;
    return migrateStored(raw, this.options);
  }

  async put(record: Playthrough): Promise<Playthrough> {
    // Validate BEFORE opening the write transaction so an invalid/canonical record never persists.
    const validated = validateForStorage(record, this.options);
    await this.run('readwrite', (store) => requestToPromise(store.put(validated)));
    return validated;
  }

  async delete(id: string): Promise<void> {
    await this.run('readwrite', (store) => requestToPromise(store.delete(id)));
  }
}

/**
 * Open (creating/upgrading as needed) the single `pokeplanner` database and return a
 * {@link PlaythroughRepository} backed by it. The `factory` is injected (`indexedDB` in a browser,
 * `fake-indexeddb`'s `IDBFactory` in tests) so nothing hardwires the global. Open failures, version
 * blocks, and upgrade errors all surface as a rejected promise.
 */
export function openIndexedDbRepository(
  factory: IDBFactory,
  options: RepositoryOptions,
): Promise<PlaythroughRepository> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(new IndexedDbPlaythroughRepository(request.result, options));
    request.onerror = () => reject(request.error ?? new Error('Failed to open the pokeplanner database'));
    request.onblocked = () => reject(new Error('The pokeplanner database is blocked by another connection'));
  });
}
