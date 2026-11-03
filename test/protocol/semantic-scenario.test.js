const test = require('node:test');
const assert = require('node:assert/strict');

const { runSemanticScenario } = require('./harness');

test('runs a declarative login and held-item scenario against a loopback server', async () => {
  const result = await runSemanticScenario({
    name: 'loopback-held-item',
    version: '1.8.9',
    script: `
      const { join } = require('JNbot');
      const bot = await join({ username: 'fixture_bot' }, { login: false });
      bot.setQuickBarSlot(2);
      script.stop();
    `,
    steps: [
      { send: 'spawn' },
      { expect: 'held_item_slot', slot: 2 },
    ],
  });

  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.remainingSteps, []);
  assert.equal(result.connections, 1);
});

test('routes plugin HTTP through declared fixtures instead of the network', async () => {
  const result = await runSemanticScenario({
    name: 'fixture-http',
    version: '1.8.9',
    script: `
      const axios = require('axios');
      const response = await axios.get('https://stats.example.test/profile/fixture_bot');
      if (response.data.rank !== 'MVP') throw new Error('fixture response was not returned');
      script.stop();
    `,
    http: [
      {
        method: 'GET',
        url: 'https://stats.example.test/profile/fixture_bot',
        data: { rank: 'MVP' },
      },
    ],
    steps: [],
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.connections, 0);
});

test('a cracked account logs in with its configured password', async () => {
  const result = await runSemanticScenario({
    name: 'cracked-login',
    version: '1.8.9',
    script: `
      const { join } = require('JNbot');
      await join({ username: 'fixture_alt' }, { login: true, joinGamemode: false });
      script.stop();
    `,
    settings: { altData: { fixture_alt: { password: 'fixture-secret' } } },
    sharedSettings: { alts: [{ username: 'fixture_alt' }] },
    steps: [
      { send: 'spawn' },
      { expect: 'chat', message: '/login fixture-secret' },
    ],
  });

  assert.deepEqual(result.remainingSteps, []);
  assert.equal(result.connections, 1);
});
