/** Optional ordering workflow; importing the base grid does not include this module. */
export { moveTreeNodes, reorderRows } from "./ordering/moveRows";
export { createRowOrderController, RowOrderConflictError } from "./ordering/controller";
export type { RowOrderConstraint, RowOrderIntent, RowOrderOptions, RowOrderPlan } from "./ordering/types";
export type { RowOrderController, RowOrderControllerOptions, RowOrderSaveContext, RowOrderOperation, RowOrderSaveResult, RowOrderState } from "./ordering/controller";
