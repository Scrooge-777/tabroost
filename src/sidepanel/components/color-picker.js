/**
 * Color Picker Component — radio group of swatches matching tabGroups colors
 */

import { COLOR_KEYS, DEFAULT_COLOR, getColor, applyColorVars, isValidColor } from '../../shared/colors.js';

export function renderColorPicker({ selectedColor = DEFAULT_COLOR, onSelect, label = 'Color' } = {}) {
  const container = document.createElement('div');
  container.className = 'swatch-row';
  container.setAttribute('role', 'radiogroup');
  container.setAttribute('aria-label', label);

  let currentSelected = isValidColor(selectedColor) ? selectedColor : DEFAULT_COLOR;
  const swatches = [];

  const sync = () => {
    swatches.forEach((s) => {
      const on = s.dataset.color === currentSelected;
      s.classList.toggle('is-selected', on);
      s.setAttribute('aria-checked', String(on));
      s.tabIndex = on ? 0 : -1;
    });
  };

  const select = (key, focus = false) => {
    currentSelected = key;
    sync();
    if (focus) swatches.find((s) => s.dataset.color === key)?.focus();
    onSelect?.(key);
  };

  COLOR_KEYS.forEach((key) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'swatch';
    swatch.dataset.color = key;
    swatch.setAttribute('role', 'radio');
    swatch.setAttribute('aria-label', getColor(key).name);
    swatch.title = getColor(key).name;
    applyColorVars(swatch, key);
    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      select(key);
    });
    swatch.addEventListener('keydown', (e) => {
      const idx = COLOR_KEYS.indexOf(key);
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        select(COLOR_KEYS[(idx + 1) % COLOR_KEYS.length], true);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        select(COLOR_KEYS[(idx - 1 + COLOR_KEYS.length) % COLOR_KEYS.length], true);
      }
    });
    swatches.push(swatch);
    container.appendChild(swatch);
  });
  sync();

  return {
    element: container,
    getSelected: () => currentSelected,
    setSelected: (newColor) => {
      currentSelected = isValidColor(newColor) ? newColor : DEFAULT_COLOR;
      sync();
    }
  };
}
