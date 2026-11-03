import { STATIC_JNDATA } from '../../src/common/jndata';

describe('static JNdata', () => {
  test('lists Minecraft 26.1 for bots and the full version picker', () => {
    expect(STATIC_JNDATA.versions).toContain('26.1');
    expect(STATIC_JNDATA.fullVersions.find((group) => group.value === '26')?.children)
      .toContainEqual({ value: '26.1', label: '26.1' });
  });

  test('lists no servers: those come from installed profiles', () => {
    expect(STATIC_JNDATA.serverList).toEqual([]);
  });
});
