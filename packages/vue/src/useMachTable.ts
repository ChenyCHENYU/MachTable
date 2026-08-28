import { onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type { GridApi } from "@agile-team/mach-table";

export interface UseMachTableReturn<TData = any> {
  ref: Ref<any>;
  api: ShallowRef<GridApi<TData> | null>;
  ready: ShallowRef<boolean>;
}

export function useMachTable<TData = any>(): UseMachTableReturn<TData> {
  const componentRef = ref<any>(null);
  const api = shallowRef<GridApi<TData> | null>(null);
  const ready = shallowRef(false);

  watch(
    componentRef,
    (comp) => {
      if (comp && typeof comp.getApi === "function") {
        api.value = comp.getApi();
        ready.value = api.value != null;
      } else {
        api.value = null;
        ready.value = false;
      }
    },
    { flush: "post" }
  );

  onScopeDispose(() => {
    componentRef.value = null;
    api.value = null;
    ready.value = false;
  });

  return { ref: componentRef, api, ready };
}
