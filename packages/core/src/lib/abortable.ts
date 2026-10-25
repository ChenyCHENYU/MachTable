/** Release an optional transport's waiter even when the transport ignores cancellation. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error("[MachTable] Operation cancelled."), { name: "AbortError" }));
    // Keep both handlers attached after cancellation so a late transport rejection stays observed.
    void work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener("abort", abort, { once: true });
  });
}
