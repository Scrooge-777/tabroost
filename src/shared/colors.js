/**
 * Workspace color palette mapped 1:1 to Chrome/Brave tabGroups color names.
 * Hex values follow Chromium's own tab group palette so a workspace color
 * matches the group colors on the tab strip, in both light and dark themes.
 */

export const WORKSPACE_COLORS = {
  blue: { id: 'blue', name: 'Blue', hex: '#1a73e8', darkHex: '#8ab4f8' },
  cyan: { id: 'cyan', name: 'Cyan', hex: '#007b83', darkHex: '#78d9ec' },
  green: { id: 'green', name: 'Green', hex: '#188038', darkHex: '#81c995' },
  yellow: { id: 'yellow', name: 'Yellow', hex: '#e8a200', darkHex: '#fdd663' },
  orange: { id: 'orange', name: 'Orange', hex: '#e8710a', darkHex: '#fcad70' },
  red: { id: 'red', name: 'Red', hex: '#d93025', darkHex: '#f28b82' },
  pink: { id: 'pink', name: 'Pink', hex: '#d01884', darkHex: '#ff8bcb' },
  purple: { id: 'purple', name: 'Purple', hex: '#a142f4', darkHex: '#c58af9' },
  grey: { id: 'grey', name: 'Grey', hex: '#5f6368', darkHex: '#bdc1c6' }
};

export const COLOR_KEYS = Object.keys(WORKSPACE_COLORS);
export const DEFAULT_COLOR = 'blue';

export function getColor(colorId) {
  return WORKSPACE_COLORS[colorId] || WORKSPACE_COLORS[DEFAULT_COLOR];
}

export function isValidColor(colorId) {
  return Boolean(WORKSPACE_COLORS[colorId]);
}

/**
 * Pick the first color not already used by any workspace, cycling when all are taken.
 */
export function nextUnusedColor(usedColors = [], offset = 0) {
  const used = new Set(usedColors);
  return COLOR_KEYS.find((c) => !used.has(c)) || COLOR_KEYS[offset % COLOR_KEYS.length];
}

/**
 * Apply a color as CSS custom properties (--c-light / --c-dark) so stylesheets
 * can choose the right variant for the active theme.
 */
export function applyColorVars(element, colorId) {
  const def = getColor(colorId);
  element.style.setProperty('--c-light', def.hex);
  element.style.setProperty('--c-dark', def.darkHex);
}
