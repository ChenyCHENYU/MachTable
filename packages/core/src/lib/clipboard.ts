import { csvEscape, sanitizeFormulaCell } from "./csv";

/** Clipboard cells intentionally follow JavaScript text coercion after an explicit serializer. */
export function clipboardText(value: any): string { return value == null ? "" : String(value); }

function escapeCell(value: any, protectFormulas: boolean): string {
  // TSV uses the same quoting rules as CSV, with its own tab delimiter.
  return csvEscape(protectFormulas ? sanitizeFormulaCell(value) : value, "\t");
}

export function toTsv(rows: any[][], protectFormulas = true): string {
  return rows.map((row) => row.map((value) => escapeCell(value, protectFormulas)).join("\t")).join("\n");
}

export function parseTsv(text: string): string[][] {
  return parseDelimited(text, "\t");
}

export function parseCsv(text: string, separator = ","): string[][] {
  return parseDelimited(text, separator);
}

export function parseDelimited(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' && (inQuotes || cell === "")) {
      if (inQuotes && text[i + 1] === '"') {
        cell += ch;
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (inQuotes) {
      cell += ch;
    } else if (ch === separator) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      cell += ch;
    }
    i++;
  }

  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function fallbackCopyText(text: string): boolean {
  let ta: HTMLTextAreaElement | null = null;
  try {
    ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    return ok;
  } catch {
    return false;
  } finally {
    ta?.remove();
  }
}

export async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    void 0;
  }
  return fallbackCopyText(text);
}
