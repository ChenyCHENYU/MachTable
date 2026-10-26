import type { GridApi } from "../types/api";
import type { PreparedImport, PreparedImportRow } from "../lib/importData";
import type { InputError, ValidatedInputRow } from "../services/inputService";
import { getImportContext, type ImportContext } from "../lib/importContext";
import { snapshotImportValue } from "./snapshot";
import { prepareImport } from "./prepare";
import type { ImportIssue, ImportPlan, ImportPlanOptions, ImportPreview, ImportResult, ImportSource } from "./types";

interface ReadyImport { prepared: PreparedImport; rows: ValidatedInputRow[]; guards: Array<() => boolean>; errors: InputError[][]; current: () => boolean; intent: () => boolean }
const issue = (message: string, code: ImportIssue["code"] = "UNSUPPORTED", rowIndex = -1): ImportIssue => ({ rowIndex, code, message });
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

function checkCandidates(api: GridApi, core: ImportContext, prepared: PreparedImport, mode: ImportPlanOptions["mode"]): void {
  const used = new Set<string>();
  for (const row of prepared.rows) {
    if (mode === "paste") {
      if (api.rows.getById(row.node.id) !== row.node) prepared.issues.push(issue("Paste target is not loaded", "MAPPING", row.rowIndex));
      continue;
    }
    try {
      const id = core.resolveId(row.data, row.rowIndex);
      if (id === undefined) continue;
      if (!id || used.has(id) || mode === "append" && api.rows.getById(id)) prepared.issues.push(issue(`Missing or duplicate row key: ${id}`, "MAPPING", row.rowIndex));
      used.add(id); row.node.id = id;
    } catch (error) { prepared.issues.push(issue(message(error), "MAPPING", row.rowIndex)); }
  }
}

function normalizeRows(api: GridApi, core: ImportContext, source: ImportSource<any>, options: ImportPlanOptions): PreparedImport {
  const prepared = prepareImport(api, core, source, options);
  if (options.mode === "paste") for (const row of prepared.rows) {
    if (!row.changes.length) prepared.issues.push(issue("Paste row has no editable destination cells", "VALIDATION", row.rowIndex));
    row.changes = row.changes.filter(change => change.newValue !== undefined && !Object.is(change.oldValue, change.newValue));
  }
  if (!prepared.rows.length) prepared.issues.push(issue("Import contains no data rows", "MAPPING"));
  checkCandidates(api, core, prepared, options.mode);
  return prepared;
}

function validationIssues(row: PreparedImportRow, errors: readonly InputError[]): ImportIssue[] {
  return errors.map(error => ({ rowIndex: row.rowIndex, colId: error.colId, code: "VALIDATION", message: error.message }));
}

function previewCells(prepared: PreparedImport): ImportPreview["cells"] {
  const cells = prepared.rows.flatMap(row => row.changes.map(change => ({ rowIndex: row.rowIndex, colId: change.column.id, value: change.newValue })));
  const values = snapshotImportValue(cells.map(cell => cell.value));
  return cells.map((cell, index) => ({ ...cell, value: values[index] }));
}

function groupIssues(issues: readonly ImportIssue[]): Map<number, ImportIssue[]> {
  const rows = new Map<number, ImportIssue[]>();
  for (const entry of issues) { const list = rows.get(entry.rowIndex) ?? []; list.push(entry); rows.set(entry.rowIndex, list); }
  return rows;
}

