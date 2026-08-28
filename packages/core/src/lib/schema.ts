import type { ColDef, ColDefGroup } from "../types/colDef";

export type GridSchemaFieldType = "string" | "number" | "date" | "select" | "boolean";

export interface SchemaSelectOption {
  label: string;
  value: string | number;
}

export interface GridSchemaField {
  field: string;
  title?: string;
  type?: GridSchemaFieldType;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  flex?: number;
  pinned?: "left" | "right";
  editable?: boolean;
  sortable?: boolean;
  filterable?: boolean;
  resizable?: boolean;
  hidden?: boolean;
  options?: SchemaSelectOption[];
  format?: "date" | "datetime";
  cellClass?: string | string[];
}

export interface GridSchemaGroup {
  title: string;
  fields: string[];
}

export interface GridSchema {
  fields: GridSchemaField[];
  groups?: GridSchemaGroup[];
}

function booleanFormatter(p: { value: any }): string {
  if (p.value === true) return "是";
  if (p.value === false) return "否";
  return "";
}

function dateFormatter(format: "date" | "datetime" | undefined): (p: { value: any }) => string {
  return (p) => {
    if (p.value == null || p.value === "") return "";
    const text = p.value instanceof Date ? p.value.toISOString() : String(p.value);
    return format === "datetime" ? text.slice(0, 16).replace("T", " ") : text.slice(0, 10);
  };
}

function selectFormatter(options: SchemaSelectOption[]): (p: { value: any }) => string {
  return (p) => {
    if (p.value == null) return "";
    const hit = options.find((o) => o.value === p.value);
    return hit ? hit.label : String(p.value);
  };
}

function fieldToColDef(field: GridSchemaField): ColDef<any> {
  const type = field.type ?? "string";
  const colDef: ColDef<any> = {
    colId: field.field,
    field: field.field,
    headerName: field.title ?? field.field,
    width: field.width,
    minWidth: field.minWidth,
    maxWidth: field.maxWidth,
    flex: field.flex,
    pinned: field.pinned ?? undefined,
    hide: field.hidden ?? false,
    editable: field.editable ?? false,
    sortable: field.sortable ?? true,
    resizable: field.resizable ?? true,
    filter: field.filterable === false ? false : type === "number" ? "number" : type === "date" ? "date" : type === "select" ? "set" : "text",
    cellClass: field.cellClass
  };

  if (type === "number") {
    colDef.type = "rightAligned";
  } else if (type === "date") {
    colDef.valueFormatter = dateFormatter(field.format);
  } else if (type === "boolean") {
    colDef.valueFormatter = booleanFormatter;
    colDef.filter = field.filterable === false ? false : "set";
  } else if (type === "select") {
    const options = field.options ?? [];
    colDef.valueFormatter = selectFormatter(options);
    if (field.editable) {
      colDef.cellEditor = "select";
      colDef.cellEditorParams = { values: options.map((o) => o.value) };
    }
  }

  return colDef;
}

export function buildColDefsFromSchema<TData = any>(
  schema: GridSchema
): (ColDef<TData> | ColDefGroup<TData>)[] {
  const byField = new Map(schema.fields.map((f) => [f.field, f]));
  const used = new Set<string>();
  const result: (ColDef<TData> | ColDefGroup<TData>)[] = [];

  for (const field of schema.fields) {
    if (used.has(field.field)) continue;
    const grouped = (schema.groups ?? []).some((g) => g.fields.includes(field.field));
    if (!grouped) {
      result.push(fieldToColDef(field));
      used.add(field.field);
    }
  }

  for (const group of schema.groups ?? []) {
    const children: ColDef<TData>[] = [];
    for (const fieldName of group.fields) {
      const field = byField.get(fieldName);
      if (!field || used.has(fieldName)) continue;
      children.push(fieldToColDef(field));
      used.add(fieldName);
    }
    if (children.length > 0) {
      result.push({ headerName: group.title, children });
    }
  }

  return result;
}
