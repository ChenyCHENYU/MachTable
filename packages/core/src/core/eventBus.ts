type EventKey<TEvents extends object> = Extract<keyof TEvents, string>;
type Listener<TEvent> = (event: TEvent) => void;

export class EventBus<TEvents extends object = Record<string, any>> {
  private listeners = new Map<EventKey<TEvents>, Set<Listener<any>>>();

  constructor(private onListenerError?: (error: unknown, eventType: EventKey<TEvents>) => void) {}

  on<K extends EventKey<TEvents>>(type: K, listener: Listener<TEvents[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener as Listener<any>);
    return () => {
      set.delete(listener);
    };
  }

  once<K extends EventKey<TEvents>>(type: K, listener: Listener<TEvents[K]>): () => void {
    const off = this.on(type, (event) => {
      off();
      listener(event);
    });
    return off;
  }

  off<K extends EventKey<TEvents>>(type: K, listener: Listener<TEvents[K]>): void {
    const set = this.listeners.get(type);
    if (set) {
      set.delete(listener as Listener<any>);
      if (set.size === 0) this.listeners.delete(type);
    }
  }

  emit<K extends EventKey<TEvents>>(type: K, payload?: TEvents[K]): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(payload);
      } catch (err) {
        console.error(`[mach-table] error in "${type}" listener`, err);
        this.onListenerError?.(err, type);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
