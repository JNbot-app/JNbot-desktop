export type HttpFixture = {
  method: 'GET';
  url: string;
  data: unknown;
  status?: number;
  headers?: Record<string, string>;
};

export type ScenarioStep =
  | { send: 'spawn' }
  | { send: 'kick'; reason?: string }
  | { expect: 'held_item_slot'; slot: number }
  | { expect: 'chat'; message: string };

export type SemanticScenario = {
  name: string;
  version: string;
  script: string;
  steps: ScenarioStep[];
  http?: HttpFixture[];
  gamemodes?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  sharedSettings?: Record<string, unknown>;
  timeoutMs?: number;
};
