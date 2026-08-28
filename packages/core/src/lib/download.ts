export function escapeHtml(value: any): string {
  const s = value == null ? "" : String(value);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function downloadFile(filename: string, content: string, mime = "text/plain;charset=utf-8"): boolean {
  try {
    if (typeof document === "undefined" || typeof Blob === "undefined") return false;
    const a = document.createElement("a");
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      const blob = new Blob([content], { type: mime });
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      a.click();
      const revoke = typeof URL.revokeObjectURL === "function" ? URL.revokeObjectURL.bind(URL) : null;
      if (revoke) setTimeout(() => {
        try {
          revoke(url);
        } catch {
          void 0;
        }
      }, 0);
    } else {
      a.href = `data:${mime},${encodeURIComponent(content)}`;
      a.download = filename;
      a.click();
    }
    return true;
  } catch {
    return false;
  }
}
