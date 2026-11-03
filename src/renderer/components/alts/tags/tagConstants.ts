export const TAG_COLOR_PALETTE = [
  '#f5222d',
  '#fa541c',
  '#fa8c16',
  '#faad14',
  '#a0d911',
  '#52c41a',
  '#13c2c2',
  '#1677ff',
  '#2f54eb',
  '#722ed1',
  '#eb2f96',
  '#8c8c8c',
];

export const DEFAULT_TAG_COLOR = TAG_COLOR_PALETTE[7];

export const newTagId = (): string =>
  `tag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
