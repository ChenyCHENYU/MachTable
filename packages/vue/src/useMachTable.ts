import { onScopeDispose, ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type { GridApi } from "@agile-team/mach-table";
import type { MachTableVueExposed } from "./MachTable";

export interface UseMachTableReturn<TData = any> {
  ref: Ref<MachTableVueExposed<TData> | null>;
  api: ShallowRef<GridApi<TData> | null>;
  ready: ShallowRef<boolean>;
}

export function useMachTable<TData = any>(): UseMachTableReturn<TData> {
  const componentRef = ref<MachTableVueExposed<TData> | null>(null) as Ref<MachTableVueExposed<TData> | null>;
  const api = shallowRef<GridApi<TData> | null>(null);
  const ready = shallowRef(false);
  let generation = 0;

  watch(
    componentRef,
    (comp) => {
      const currentGeneration = ++generation;
      if (comp && typeof comp.getApi === "function") {
        api.value = comp.getApi();
        ready.value = false;
        const currentApi = api.value;
        if (currentApi) {
          void currentApi.whenReady().then(() => {
            if (generation === currentGeneration && api.value === currentApi && !currentApi.isDestroyed()) {
              ready.value = true;
            }
          });
        }
      } else {
        api.value = null;
        ready.value = false;
      }
    },
    { flush: "post" }
  );

  onScopeDispose(() => {
    generation++;
    componentRef.value = null;
    api.value = null;
    ready.value = false;
  });

  return { ref: componentRef, api, ready };
}
