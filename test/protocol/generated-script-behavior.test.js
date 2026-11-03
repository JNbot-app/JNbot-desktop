const test = require('node:test');
const assert = require('node:assert/strict');
const { runGeneratedAction, runGeneratedScript, window } = require('./generated-action-harness');

for (const serverName of ['jartexnetwork', 'pikanetwork']) {
  test(`${serverName} Gkit Collector claims only enabled Gkits`, async () => {
    const result = await runGeneratedAction({
      serverName, plugin: 'Gkit Collector',
      settings: { gamemode: 'SkyblockDream', itemTransfer: 'keep', transferOnNearFull: false, ignoreItems: [], ignoreGkits: ['keys'] },
      server: {
        command(bot, command) {
          assert.equal(command, '/gkit');
          bot.currentWindow = window('Gkit Selector', [
            { slot: 3, name: 'Keys', info: 'Click to redeem this Gkit' },
            { slot: 7, name: 'Hero', info: 'You can claim this Gkit' },
          ]);
        },
        click(bot, slot) { assert.equal(slot, 7); bot.currentWindow.slots[slot] = null; },
      },
    });
    assert.deepEqual(result.actions.commands, ['/gkit']);
    assert.deepEqual(result.actions.clicks.map(({ slot }) => slot), [7]);
    assert.equal(result.effects.reminders[0].reminderId, 'SkyblockDream');
  });

  test(`${serverName} Kit Collector skips locked kits and claims selected kits`, async () => {
    const result = await runGeneratedAction({
      serverName, plugin: 'Kit Collector',
      settings: {
        gamemode: 'SkyblockDream', command: '/kit', kits: ['starter', 'food'],
        transferMode: 'keep', username: 'main_account', trashItems: [], unequipArmor: false,
      },
      server: {
        command(bot, command) {
          assert.equal(command, '/kit');
          bot.currentWindow = window('Kits', [
            { slot: 2, name: 'Starter Kit', info: 'You do not own this' },
            { slot: 8, name: 'Food Kit', info: 'Click to claim' },
          ]);
        },
        click(bot, slot) { assert.equal(slot, 8); bot.currentWindow = null; },
      },
    });
    assert.deepEqual(result.actions.clicks.map(({ slot }) => slot), [8]);
    assert.equal(result.actions.commands.filter((value) => value === '/kit').length, 2);
    assert.equal(result.actions.transfers.at(-1).mode, 'keep');
  });
}

test('Gkit Collector rejects transfer settings without a recipient', async () => {
  const result = await runGeneratedAction({
    serverName: 'jartexnetwork', plugin: 'Gkit Collector',
    settings: { gamemode: 'SkyblockDream', itemTransfer: 'gift', ignoreItems: [], ignoreGkits: [] },
    server: {},
  });
  assert.equal(result.effects.stopped, true);
  assert.equal(result.effects.optionErrors[0].field, 'username');
  assert.equal(result.effects.optionErrors[0].message, 'Enter an account to transfer the gkits to');
  assert.deepEqual(result.actions.commands, []);
});

for (const [serverName, gamemode, apiServer] of [
  ['jartexnetwork', 'SkyblockDream', 'sb_dream'],
  ['pikanetwork', 'OPSkyblock', 'opsb'],
]) {
  test(`${serverName} Alt Scanner uses fixture-backed ranks and emits one alt update`, async () => {
    const result = await runGeneratedScript({
      serverName, plugin: 'Alt Scanner',
      settings: { gamemodes: [gamemode], ranksOnly: true },
      alts: [{ username: 'fixture_alt' }],
      httpResponse: { ranks: [{ server: apiServer, displayName: 'Diamond' }] },
    });
    assert.equal(result.effects.requests.length, 1);
    assert.equal(result.effects.altUpdates.length, 1);
    assert.equal(result.effects.altUpdates[0].fixture_alt.ranks[gamemode.toLowerCase()], 'diamond');
  });
}

test('Book Sorter validates malformed book settings before joining', async () => {
  const result = await runGeneratedScript({
    serverName: 'jartexnetwork', plugin: 'Book sorter',
    settings: { books: [{ book: '', minLevel: 0, pv: 0 }] },
  });
  assert.equal(result.effects.stopped, true);
  assert.equal(result.effects.optionErrors[0].field, 'books');
});
