import { createElementPlusEditors, vueCellEditor } from "@agile-team/mach-table-vue/editors";

declare const component: Parameters<typeof vueCellEditor>[0];

export const editor = vueCellEditor(component, { focusSelector: "input" });
export const editors = createElementPlusEditors({ input: component, select: component });
