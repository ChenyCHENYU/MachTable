import type { ServerSideProjection, ServerSideSelection } from "./types";

export function routeKey(route: readonly string[]): string { return JSON.stringify(route); }
export function rowKey(route: readonly string[], id: string): string { return JSON.stringify([route, id]); }
export function within(route: readonly string[], parent: readonly string[]): boolean {
  return route.length >= parent.length && parent.every((key, index) => route[index] === key);
}

/** Selection intent is independent from cached rows; unloaded descendants are explicit. */
export class ServerSideSelectionModel {
  private selected = new Map<string, readonly string[]>();
  private excluded = new Map<string, readonly string[]>();
  private routes = new Map<string, readonly string[]>();
  private excludedRoutes = new Map<string, readonly string[]>();

  private decision(route: readonly string[]): boolean {
    let selected = false;
    for (let depth = 0; depth <= route.length; depth++) {
      const key = routeKey(route.slice(0, depth));
      if (this.routes.has(key)) selected = true;
      if (this.excludedRoutes.has(key)) selected = false;
    }
    return selected;
  }

  private nested(map: Map<string, readonly string[]>, route: readonly string[], strict = false): boolean {
    return [...map.values()].some(value => within(value, route) && (!strict || value.length > route.length));
  }

  get<T>(row: ServerSideProjection<T>): "selected" | "partial" | "none" {
    if (row.groupKey === undefined) {
      if (this.selected.has(row.key)) return "selected";
      return !this.excluded.has(row.key) && this.decision(row.route) ? "selected" : "none";
    }
    const route = [...row.route, row.groupKey];
    if (this.excluded.has(row.key)) return this.decision(route) ? "partial" : "none";
    const selected = this.decision(route) || this.selected.has(row.key);
    const opposite = selected
      ? this.nested(this.excluded, route) || this.nested(this.excludedRoutes, route, true)
      : this.nested(this.selected, route) || this.nested(this.routes, route, true);
    return opposite ? "partial" : selected ? "selected" : "none";
  }

  private removeWithin(map: Map<string, readonly string[]>, route: readonly string[]): void {
    for (const [key, value] of map) if (within(value, route)) map.delete(key);
  }

  select<T>(row: ServerSideProjection<T>, selected: boolean, mode: "self" | "descendants"): void {
    const group = routeKey([...row.route, row.groupKey ?? row.id]);
    const existing = this.selected.has(row.key) || this.excluded.has(row.key) || this.routes.has(group) || this.excludedRoutes.has(group);
    if (!existing && this.selected.size + this.excluded.size + this.routes.size + this.excludedRoutes.size >= 10_000) {
      throw new RangeError("[MachTable] Server-side selection exceeds 10000 explicit rules; clear selection first.");
    }
    if (row.groupKey !== undefined && mode === "descendants") {
      const route = [...row.route, row.groupKey];
      for (const map of [this.selected, this.excluded, this.routes, this.excludedRoutes]) this.removeWithin(map, route);
      this.selected.delete(row.key);
      this.excluded.delete(row.key);
      if (selected) this.routes.set(routeKey(route), route);
      else this.excludedRoutes.set(routeKey(route), route);
      return;
    }
    this.selected.delete(row.key);
    this.excluded.delete(row.key);
    if (selected) this.selected.set(row.key, row.route);
    else this.excluded.set(row.key, row.route);
  }

  clear(): void {
    this.selected.clear(); this.excluded.clear(); this.routes.clear(); this.excludedRoutes.clear();
  }

  snapshot(): ServerSideSelection {
    return { selectedKeys: [...this.selected.keys()], excludedKeys: [...this.excluded.keys()],
      selectedRoutes: [...this.routes.values()].map(route => [...route]),
      excludedRoutes: [...this.excludedRoutes.values()].map(route => [...route]) };
  }
}
