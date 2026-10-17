/**
 * Workspace color palette mapped 1:1 to Chrome/Brave tabGroups color names
 */

export const WORKSPACE_COLORS = {
  blue: {
    id: 'blue',
    name: 'Blue',
    hex: '#0078D4',
    subtleBg: 'rgba(0, 120, 212, 0.12)',
    borderHex: '#005A9E',
    tabGroupColor: 'blue'
  },
  cyan: {
    id: 'cyan',
    name: 'Cyan',
    hex: '#008272',
    subtleBg: 'rgba(0, 130, 114, 0.12)',
    borderHex: '#005B50',
    tabGroupColor: 'cyan'
  },
  green: {
    id: 'green',
    name: 'Green',
    hex: '#107C41',
    subtleBg: 'rgba(16, 124, 65, 0.12)',
    borderHex: '#0B5A2F',
    tabGroupColor: 'green'
  },
  yellow: {
    id: 'yellow',
    name: 'Yellow',
    hex: '#FFB900',
    subtleBg: 'rgba(255, 185, 0, 0.14)',
    borderHex: '#D19800',
    tabGroupColor: 'yellow'
  },
  orange: {
    id: 'orange',
    name: 'Orange',
    hex: '#D83B01',
    subtleBg: 'rgba(216, 59, 1, 0.12)',
    borderHex: '#A32B00',
    tabGroupColor: 'orange'
  },
  red: {
    id: 'red',
    name: 'Red',
    hex: '#E81123',
    subtleBg: 'rgba(232, 17, 35, 0.12)',
    borderHex: '#B50E1B',
    tabGroupColor: 'red'
  },
  pink: {
    id: 'pink',
    name: 'Pink',
    hex: '#E3008C',
    subtleBg: 'rgba(227, 0, 140, 0.12)',
    borderHex: '#B0006C',
    tabGroupColor: 'pink'
  },
  purple: {
    id: 'purple',
    name: 'Purple',
    hex: '#8764B8',
    subtleBg: 'rgba(135, 100, 184, 0.12)',
    borderHex: '#684B91',
    tabGroupColor: 'purple'
  },
  grey: {
    id: 'grey',
    name: 'Grey',
    hex: '#69797E',
    subtleBg: 'rgba(105, 121, 126, 0.12)',
    borderHex: '#4D595D',
    tabGroupColor: 'grey'
  }
};

export const COLOR_KEYS = Object.keys(WORKSPACE_COLORS);
export const DEFAULT_COLOR = 'blue';

export function getColor(colorId) {
  return WORKSPACE_COLORS[colorId] || WORKSPACE_COLORS[DEFAULT_COLOR];
}

export function isValidColor(colorId) {
  return Boolean(WORKSPACE_COLORS[colorId]);
}
