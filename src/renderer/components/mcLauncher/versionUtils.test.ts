import {
  inferVersionType,
  inferUpdateKey,
  sortVersionGroupKey,
  SNAPSHOTS_GROUP_KEY,
} from './versionUtils';

describe('versionUtils', () => {
  describe('inferVersionType', () => {
    it('correctly classifies legacy 1.x versions', () => {
      expect(inferVersionType('1.12.2')).toBe('legacy');
      expect(inferVersionType('1.8.9')).toBe('legacy');
      expect(inferVersionType('1.7.10')).toBe('legacy');
    });

    it('correctly classifies modern 1.x releases', () => {
      expect(inferVersionType('1.13')).toBe('release');
      expect(inferVersionType('1.20.1')).toBe('release');
      expect(inferVersionType('1.21')).toBe('release');
      expect(inferVersionType('1.21.4')).toBe('release');
    });

    it('correctly classifies post-1.21 releases as release (not legacy)', () => {
      expect(inferVersionType('26.1')).toBe('release');
      expect(inferVersionType('26.2')).toBe('release');
      expect(inferVersionType('26.1.1')).toBe('release');
    });

    it('correctly classifies snapshots', () => {
      expect(inferVersionType('24w40a')).toBe('snapshot');
      expect(inferVersionType('26w07a')).toBe('snapshot');
      expect(inferVersionType('1.21-pre1')).toBe('snapshot');
      expect(inferVersionType('26.1-rc1')).toBe('snapshot');
      expect(inferVersionType('1.21-snapshot-1')).toBe('snapshot');
    });
  });

  describe('inferUpdateKey', () => {
    it('groups 1.x versions by major.minor update', () => {
      expect(inferUpdateKey('1.21', 'release')).toBe('1.21');
      expect(inferUpdateKey('1.21.1', 'release')).toBe('1.21');
      expect(inferUpdateKey('1.21.4', 'release')).toBe('1.21');
      expect(inferUpdateKey('1.20', 'release')).toBe('1.20');
      expect(inferUpdateKey('1.20.6', 'release')).toBe('1.20');
    });

    it('groups post-1.21 versions (26.1, 26.2, 26.1.1) into the same year update key "26"', () => {
      expect(inferUpdateKey('26.1', 'release')).toBe('26');
      expect(inferUpdateKey('26.2', 'release')).toBe('26');
      expect(inferUpdateKey('26.1.1', 'release')).toBe('26');
      expect(inferUpdateKey('26.2.2', 'release')).toBe('26');
      expect(inferUpdateKey('26', 'release')).toBe('26');
    });

    it('groups snapshots under SNAPSHOTS_GROUP_KEY', () => {
      expect(inferUpdateKey('26w07a', 'snapshot')).toBe(SNAPSHOTS_GROUP_KEY);
      expect(inferUpdateKey('24w40a', 'snapshot')).toBe(SNAPSHOTS_GROUP_KEY);
    });
  });

  describe('sortVersionGroupKey', () => {
    it('sorts new calendar-year groups ahead of 1.x groups and snapshots last', () => {
      const keys = ['1.12', SNAPSHOTS_GROUP_KEY, '1.20', '26', '1.21', '27'];
      const sorted = [...keys].sort(sortVersionGroupKey);
      expect(sorted).toEqual(['27', '26', '1.21', '1.20', '1.12', SNAPSHOTS_GROUP_KEY]);
    });

    it('correctly compares individual keys', () => {
      expect(sortVersionGroupKey('26', '1.21')).toBeLessThan(0);
      expect(sortVersionGroupKey('1.21', '26')).toBeGreaterThan(0);
      expect(sortVersionGroupKey('27', '26')).toBeLessThan(0);
      expect(sortVersionGroupKey('26', '27')).toBeGreaterThan(0);
      expect(sortVersionGroupKey('1.21', '1.20')).toBeLessThan(0);
      expect(sortVersionGroupKey('1.20', '1.21')).toBeGreaterThan(0);
      expect(sortVersionGroupKey('26', SNAPSHOTS_GROUP_KEY)).toBeLessThan(0);
      expect(sortVersionGroupKey(SNAPSHOTS_GROUP_KEY, '26')).toBeGreaterThan(0);
      expect(sortVersionGroupKey('26', '26')).toBe(0);
    });
  });
});
