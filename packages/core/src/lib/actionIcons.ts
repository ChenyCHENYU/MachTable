/** Named glyphs keep Core editing independent from the optional row-action icon set. */
export const EDIT_ICON_PATH = '<path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5z"/>';
export const CLOSE_ICON_PATH = '<path d="M3.5 3.5l9 9m0-9l-9 9"/>';
export const CHECK_ICON_PATH = '<path d="M2.5 8.5l3.5 3.5 7.5-8"/>';

/** Internal action glyphs shared by row actions and editing controls. */
export const ICON_PATHS = {
  edit: EDIT_ICON_PATH,
  delete: '<path d="M3 5h10M6 5V3h4v2M5 5l.7 8h4.6L11 5"/>',
  view: '<path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/>',
  copy: '<rect x="5" y="5" width="8" height="8" rx="1"/><path d="M3 11V3h8"/>',
  download: '<path d="M8 2v8m0 0l-3-3m3 3l3-3M2.5 13.5h11"/>',
  refresh: '<path d="M13 3v4h-4M3 13V9h4"/><path d="M13 7a5.5 5.5 0 00-9.7-2.6M3 9a5.5 5.5 0 009.7 2.6"/>',
  close: CLOSE_ICON_PATH,
  check: CHECK_ICON_PATH,
  plus: '<path d="M8 2.5v11M2.5 8h11"/>',
  search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
  more: '<circle cx="3" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="13" cy="8" r=".9" fill="currentColor" stroke="none"/>'
} as const;

export type BuiltInActionIcon = keyof typeof ICON_PATHS;

/** Wraps package-owned path markup in the shared monochrome SVG style. */
export function iconSvg(path: string, size = 14): string {
  return `<svg viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
