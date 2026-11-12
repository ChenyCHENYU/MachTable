import { unref, type Ref } from "vue";

/** Resolve adapter values, refs and getters while retaining Vue 3.2 support. */
export function resolveSource<T>(source: T | Readonly<{ value: T }> | (() => T)): T {
  return typeof source === "function" ? (source as () => T)() : unref(source as T | Ref<T>);
}
