import type { GridCore } from "../core/gridCore";

type EditRefreshContext = Pick<GridCore<any>, "bodyRenderer" | "summaryRenderer" | "statusBarService">;

/** Refreshes the committed rows and their dependent editing summaries once. */
export function refreshEditedRows(core: EditRefreshContext, indexes: number[]): void {
  if (indexes.length) core.bodyRenderer.refreshRows(indexes);
  core.summaryRenderer.refresh();
  core.statusBarService.refresh();
}
