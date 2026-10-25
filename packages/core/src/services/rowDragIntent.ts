import type { RowDragIntent } from "../types/events";
import type { RowNode } from "../types/row";

/** Only policy consumers need a default intent; ordinary managed drags stay index-based. */
export function singleRowDragIntent(source: RowNode<any>, order: readonly RowNode<any>[], target: RowNode<any>, position: RowDragIntent["position"], revision?: string | number): RowDragIntent {
  const step = position === "before" ? -1 : 1;
  let index = target.rowIndex + step;
  while (order[index] && (order[index] === source || order[index].isDetail)) index += step;
  const neighbour = order[index]?.id ?? null;
  return { rowIds: [source.id], targetId: target.id, position,
    beforeId: position === "before" ? neighbour : target.id,
    afterId: position === "before" ? target.id : neighbour, expectedRevision: revision };
}
