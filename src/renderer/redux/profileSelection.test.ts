import {
  clearSelectedProfileKey,
  getSelectedProfileKey,
  persistSelectedProfileKey,
} from './profileSelection';

describe('profile selection persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('uses the backend profile as a fallback', () => {
    expect(getSelectedProfileKey('jartexnetwork')).toBe('jartexnetwork');
  });

  it('restores the last selected profile', () => {
    persistSelectedProfileKey('pikanetwork');

    expect(getSelectedProfileKey('jartexnetwork')).toBe('pikanetwork');
    expect(window.localStorage.getItem('selectedProfileKey')).toBe(
      'pikanetwork',
    );
  });

  it('keeps the current tab selection ahead of the cross-session default', () => {
    window.localStorage.setItem('selectedProfileKey', 'jartexnetwork');
    window.sessionStorage.setItem('selectedProfileKey', 'pikanetwork');

    expect(getSelectedProfileKey()).toBe('pikanetwork');
  });

  it('keeps a failed profile selection cleared instead of restoring the fallback', () => {
    persistSelectedProfileKey('donutsmp');
    clearSelectedProfileKey();

    expect(getSelectedProfileKey('donutsmp')).toBeNull();

    persistSelectedProfileKey('pikanetwork');
    expect(getSelectedProfileKey('donutsmp')).toBe('pikanetwork');
  });

  it('tries the backend profile again in a new session', () => {
    persistSelectedProfileKey('donutsmp');
    clearSelectedProfileKey();
    window.sessionStorage.clear();

    expect(getSelectedProfileKey('jartexnetwork')).toBe('jartexnetwork');
  });
});
