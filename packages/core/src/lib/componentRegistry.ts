import type { CellRendererFn, CellEditorFactory } from "../types/colDef";

const cellRenderers = new Map<string, CellRendererFn>();
const cellEditors = new Map<string, CellEditorFactory>();

export function registerCellRenderer(name: string, renderer: CellRendererFn): () => void {
  const previous = cellRenderers.get(name);
  cellRenderers.set(name, renderer);
  return () => {
    if (cellRenderers.get(name) !== renderer) return;
    if (previous) cellRenderers.set(name, previous);
    else cellRenderers.delete(name);
  };
}

export function getCellRenderer(name: string): CellRendererFn | undefined {
  return cellRenderers.get(name);
}

export function registerCellEditor(name: string, editor: CellEditorFactory): () => void {
  const previous = cellEditors.get(name);
  cellEditors.set(name, editor);
  return () => {
    if (cellEditors.get(name) !== editor) return;
    if (previous) cellEditors.set(name, previous);
    else cellEditors.delete(name);
  };
}

export function getCellEditor(name: string): CellEditorFactory | undefined {
  return cellEditors.get(name);
}

/** Register a built-in without replacing an application override. */
export function ensureCellRenderer(name: string, renderer: CellRendererFn): void {
  if (!cellRenderers.has(name)) cellRenderers.set(name, renderer);
}

export function clearComponentRegistries(): void {
  cellRenderers.clear();
  cellEditors.clear();
}
