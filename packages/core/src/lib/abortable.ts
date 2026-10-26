/** Preserve transport error identity while supplying each owner's historical fallback. */
export function createAbortError(reason: unknown, fallback: string): Error {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === "string" ? reason : fallback);
  error.name = "AbortError";
  return error;
}

const cancelled = () => createAbortError(undefined, "[MachTable] Operation cancelled.");

/** Release a waiter promptly; keep an existing task's late rejection observed even after cancellation. */
export function abortable<T>(work: Promise<T>, signal?: AbortSignal, makeAbortError: () => Error = cancelled): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(makeAbortError()); };
    // Keep both handlers attached after cancellation so a late transport rejection stays observed.
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}
