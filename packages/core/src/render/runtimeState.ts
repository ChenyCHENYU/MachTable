/** Runtime-only DOM state kept out of public elements and their string keys. */
export interface CellRuntimeState {
  destroy?: () => void;
  flashTimer?: number;
  styleKeys?: string[];
}

const cellStates = new WeakMap<HTMLElement, CellRuntimeState>();
const detailDestroyers = new WeakMap<HTMLElement, () => void>();
const headerDestroyers = new WeakMap<HTMLElement, () => void>();

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

export function setDetailDestroyer(element: HTMLElement, destroy: (() => void) | undefined): void {
  if (destroy) detailDestroyers.set(element, destroy);
  else detailDestroyers.delete(element);
}

export function takeDetailDestroyer(element: HTMLElement): (() => void) | undefined {
  const destroy = detailDestroyers.get(element);
  detailDestroyers.delete(element);
  return destroy;
}

export function setHeaderDestroyer(element: HTMLElement, destroy: (() => void) | undefined): void {
  if (destroy) headerDestroyers.set(element, destroy);
  else headerDestroyers.delete(element);
}

export function takeHeaderDestroyer(element: HTMLElement): (() => void) | undefined {
  const destroy = headerDestroyers.get(element);
  headerDestroyers.delete(element);
  return destroy;
}
