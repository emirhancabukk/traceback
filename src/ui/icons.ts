import type { EntryType } from '../core/model';

/**
 * Inline SVG icons on a 16×16 grid. They inherit `currentColor`, so they
 * follow the text colour, and they render the same on every system, unlike
 * Unicode symbols that depend on the installed fonts.
 */
const PATHS = {
  source: '<circle cx="8" cy="8" r="5.25"/><circle cx="8" cy="8" r="1.9" fill="currentColor" stroke="none"/>',
  note: '<path d="M3 13l.9-3.2 6.6-6.6a1.5 1.5 0 0 1 2.1 0l.2.2a1.5 1.5 0 0 1 0 2.1L6.2 12.1z"/><path d="M9.3 4.4l2.3 2.3"/>',
  decision: '<circle cx="8" cy="8" r="5.25"/><circle cx="8" cy="8" r="2.1"/>',
  command: '<path d="M3 4.5 6.5 8 3 11.5"/><path d="M8.5 11.5H13"/>',
  'file-change': '<path d="M4 2.5h4.8L12 5.7v7.8H4z"/><path d="M8.5 2.5V6H12"/><path d="M6.3 9.6h3.4M8 7.9v3.4"/>',
  timeline:
    '<path d="M4 3v10" opacity=".55"/><circle cx="4" cy="4" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><path d="M7.5 4H13M7.5 8h4M7.5 12H13"/>',
  map: '<path d="M2.5 5.5H11"/><path d="M8.5 3 11 5.5 8.5 8"/><path d="M13.5 10.5H5"/><path d="M7.5 8 5 10.5 7.5 13"/>',
  graph:
    '<circle cx="4" cy="11.5" r="1.9"/><circle cx="12" cy="11.5" r="1.9"/><circle cx="8" cy="4" r="1.9"/><path d="M5 9.8 7 5.7M11 9.8 9 5.7M5.9 11.5h4.2"/>',
  search: '<circle cx="7" cy="7" r="4.25"/><path d="m10.2 10.2 3.3 3.3"/>',
  plus: '<path d="M8 3.5v9M3.5 8h9"/>',
  close: '<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>',
  swap: '<path d="M3 5.5h9.5"/><path d="M10.5 3.5 12.5 5.5 10.5 7.5"/><path d="M13 10.5H3.5"/><path d="M5.5 8.5 3.5 10.5 5.5 12.5"/>',
  edit: '<path d="M3 13l.9-3.2 6.6-6.6a1.5 1.5 0 0 1 2.1 0l.2.2a1.5 1.5 0 0 1 0 2.1L6.2 12.1z"/>',
  trash: '<path d="M3 4.5h10"/><path d="M6.5 4.5V3h3v1.5"/><path d="M4.8 4.5l.6 8.5h5.2l.6-8.5"/>',
  replace: '<path d="M2.5 8h8.5"/><path d="M8.5 5.5 11 8l-2.5 2.5"/><path d="M13.5 4v8"/>',
  link: '<path d="M6.5 9.5l3-3"/><path d="M7.4 4.6l.9-.9a2.6 2.6 0 0 1 3.7 3.7l-.9.9M8.6 11.4l-.9.9A2.6 2.6 0 0 1 4 8.6l.9-.9"/>',
  download: '<path d="M8 2.5v8"/><path d="M5 7.5l3 3 3-3"/><path d="M3 13.5h10"/>',
  bolt: '<path d="M9.25 2.1 4.9 8.75H8l-1.25 5.15L11.1 7H8z" fill="currentColor" stroke="none"/>',
} as const;

export type IconName = keyof typeof PATHS;

const TYPE_ICONS: Record<EntryType, IconName> = {
  source: 'source',
  note: 'note',
  decision: 'decision',
  command: 'command',
  'file-change': 'file-change',
};

export function icon(name: IconName, size = 16): string {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${PATHS[name]}</svg>`;
}

export function typeIcon(type: EntryType, size = 14): string {
  return icon(TYPE_ICONS[type], size);
}
