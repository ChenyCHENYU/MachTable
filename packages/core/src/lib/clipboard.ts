import { sanitizeFormulaCell } from "./csv";

function escapeCell(value: any, protectFormulas: boolean): string {
  const safe = protectFormulas ? sanitizeFormulaCell(value) : value;
  const s = safe == null ? "" : String(safe);
  if (/["\t\n\r]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
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
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === separator) {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (ch === "\r" && text[i + 1] === "\n") i += 2;
      else i++;
      continue;
    }
    cell += ch;
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
