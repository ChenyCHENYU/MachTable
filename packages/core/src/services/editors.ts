import type { SelectEditorOption, SelectEditorParams } from "../types/colDef";
import type { ICellEditor } from "../types/params";
import { createSelectControl } from "../lib/selectControl";
import type { Column } from "./column";

function baseInput(type: string, value: any): HTMLInputElement {
  const input = document.createElement("input");
  input.type = type;
  input.className = "mach-editor-input";
  if (value != null && value !== "") {
    input.value = type === "date" ? String(value).slice(0, 10) : String(value);
  }
  return input;
}

function selectOptions(params?: SelectEditorParams): readonly SelectEditorOption[] {
  if (params?.options?.length) return params.options;
  return (params?.values ?? []).map((value) => ({ label: String(value), value }));
}

function inferEditorType(value: any, selectParams?: SelectEditorParams): string {
  if (selectParams?.options?.length || selectParams?.values?.length) return "select";
  if (typeof value === "number") return "number";
  if (value instanceof Date) return "date";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
  return "text";
}

export function createEditor(column: Column, value: any, keyPress?: string | null): ICellEditor {
  const def = column.colDef;
  const name = typeof def.cellEditor === "string" ? def.cellEditor : inferEditorType(value, def.cellEditorParams);

  if (name === "number") {
    const input = baseInput("number", value);
    return {
      el: input,
      getValue: () => (input.value === "" ? null : Number(input.value)),
      focus: () => {
        input.focus({ preventScroll: true });
        input.select();
      }
    };
  }

  if (name === "date") {
    const input = baseInput("date", value);
    const raw = value == null ? "" : String(value);
    const timeMatch = raw.match(/T(\d{2}:\d{2})/);
    return {
      el: input,
      getValue: () => {
        if (input.value === "") return null;
        if (timeMatch) return `${input.value}T${timeMatch[1]}`;
        return input.value;
      },
      focus: () => input.focus({ preventScroll: true })
    };
  }

  if (name === "select") {
    const options = selectOptions(def.cellEditorParams);
    const control = createSelectControl({
      ariaLabel: def.headerName ?? def.field ?? column.id,
      options: options.map((item) => ({
        value: String(item.value),
        label: item.label,
        disabled: item.disabled
      })),
      value: String(value ?? ""),
      classNames: {
        root: "mach-editor-select-control",
        native: "mach-editor-select"
      }
    });
    return {
      el: control.el,
      getValue: () => {
        const selected = control.getValue();
        const match = options.find((item) => String(item.value) === selected);
        return match?.value ?? selected;
      },
      focus: () => control.focus(),
      destroy: () => control.destroy()
    };
  }

  const input = baseInput("text", value);
  if (keyPress && keyPress.length === 1) input.value = keyPress;
  return {
    el: input,
    getValue: () => input.value,
    focus: () => {
      input.focus({ preventScroll: true });
      input.select();
    }
  };
}
