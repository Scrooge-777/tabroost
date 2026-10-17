/**
 * Color Picker Component — Renders color circles matching tabGroups colors
 */

import { WORKSPACE_COLORS, COLOR_KEYS, DEFAULT_COLOR } from '../../shared/colors.js';

export function renderColorPicker({ selectedColor = DEFAULT_COLOR, onSelect } = {}) {
  const container = document.createElement('div');
  container.className = 'color-picker-grid';

  let currentSelected = selectedColor;

  COLOR_KEYS.forEach((colorKey) => {
    const colorDef = WORKSPACE_COLORS[colorKey];
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = `color-swatch ${colorKey === currentSelected ? 'selected' : ''}`;
    swatch.style.backgroundColor = colorDef.hex;
    swatch.title = colorDef.name;
    swatch.setAttribute('aria-label', colorDef.name);

    swatch.addEventListener('click', (e) => {
      e.stopPropagation();
      container.querySelectorAll('.color-swatch').forEach((s) => s.classList.remove('selected'));
      swatch.classList.add('selected');
      currentSelected = colorKey;
      if (typeof onSelect === 'function') {
        onSelect(colorKey);
      }
    });

    container.appendChild(swatch);
  });

  return {
    element: container,
    getSelected: () => currentSelected,
    setSelected: (newColor) => {
      currentSelected = newColor;
      container.querySelectorAll('.color-swatch').forEach((s, idx) => {
        s.classList.toggle('selected', COLOR_KEYS[idx] === newColor);
      });
    }
  };
}
