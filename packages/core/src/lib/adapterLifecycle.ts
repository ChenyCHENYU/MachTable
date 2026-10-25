import type { GridApi } from "../types/api";
import { closeGridSelect } from "./selectControl";
import type { RowDragDriver, RowDragDriverFactory } from "./rowDragDriver";

const key = Symbol.for("mach-table.adapter.lifecycle.v1");
export interface GridInputCell { rowId: string; colId: string; value: unknown }
interface AdapterLifecycle {
  suspend(): void;
  resume(): void;
  readCell(rowId: string, colId: string): string;
  writeInput(cells: readonly GridInputCell[]): void;
  canReplaceData(): boolean;
  rowDrag?: { factory: RowDragDriverFactory; original: RowDragDriverFactory; policy: unknown; activeInteraction?: RowDragDriver };
}
type AdapterApi = GridApi<any> & { [key]?: AdapterLifecycle };

/** Symbols keep the bridge shared across independently bundled ESM/CJS entries. */
export function attachAdapterLifecycle(api: GridApi<any>, lifecycle: AdapterLifecycle): void {
  Object.defineProperty(api, key, { value: lifecycle });
}

/** Internal adapter contract; deactivation preserves row data and saved state. */
export function suspendGrid(api: GridApi<any>): void {
  if (api.isDestroyed()) return;
  const root = api.view.getRoot();
  if (root) closeGridSelect(root);
  (api as AdapterApi)[key]?.suspend();
}

export function resumeGrid(api: GridApi<any>): void {
  if (!api.isDestroyed()) (api as AdapterApi)[key]?.resume();
}

/** Optional features share Core's formatter and user-input validation boundary. */
export function readGridCell(api: GridApi<any>, rowId: string, colId: string): string {
  return api.isDestroyed() ? "" : (api as AdapterApi)[key]?.readCell(rowId, colId) ?? "";
}

export function writeGridInput(api: GridApi<any>, cells: readonly GridInputCell[]): void {
  if (!api.isDestroyed()) (api as AdapterApi)[key]?.writeInput(cells);
}

export function canReplaceGridData(api: GridApi<any>): boolean {
  return !api.isDestroyed() && ((api as AdapterApi)[key]?.canReplaceData() ?? false);
}

export function getGridRowDragFactory(api: GridApi): RowDragDriverFactory | undefined {
  const owner = (api as AdapterApi)[key]?.rowDrag;
  return owner?.policy === api.getOption("rowDragPolicy") ? owner?.factory : undefined;
}
export function ownsGridRowDragFactory(api: GridApi, factory: RowDragDriverFactory): boolean {
  const owner = (api as AdapterApi)[key]?.rowDrag;
  return owner?.original === factory && owner.policy === api.getOption("rowDragPolicy");
}
export function setGridRowDragFactory(api: GridApi, factory: RowDragDriverFactory): () => void {
  const capability = (api as AdapterApi)[key];
  if (!capability) return () => undefined;
  capability.rowDrag?.activeInteraction?.destroy();
  const owner: NonNullable<AdapterLifecycle["rowDrag"]> = { original: factory, policy: api.getOption("rowDragPolicy"), factory: host => {
    owner.activeInteraction = factory(host);
    return owner.activeInteraction;
  } };
  capability.rowDrag = owner;
  return () => { owner.activeInteraction?.destroy(); if (capability.rowDrag === owner) capability.rowDrag = undefined; };
}
