import { chainReadyAt, fillPlaceholders } from '../../src/common/chains';
import type { Reminder } from '../../src/common/cooldowns';

const cooldown = (pluginId: string, time: number, length: number): Reminder => ({
  id: pluginId,
  name: pluginId,
  pluginId,
  cooldown: length,
  time,
});

it('uses the soonest cooldown among the chain’s actions', () => {
  const chain = {
    id: 'c1',
    chains: [
      { id: '1', name: 'Gkits', scriptId: 'gkit' },
      { id: '2', name: 'Kits', scriptId: 'kit' },
    ],
  };
  const reminders = [cooldown('gkit', 0, 500), cooldown('kit', 0, 200), cooldown('other', 0, 100)];
  expect(chainReadyAt(chain, reminders)).toBe(200);
  expect(chainReadyAt({ ...chain, chains: [] }, reminders)).toBeUndefined();
});

it('leaves unknown placeholders untouched', () => {
  expect(fillPlaceholders({ msg: '{alt} has {coins}', n: 3 }, { alt: 'Steve' })).toEqual({
    msg: 'Steve has {coins}',
    n: 3,
  });
});
