/** Runtime-only DOM state kept out of public elements and their string keys. */
export interface CellRuntimeState {
  destroy?: () => void;
  refresh?: (params: import("../types/params").CellRendererParams) => boolean | void;
  rendererDefinition?: unknown;
  rendererRowId?: string;
  rendererColumnId?: string;
  flashTimer?: number;
  styleKeys?: string[];
}

const cellStates = new WeakMap<HTMLElement, CellRuntimeState>();
const rendererDestroyers = new WeakMap<HTMLElement, () => void>();

export function getCellRuntimeState(element: HTMLElement): CellRuntimeState {
  let state = cellStates.get(element);
  if (!state) {
    state = {};
    cellStates.set(element, state);
  }
  return state;
}

export function peekCellRuntimeState(element: HTMLElement): CellRuntimeState | undefined {
  return cellStates.get(element);
}

/** Detail rows and header cells own disjoint DOM elements. */
export function setRendererDestroyer(element: HTMLElement, destroy: (() => void) | undefined): void {
  if (destroy) rendererDestroyers.set(element, destroy);
  else rendererDestroyers.delete(element);
}

export function takeRendererDestroyer(element: HTMLElement): (() => void) | undefined {
  const destroy = rendererDestroyers.get(element);
  rendererDestroyers.delete(element);
  return destroy;
}
