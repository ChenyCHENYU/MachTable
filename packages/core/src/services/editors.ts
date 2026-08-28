import type { ICellEditor } from "../types/params";
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

function inferEditorType(value: any, selectValues?: (string | number)[]): string {
  if (selectValues && selectValues.length > 0) return "select";
  if (typeof value === "number") return "number";
  if (value instanceof Date) return "date";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return "date";
  return "text";
}

export function createEditor(column: Column, value: any, keyPress?: string | null): ICellEditor {
  const def = column.colDef;
  const name = typeof def.cellEditor === "string" ? def.cellEditor : inferEditorType(value, def.cellEditorParams?.values);

  if (name === "number") {
    const input = baseInput("number", value);
    return {
      el: input,
      getValue: () => (input.value === "" ? null : Number(input.value)),
      focus: () => {
        input.focus();
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
      focus: () => input.focus()
    };
  }

  if (name === "select") {
    const values = def.cellEditorParams?.values ?? [];
    const select = document.createElement("select");
    select.className = "mach-editor-select";
    for (const v of values) {
      const option = document.createElement("option");
      option.value = String(v);
      option.textContent = String(v);
      if (String(value) === String(v)) option.selected = true;
      select.appendChild(option);
    }
    return {
      el: select,
      getValue: () => {
        const match = values.find((v) => String(v) === select.value);
        return match !== undefined ? match : select.value;
      },
      focus: () => select.focus()
    };
  }

  const input = baseInput("text", value);
  if (keyPress && keyPress.length === 1) input.value = keyPress;
  return {
    el: input,
    getValue: () => input.value,
    focus: () => {
      input.focus();
      input.select();
    }
  };
}
