/**
 * Inline SVG icons (16px grid, currentColor). Kept as strings so components can
 * drop them into innerHTML without extra requests.
 */

const svg = (body, { size = 16, fill = 'none', stroke = 'currentColor', width = 1.5 } = {}) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 16 16" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  logo: svg('<rect x="1.75" y="4.25" width="9.5" height="9.5" rx="2.25" fill="currentColor" fill-opacity=".18"/><path d="M5 4.25V3.5a1.75 1.75 0 0 1 1.75-1.75h5.75A1.75 1.75 0 0 1 14.25 3.5v5.75A1.75 1.75 0 0 1 12.5 11h-1.25"/>', { size: 18 }),
  plus: svg('<path d="M8 3.25v9.5M3.25 8h9.5"/>', { width: 1.75 }),
  settings: svg('<circle cx="8" cy="8" r="2.1"/><path d="M8 1.75v1.5M8 12.75v1.5M3.58 3.58l1.06 1.06M11.36 11.36l1.06 1.06M1.75 8h1.5M12.75 8h1.5M3.58 12.42l1.06-1.06M11.36 4.64l1.06-1.06"/>'),
  panel: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M10 2.5v11"/>'),
  search: svg('<circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3.25 3.25"/>'),
  chevronRight: svg('<path d="m6 3.75 4.25 4.25L6 12.25"/>', { width: 1.6 }),
  chevronDown: svg('<path d="M3.75 6 8 10.25 12.25 6"/>', { width: 1.6 }),
  more: svg('<circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/><circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none"/>'),
  close: svg('<path d="m4.25 4.25 7.5 7.5M11.75 4.25l-7.5 7.5"/>', { width: 1.6 }),
  check: svg('<path d="m3.25 8.25 3 3 6.5-6.5"/>', { width: 1.75 }),
  edit: svg('<path d="M10.5 2.75 13.25 5.5l-7.5 7.5H3v-2.75z"/><path d="m9 4.25 2.75 2.75"/>'),
  trash: svg('<path d="M2.75 4.25h10.5M6.25 4.25V2.75h3.5v1.5M4.25 4.25l.6 8.6a1.25 1.25 0 0 0 1.25 1.15h3.8a1.25 1.25 0 0 0 1.25-1.15l.6-8.6M6.75 7v4.25M9.25 7v4.25"/>'),
  duplicate: svg('<rect x="5.25" y="5.25" width="8" height="8" rx="1.75"/><path d="M10.75 5.25V4A1.25 1.25 0 0 0 9.5 2.75H4A1.25 1.25 0 0 0 2.75 4v5.5A1.25 1.25 0 0 0 4 10.75h1.25"/>'),
  open: svg('<path d="M9.25 2.75h4v4M13.25 2.75 7.5 8.5M11.25 9.5v2.75a1 1 0 0 1-1 1H3.75a1 1 0 0 1-1-1V5.75a1 1 0 0 1 1-1H6.5"/>'),
  windowClose: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="m6 6.5 4 4M10 6.5l-4 4"/>'),
  window: svg('<rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M2 5.75h12"/>'),
  save: svg('<path d="M3 3.75A1.25 1.25 0 0 1 4.25 2.5h6.4l2.35 2.35v7.4a1.25 1.25 0 0 1-1.25 1.25h-7.5A1.25 1.25 0 0 1 3 12.25z"/><path d="M5.5 2.5v3h4.25v-3M5.25 13.5V9.5h5.5v4"/>'),
  pin: svg('<path d="M9.75 2.25 13.75 6.25l-1.5.5-2.5 2.5-.5 3-1.5 1.5-5-5 1.5-1.5 3-.5 2.5-2.5z"/><path d="m5.25 10.75-3 3"/>'),
  popout: svg('<path d="M9.25 2.75h4v4M13.25 2.75 8 8M6.75 3.5H4A1.25 1.25 0 0 0 2.75 4.75v7.25A1.25 1.25 0 0 0 4 13.25h7.25A1.25 1.25 0 0 0 12.5 12V9.25"/>'),
  ungroup: svg('<rect x="2" y="2" width="5" height="5" rx="1.25"/><rect x="9" y="9" width="5" height="5" rx="1.25"/><path d="M9.5 4.5h2a1 1 0 0 1 1 1v1.75M6.5 11.5h-2a1 1 0 0 1-1-1V8.75"/>'),
  sparkle: svg('<path d="M8 1.75 9.3 6.7 14.25 8 9.3 9.3 8 14.25 6.7 9.3 1.75 8 6.7 6.7z" fill="currentColor" fill-opacity=".15"/>'),
  sort: svg('<path d="M5 2.75v10.5M2.75 11 5 13.25 7.25 11M11 13.25V2.75M8.75 5 11 2.75 13.25 5"/>'),
  newTab: svg('<rect x="2" y="3.5" width="12" height="10" rx="2" fill="currentColor" fill-opacity=".12"/><path d="M8 6.5v4M6 8.5h4"/>'),
  grip: svg('<circle cx="6" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="6" cy="12" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="12" r=".9" fill="currentColor" stroke="none"/>'),
  undo: svg('<path d="M5.5 3.25 2.75 6 5.5 8.75"/><path d="M2.75 6h6.5a4 4 0 0 1 0 8H7"/>'),
  switchLast: svg('<path d="M11 2.75 13.25 5 11 7.25M13.25 5h-8M5 8.75 2.75 11 5 13.25M2.75 11h8"/>'),
  bookmark: svg('<path d="M4 2.75h8v10.5L8 10.5l-4 2.75z"/>')
};
