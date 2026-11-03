import {
  accountAuthenticationError,
  isOnlineMode,
} from '../../src/common/serverAuthentication';
import { makeEmptyProfile } from '../../src/common/profiles';

describe('profile server authentication', () => {
  test('defaults missing profile metadata to cracked mode', () => {
    expect(isOnlineMode(undefined)).toBe(false);
    expect(makeEmptyProfile('custom').data.onlineMode).toBe(false);
  });

  test.each([false, true])(
    'allows blank passwords and no email for premium=%s on offline servers',
    (premium) => {
      expect(accountAuthenticationError({ premium }, false)).toBeNull();
      expect(
        accountAuthenticationError({ premium, password: 'x' }, false),
      ).toBeNull();
      expect(
        accountAuthenticationError({ premium, email: 'legacy-invalid' }, false),
      ).toBeNull();
    },
  );

  test('accepts email-free premium accounts and rejects cracked accounts on premium servers', () => {
    expect(
      accountAuthenticationError({ premium: false, password: 'secret' }, true),
    ).toMatch(/Premium servers/);
    expect(accountAuthenticationError({ premium: true }, true)).toBeNull();
    expect(
      accountAuthenticationError(
        { premium: true, email: 'legacy-invalid' },
        true,
      ),
    ).toBeNull();
  });

  test.each([false, true])(
    'retains the password limit on onlineMode=%s',
    (onlineMode) => {
      expect(
        accountAuthenticationError(
          { premium: true, password: 'x'.repeat(45) },
          onlineMode,
        ),
      ).toBeNull();
      expect(
        accountAuthenticationError(
          { premium: true, password: 'x'.repeat(46) },
          onlineMode,
        ),
      ).toMatch(/45/);
    },
  );
});
