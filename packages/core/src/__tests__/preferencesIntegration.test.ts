// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGrid } from "../core/createGrid";
import { createGridPreferenceStore } from "../preferences";
import type { GridPreferenceRecord, GridPreferenceSaveRequest } from "../preferences";
import type { GridApi } from "../types/api";
import type { GridState } from "../types/state";

const apis: GridApi[] = [];
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
afterEach(() => { for (const api of apis.splice(0)) api.destroy(); document.body.replaceChildren(); });

describe("preference store in Core persistence", () => {
  it("does not restore a slow preference over a local column operation", async () => {
    let complete!: (record: GridPreferenceRecord) => void;
    const save = vi.fn<(request: GridPreferenceSaveRequest) => { revision: string }>(() => ({ revision: "r2" }));
    const store = createGridPreferenceStore({ columns: ["amount"],
      identity: () => ({ tenantId: "t", userId: "u", pageId: "p", schemaId: "s" }),
      load: () => new Promise(resolve => { complete = resolve; }), save
    });
    const host = document.createElement("div");
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 360 } });
    document.body.appendChild(host);
    const api = createGrid(host, { columnDefs: [{ field: "amount", width: 120 }], rowData: [{ amount: 1 }],
      columnLayout: "normal", persistence: { key: "orders", store, sections: ["columns"], debounceMs: 0 }
    });
    apis.push(api);
    await tick();
    const state = api.state.get();
    api.columns.setWidth("amount", 250);
    complete({ state: { ...state, columns: [{ colId: "amount", width: 700 }] } satisfies GridState, revision: "r1" });
    await tick();
    expect(api.columns.getState()[0].width).toBe(250);
    expect(save).toHaveBeenCalled();
    expect(save.mock.calls[0][0].expectedRevision).toBe("r1");
    expect(save.mock.calls[0][0].state.columns[0].width).toBe(250);
    api.destroy();
    store.dispose();
  });
});
