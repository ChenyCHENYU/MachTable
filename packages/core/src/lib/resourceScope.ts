/** Grid-local ownership: release once, in reverse order, even if one cleanup fails. */
/** @internal The feature context exposes managed cleanup closures rather than resource scopes. */
export class ResourceScope {
  private cleanups = new Set<() => void>();
  private disposed = false;

  constructor(private onError: (error: unknown) => void) {}

  add(cleanup: () => void): () => void {
    let active = true;
    const release = () => {
      if (!active) return;
      active = false;
      this.cleanups.delete(release);
      try { cleanup(); } catch (error) {
        try { this.onError(error); } catch { /* error observers cannot block remaining owners */ }
      }
    };
    if (this.disposed) release();
    else this.cleanups.add(release);
    return release;
  }

  own<T extends { destroy(): void }>(resource: T): T {
    this.add(() => resource.destroy());
    return resource;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const cleanups = [...this.cleanups].reverse();
    this.cleanups.clear();
    for (const cleanup of cleanups) cleanup();
  }
}
