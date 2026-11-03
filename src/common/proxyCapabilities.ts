export type ProxyCapability =
  | 'world'
  | 'inventory'
  | 'health'
  | 'position'
  | 'entities'
  | 'experience'
  | 'abilities'
  | 'held_item';

export const DEFAULT_PROXY_CAPABILITIES: readonly ProxyCapability[] = [
  'world',
  'inventory',
  'health',
  'position',
  'entities',
  'experience',
  'abilities',
  'held_item',
] as const;

export const ALL_PROXY_CAPABILITIES = DEFAULT_PROXY_CAPABILITIES;
