const test = require('node:test');
const assert = require('node:assert/strict');
const minecraftData = require('minecraft-data');
const { protocolVersion } = require('./harness');

for (const version of ['1.8.9', '1.16.5', '1.19.4', '1.20.4', '1.21.11']) {
  test(`has protocol metadata for ${version}`, () => {
    const data = minecraftData(protocolVersion(version));
    assert.ok(data, `${version} must remain supported by the fixture runner`);
    assert.ok(Number.isInteger(data.version.version));
  });
}
