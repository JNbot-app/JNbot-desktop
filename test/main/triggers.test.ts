import {
  compileTriggerFilter,
  formatTriggerText,
  migrateLegacyTriggers,
  triggerAppliesTo,
  triggerProblem,
  type Trigger,
} from '../../src/common/triggers';

const trigger = (patch: Partial<Trigger> = {}): Trigger => ({
  id: 't',
  event: 'chat',
  enabled: true,
  actions: [{ type: 'notification' }],
  ...patch,
});

describe('triggers', () => {
  it('matches chat by text or regex', () => {
    expect(compileTriggerFilter(trigger())('anything')).toBe(true);
    const contains = compileTriggerFilter(trigger({ filter: 'Pay' }));
    expect(contains('Steve paid you: /pay me')).toBe(true);
    expect(contains('hello')).toBe(false);
    const regex = compileTriggerFilter(trigger({ filter: '/^\\[MSG\\]/g' }));
    expect(regex('[MSG] hi')).toBe(true);
    expect(regex('[MSG] hi')).toBe(true); // no stateful lastIndex
    expect(triggerProblem(trigger({ filter: '/(/' }))).toMatch(/regular/);
  });

  it('matches players and health thresholds', () => {
    const players = compileTriggerFilter(
      trigger({ event: 'playerNearby', filter: 'Steve, alex' }),
    );
    expect(players('ALEX')).toBe(true);
    expect(players('Herobrine')).toBe(false);
    const health = compileTriggerFilter(
      trigger({ event: 'lowHealth', filter: '8' }),
    );
    expect(health(7)).toBe(true);
    expect(health(8)).toBe(false);
  });

  it('targets all bots, accounts or tags', () => {
    const tags = [{ id: 'farm', alts: ['bot1'] }];
    expect(triggerAppliesTo({}, 'any', tags)).toBe(true);
    expect(triggerAppliesTo({ alts: ['bot2'] }, 'bot2', tags)).toBe(true);
    expect(triggerAppliesTo({ tags: ['farm'] }, 'bot1', tags)).toBe(true);
    expect(triggerAppliesTo({ tags: ['farm'] }, 'bot2', tags)).toBe(false);
  });

  it('validates actions', () => {
    expect(triggerProblem(trigger({ actions: [] }))).toMatch(/action/);
    expect(
      triggerProblem(trigger({ actions: [{ type: 'discord', webhook: 'x' }] })),
    ).toMatch(/webhook/);
    expect(triggerProblem(trigger())).toBeNull();
  });

  it('formats placeholders', () => {
    expect(formatTriggerText('/msg {player} hi {x}', { player: 'Steve' })).toBe(
      '/msg Steve hi {x}',
    );
  });

  it('migrates the legacy bitmask format', () => {
    /* eslint-disable no-bitwise */
    expect(
      migrateLegacyTriggers({
        on_kicked: {
          active: (1 << 1) | (1 << 2),
          webhook: 'https://w',
          onByDefault: true,
        },
        on_private_message: { active: 1 << 2 },
        on_death: { active: 0 },
      }),
    ).toEqual([
      {
        id: 'legacy-on_kicked',
        event: 'kicked',
        enabled: true,
        actions: [
          { type: 'notification' },
          { type: 'discord', webhook: 'https://w' },
        ],
      },
    ]);
    expect(migrateLegacyTriggers(undefined)).toEqual([]);
  });
});
