import type { GridState } from "../types/state";
import { migrateGridState } from "./migrate";
import type {
  GridPreferenceIdentity, GridPreferenceRecord, GridPreferenceRequest,
  GridPreferenceStore, GridPreferenceStoreOptions, GridStateMigrationResult
} from "./types";

const MAX_KEYS = 64;
const MAX_PENDING = 64;

interface KeyQueue {
  tail: Promise<void>;
  pending: number;
  revision: string | null | undefined;
}

interface Scope {
  identity: Readonly<GridPreferenceIdentity>;
  fingerprint: string;
  controller: AbortController;
  keys: Map<string, KeyQueue>;
}

function abortError(): Error {
  const error = new Error("[MachTable] Preference operation no longer belongs to the current identity.");
  error.name = "AbortError";
  return error;
}

function validToken(value: unknown): value is string {
  return typeof value === "string" && value.length <= 512 && value.trim().length > 0;
}

function identitySnapshot(identity: GridPreferenceIdentity | null): Readonly<GridPreferenceIdentity> | null {
  if (identity == null) return null;
  const { tenantId, userId, pageId, schemaId } = identity;
  if (![tenantId, userId, pageId, schemaId].every(validToken)) throw new TypeError("[MachTable] Invalid preference identity.");
  return Object.freeze({ tenantId, userId, pageId, schemaId });
}

function fingerprint(identity: Readonly<GridPreferenceIdentity> | null): string {
  return identity ? JSON.stringify([identity.tenantId, identity.userId, identity.pageId, identity.schemaId]) : "";
}

/** Abort promptly even when an injected transport ignores cancellation. */
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) { reject(abortError()); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Keep rejected return promises observable without producing unhandled internal queue rejections. */
function rejected<T>(error: unknown): Promise<T> {
  const promise = Promise.reject<T>(error instanceof Error ? error : new Error(String(error)));
  void promise.catch(() => undefined);
  return promise;
}

/** Optional transport adapter; no account store, HTTP client or global registry is retained. */
export function createGridPreferenceStore(options: GridPreferenceStoreOptions): GridPreferenceStore {
  // Copy schema configuration once; callers cannot mutate the migration policy mid-request.
  const migration = { columns: [...options.columns], renameColumns: { ...options.renameColumns }, columnTypes: { ...options.columnTypes } };
  migrateGridState(null, migration);
  let scope: Scope | null = null;
  let disposed = false;

  const currentScope = (): Scope | null => {
    if (disposed) throw abortError();
    const identity = identitySnapshot(options.identity());
    const next = fingerprint(identity);
    if (scope?.fingerprint === next) return scope;
    if (scope) {
      disposed = true;
      scope.controller.abort();
      scope.keys.clear();
      scope = null;
      throw abortError();
    }
    scope = identity ? { identity, fingerprint: next, controller: new AbortController(), keys: new Map() } : null;
    return scope;
  };

  const assertCurrent = (owner: Scope): void => {
    if (disposed || owner.controller.signal.aborted || currentScope() !== owner) throw abortError();
  };

  const queueFor = (owner: Scope, key: string): KeyQueue => {
    if (!validToken(key)) throw new TypeError("[MachTable] Invalid preference table key.");
    const existing = owner.keys.get(key);
    if (existing) {
      owner.keys.delete(key);
      owner.keys.set(key, existing);
      return existing;
    }
    if (owner.keys.size >= MAX_KEYS) {
      const idle = [...owner.keys].find(([, queue]) => queue.pending === 0);
      if (!idle) throw new RangeError("[MachTable] Too many active preference keys (maximum 64).");
      owner.keys.delete(idle[0]);
    }
    const queue = { tail: Promise.resolve(), pending: 0, revision: undefined };
    owner.keys.set(key, queue);
    return queue;
  };

  const enqueue = <T>(owner: Scope, key: string, work: (queue: KeyQueue) => Promise<T>): Promise<T> => {
    let queue: KeyQueue;
    try {
      queue = queueFor(owner, key);
      if (queue.pending >= MAX_PENDING) throw new RangeError("[MachTable] Too many pending preference operations for one key (maximum 64).");
    } catch (error) { return rejected(error); }
    queue.pending++;
    const task = queue.tail.then(() => { assertCurrent(owner); return work(queue); });
    queue.tail = task.then(() => undefined, () => undefined).finally(() => { queue.pending--; });
    return task;
  };

  const request = (owner: Scope, key: string): GridPreferenceRequest => ({
    identity: owner.identity, key, signal: owner.controller.signal
  });

  const read = async (owner: Scope, key: string, queue: KeyQueue): Promise<GridPreferenceRecord | null> => {
    assertCurrent(owner);
    const record = await abortable(Promise.resolve().then(() => {
      assertCurrent(owner);
      return options.load(request(owner, key));
    }), owner.controller.signal);
    assertCurrent(owner);
    if (record != null && !validToken(record.revision)) throw new TypeError("[MachTable] Preference transport returned an invalid revision.");
    queue.revision = record?.revision ?? null;
    return record;
  };

  const migrate = (state: unknown, owner: Scope, key: string): GridStateMigrationResult => {
    const result = migrateGridState(state, migration);
    if (result.report.length) {
      try { options.onMigration?.(result, request(owner, key)); } catch { /* observers cannot break persistence */ }
    }
    return result;
  };

  const save = async (owner: Scope, key: string, state: GridState, queue: KeyQueue): Promise<void> => {
    if (queue.revision === undefined) await read(owner, key, queue);
    assertCurrent(owner);
    const result = await abortable(Promise.resolve().then(() => {
      assertCurrent(owner);
      return options.save({ ...request(owner, key), state, expectedRevision: queue.revision ?? null });
    }), owner.controller.signal);
    assertCurrent(owner);
    if (!result || !validToken(result.revision)) throw new TypeError("[MachTable] Preference save must return its committed revision.");
    queue.revision = result.revision;
  };

  // Bind an already authenticated session immediately, before a delayed grid
  // mount or its first deferred save can outlive that account.
  currentScope();
  return {
    load(key) {
      try {
        const owner = currentScope();
        if (!owner) return Promise.resolve(null);
        return enqueue(owner, key, async (queue) => {
          const record = await read(owner, key, queue);
          const state = record ? migrate(record.state, owner, key).state : null;
          assertCurrent(owner);
          return state;
        }).catch(error => {
          if ((error as Error)?.name === "AbortError") return null;
          throw error;
        });
      } catch (error) { return rejected(error); }
    },
    save(key, state) {
      try {
        const owner = currentScope();
        if (!owner) return rejected(abortError());
        const snapshot = migrate(state, owner, key).state;
        if (!snapshot) return rejected(new TypeError("[MachTable] Cannot save invalid grid preferences."));
        return enqueue(owner, key, (queue) => save(owner, key, snapshot, queue));
      } catch (error) { return rejected(error); }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scope?.controller.abort();
      scope?.keys.clear();
      scope = null;
    }
  };
}
