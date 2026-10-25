import { describe, expect, it, vi } from "vitest";
import { createGridPreferenceStore, GridPreferenceConflictError } from "../preferences";
import type { GridPreferenceIdentity, GridPreferenceSaveRequest, GridPreferenceStoreOptions } from "../preferences";
import type { GridState } from "../types/state";

const account = (userId = "alice"): GridPreferenceIdentity => ({ tenantId: "tenant", userId, pageId: "orders", schemaId: "v2" });
const snapshot = (width = 120): GridState => ({ version: 2, columns: [{ colId: "amount", width }],
  sortModel: [], filterModel: {}, advancedFilterModel: null, quickFilterText: null,
  pagination: { enabled: false, page: 1, pageSize: 20 }, selectedRowIds: [], expandedRowIds: [], expandedGroupIds: [] });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function options(overrides: Partial<GridPreferenceStoreOptions> = {}): GridPreferenceStoreOptions {
  return { identity: () => account(), columns: ["amount"], load: () => null,
    save: () => ({ revision: "1" }), ...overrides };
}

describe("identity-aware preference transport", () => {
  it("captures target filter types once and applies them to both loaded and saved preferences", async () => {
    const state = { ...snapshot(), filterModel: { amount: { type: "number" as const, conditions: [{ match: "equals" as const, value: 1 }] } } };
    const columnTypes = { amount: false as false | "number" };
    const save = vi.fn((request: GridPreferenceSaveRequest) => { expect(request.state.filterModel).toEqual({}); return { revision: "r2" }; });
    const onMigration = vi.fn();
    const store = createGridPreferenceStore(options({ columnTypes, load: () => ({ state, revision: "r1" }), save, onMigration }));
    columnTypes.amount = "number";
    expect((await store.load("orders"))?.filterModel).toEqual({});
    await store.save("orders", state);
    expect(save.mock.calls).toHaveLength(1);
    expect(onMigration.mock.calls[0][0].report).toContainEqual({ code: "TYPE_CHANGED", path: "filterModel.amount", from: "number", to: "disabled" });
    store.dispose();
  });

  it("serializes writes per identity/table key with immutable snapshots and current CAS revisions", async () => {
    const first = deferred<{ revision: string }>();
    const writes: GridPreferenceSaveRequest[] = [];
    const store = createGridPreferenceStore(options({ load: () => ({ state: snapshot(), revision: "r0" }),
      save(request) { writes.push(request); return writes.length === 1 ? first.promise : { revision: "r2" }; }
    }));
    const state = snapshot(150);
    const a = store.save("orders", state);
    const b = store.save("orders", snapshot(200));
    state.columns[0].width = 999;
    await tick();
    expect(writes).toHaveLength(1);
    expect(writes[0].state.columns[0].width).toBe(150);
    expect(writes[0].expectedRevision).toBe("r0");
    first.resolve({ revision: "r1" });
    await Promise.all([a, b]);
    expect(writes[1].expectedRevision).toBe("r1");
    expect(writes[1].state.columns[0].width).toBe(200);
    store.dispose();
  });

  it("keeps different keys independent and safely continues a queue after a failed write", async () => {
    const first = deferred<{ revision: string }>();
    const calls: string[] = [];
    const store = createGridPreferenceStore(options({ save({ key }) {
      calls.push(key); return calls.length === 1 ? first.promise : { revision: `r${calls.length}` };
    } }));
    const failure = store.save("a", snapshot());
    const next = store.save("a", snapshot());
    await store.save("b", snapshot());
    expect(calls).toEqual(["a", "b"]);
    first.reject(new Error("network"));
    await expect(failure).rejects.toThrow("network");
    await next;
    expect(calls).toEqual(["a", "b", "a"]);
    store.dispose();
  });

  it("surfaces authoritative CAS conflicts without overwriting or retrying", async () => {
    let revision: string | null = null;
    const save = vi.fn(({ expectedRevision }: GridPreferenceSaveRequest) => {
      if (expectedRevision !== revision) throw new GridPreferenceConflictError(expectedRevision, revision ?? undefined);
      revision = revision === null ? "r1" : "r2";
      return { revision };
    });
    const load = () => revision ? { revision, state: snapshot() } : null;
    const first = createGridPreferenceStore(options({ load, save }));
    const second = createGridPreferenceStore(options({ load, save }));
    await Promise.all([first.load("same"), second.load("same")]);
    await first.save("same", snapshot());
    await expect(second.save("same", snapshot())).rejects.toMatchObject({
      name: "GridPreferenceConflictError", expectedRevision: null, actualRevision: "r1"
    });
    expect(save).toHaveBeenCalledTimes(2);
    await second.load("same");
    await second.save("same", snapshot());
    expect(revision).toBe("r2");
    first.dispose(); second.dispose();
  });

  it("isolates tenant, user, page and schema identity and aborts old-account queues", async () => {
    let identity = account();
    const slow = deferred<{ state: GridState; revision: string } | null>();
    const requests: string[] = [];
    let oldSignal!: AbortSignal;
    const save = vi.fn<(request: GridPreferenceSaveRequest) => { revision: string }>(() => ({ revision: "new" }));
    const policy = options({ identity: () => identity,
      load({ identity: owner, key, signal }) {
        requests.push(JSON.stringify([owner, key]));
        if (owner.userId === "alice") { oldSignal = signal; return slow.promise; }
        return { state: snapshot(240), revision: "bob" };
      }, save
    });
    const store = createGridPreferenceStore(policy);
    const oldLoad = store.load("same");
    const oldSave = store.save("same", snapshot());
    await tick();
    identity = { ...account("bob"), tenantId: "other", pageId: "otherPage", schemaId: "v3" };
    await expect(store.load("same")).rejects.toMatchObject({ name: "AbortError" });
    const replacement = createGridPreferenceStore(policy);
    expect((await replacement.load("same"))?.columns[0].width).toBe(240);
    await expect(oldLoad).resolves.toBeNull();
    await expect(oldSave).rejects.toMatchObject({ name: "AbortError" });
    expect(oldSignal.aborted).toBe(true);
    slow.reject(new Error("late old-account failure"));
    await tick();
    await expect(store.save("same", snapshot())).rejects.toMatchObject({ name: "AbortError" });
    await replacement.save("same", snapshot());
    expect(save).toHaveBeenCalledOnce();
    expect(save.mock.calls[0]?.[0]).toMatchObject({ identity, expectedRevision: "bob" });
    expect(requests).toHaveLength(2);
    store.dispose(); replacement.dispose();
  });

  it("checks identity again at completion without requiring a new operation", async () => {
    let identity = account();
    const pending = deferred<{ state: GridState; revision: string }>();
    const store = createGridPreferenceStore(options({ identity: () => identity, load: () => pending.promise }));
    const loading = store.load("same");
    await tick();
    identity = account("bob");
    pending.resolve({ state: snapshot(800), revision: "old" });
    await expect(loading).resolves.toBeNull();
    store.dispose();
  });

  it("rejects an old table snapshot submitted only after the session has switched", async () => {
    let identity = account();
    const save = vi.fn(() => ({ revision: "r1" }));
    const load = vi.fn(() => null);
    const store = createGridPreferenceStore(options({ identity: () => identity, load, save }));
    const oldTableSnapshot = snapshot(350);
    identity = account("bob");
    await expect(store.save("same", oldTableSnapshot)).rejects.toMatchObject({ name: "AbortError" });
    expect(save).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
    store.dispose();
  });

  it("never commits a late old-account save revision into the replacement account", async () => {
    let identity = account();
    const pending = deferred<{ revision: string }>();
    const writes: GridPreferenceSaveRequest[] = [];
    const store = createGridPreferenceStore(options({ identity: () => identity, save(request) {
      writes.push(request); return writes.length === 1 ? pending.promise : { revision: "bob1" };
    } }));
    const old = store.save("same", snapshot());
    await tick();
    identity = account("bob");
    pending.resolve({ revision: "alice1" });
    await expect(old).rejects.toMatchObject({ name: "AbortError" });
    await expect(store.save("same", snapshot())).rejects.toMatchObject({ name: "AbortError" });
    const replacement = createGridPreferenceStore(options({ identity: () => identity, save(request) {
      writes.push(request); return { revision: "bob1" };
    } }));
    await replacement.save("same", snapshot());
    expect(writes[0].identity.userId).toBe("alice");
    expect(writes[1].identity.userId).toBe("bob");
    expect(writes[1].expectedRevision).toBeNull();
    store.dispose(); replacement.dispose();
  });

  it("rejects queued saves promptly on dispose even when transport never settles", async () => {
    const save = vi.fn(() => new Promise<{ revision: string }>(() => undefined));
    const store = createGridPreferenceStore(options({ save }));
    const first = store.save("same", snapshot());
    const second = store.save("same", snapshot());
    await tick();
    store.dispose(); store.dispose();
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(save).toHaveBeenCalledOnce();
    await expect(store.load("same")).rejects.toMatchObject({ name: "AbortError" });
  });

  it("bounds active keys and queued operations while allowing idle-key reclamation", async () => {
    const store = createGridPreferenceStore(options({ load: () => new Promise(() => undefined) }));
    const loads = Array.from({ length: 64 }, (_, index) => store.load(String(index)));
    await expect(store.load("overflow")).rejects.toThrow(/64/);
    const writes = Array.from({ length: 63 }, () => store.save("0", snapshot()));
    await expect(store.save("0", snapshot())).rejects.toThrow(/64/);
    store.dispose();
    await Promise.all(loads);
    const settled = await Promise.allSettled(writes);
    expect(settled.every(result => result.status === "rejected")).toBe(true);
    const idle = createGridPreferenceStore(options());
    for (let index = 0; index < 100; index++) await idle.load(String(index));
    idle.dispose();
  });

  it("isolates migration observer failures and rejects malformed transport revisions", async () => {
    const store = createGridPreferenceStore(options({ columns: ["amount"], renameColumns: { old: "amount" },
      load: () => ({ state: { ...snapshot(), columns: [{ colId: "old" }] }, revision: "r1" }),
      onMigration() { throw new Error("observer"); }
    }));
    expect((await store.load("same"))?.columns).toEqual([{ colId: "amount" }]);
    await store.save("same", snapshot());
    store.dispose();
    const invalid = createGridPreferenceStore(options({ load: () => ({ state: snapshot(), revision: "" }) }));
    await expect(invalid.load("same")).rejects.toThrow(/revision/);
    invalid.dispose();
  });
});