/** An explicit, bounded transaction preview. No worker, workbook state or second value-writing engine. */
export function createImportPlan<TData>(api: GridApi<TData>, source: ImportSource<TData>, options: ImportPlanOptions = {}): ImportPlan {
  const core = getImportContext(api);
  const settings = { ...options, columns: options.columns ? [...options.columns] : undefined };
  let disposed = false, epoch = 0, request = 0, consumed = false;
  let ready: ReadyImport | undefined;
  let pending: Promise<ImportPreview> | undefined;
  let last: ImportPreview | undefined;
  let saving: Promise<ImportResult> | undefined;
  const off = [api.on("modelUpdated", () => epoch++), api.on("cellValueChanged", () => epoch++)];
  const unavailable = (): "destroyed" | "stale" => disposed || api.isDestroyed() ? "destroyed" : "stale";
  const empty = (status: ImportPreview["status"], issues: ImportIssue[] = []): ImportPreview => ({ status, rowCount: 0, cells: [], issues });
  const dispose = (): void => { if (disposed) return; disposed = true; request++; ready = undefined; off.forEach(unsubscribe => unsubscribe()); };
  off.push(api.on("gridDestroyed", dispose));

  async function inspect(): Promise<ImportPreview> {
    const serial = ++request;
    ready = undefined;
    if (disposed || api.isDestroyed()) return empty("destroyed");
    if (consumed) return empty("stale", [issue("This import plan has already committed", "STALE")]);
    const intent = core.begin(), version = core.revision(), columns = core.columns(), observed = epoch;
    const validator = api.getOption("rowEditValidator"), identity = api.getOption("rowKey");
    const scope = (): boolean => !disposed && serial === request && intent() && core.revision() === version
      && core.columns() === columns && api.getOption("rowEditValidator") === validator && api.getOption("rowKey") === identity;
    const current = (): boolean => scope() && epoch === observed;
    try {
      const prepared = normalizeRows(api, core, source, settings);
      const guards = prepared.rows.map(row => settings.mode === "paste" && row.changes.length ? core.guard(row.changes) : () => true);
      const rows = prepared.rows.map((row, index) => ({ changes: row.changes, current: () => current() && guards[index]() }));
      const errors = await Promise.all(rows.map(row => Promise.resolve(row.changes.length ? core.validate(row.changes, row.current) : [])));
      if (!current()) return empty(unavailable(), [issue("Grid, columns or input changed during validation", "STALE")]);
      prepared.rows.forEach((row, index) => prepared.issues.push(...validationIssues(row, errors[index])));
      const cells = previewCells(prepared);
      ready = { prepared, rows, guards, errors, current, intent: scope };
      return { status: prepared.issues.length ? "invalid" : "ready", rowCount: prepared.rows.length, cells, issues: prepared.issues.map(entry => ({ ...entry })) };
    } catch (error) { return empty(current() ? "invalid" : unavailable(), [issue(message(error))]); }
  }

  async function ensurePreview(): Promise<void> {
    if (pending) await pending;
    else if (!ready && !last) await preview();
  }

  async function apply(): Promise<ImportResult> {
    await ensurePreview();
    if (disposed || api.isDestroyed()) return { status: "destroyed", importedRowCount: 0, issues: [] };
    const state = ready;
    if (!state && last?.status === "invalid") return { status: "invalid", importedRowCount: 0, issues: last.issues.map(entry => ({ ...entry })) };
    if (!state?.current() || consumed) return { status: "stale", importedRowCount: 0, issues: [issue("Import preview is no longer current", "STALE")] };
    const { prepared } = state;
    if (prepared.issues.length && settings.mode !== "paste") return { status: "invalid", importedRowCount: 0, issues: prepared.issues.map(entry => ({ ...entry })) };
    consumed = true;
    if (settings.mode === "paste") return paste(state);
    const data = prepared.rows.map(row => row.data as TData);
    if (settings.mode === "append") api.rows.transact({ add: data });
    else api.rows.setData(data);
    return { status: "applied", importedRowCount: data.length, issues: [] };
  }

  function paste(state: ReadyImport): ImportResult {
    const byRow = groupIssues(state.prepared.issues);
    const errors = state.errors.map((rowErrors, index) => [...rowErrors, ...(byRow.get(state.prepared.rows[index].rowIndex) ?? [])
      .filter(entry => entry.code !== "VALIDATION")
      .map(entry => ({ colId: entry.colId ?? "", message: entry.message }))]);
    // The model epoch changes on our own value events. Per-row guards and the intent/scope still protect every setter.
    const rows = state.rows.map((row, index) => ({ ...row, current: () => state.intent() && state.guards[index]() }));
    const results = core.commitRows(rows, errors, state.intent);
    const issues = [...state.prepared.issues, ...results.flatMap((result, index) => {
      const row = state.prepared.rows[index], known = new Set((byRow.get(row.rowIndex) ?? []).map(entry => entry.message));
      return validationIssues(row, result.errors).filter(error => !known.has(error.message));
    })];
    const importedRowCount = results.filter(result => result.applied).length;
    if (!state.intent()) return { status: unavailable(), importedRowCount, issues: [...issues, issue("Input scope changed during commit", "STALE")] };
    const failed = issues.length > 0 || importedRowCount < state.rows.filter(row => row.changes.length).length;
    return { status: failed ? importedRowCount ? "partial" : "invalid" : "applied", importedRowCount, issues };
  }

  function preview(): Promise<ImportPreview> {
    const task = inspect(); pending = task; last = undefined;
    void task.then(result => { if (pending === task) last = result; });
    void task.finally(() => { if (pending === task) pending = undefined; });
    return task;
  }
  return { preview, commit: () => saving ??= apply().finally(() => { saving = undefined; }), destroy: dispose };
}
