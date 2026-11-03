import { buildAccessUrl, buildMobileAccessUrl } from './Host';

describe('buildAccessUrl', () => {
  test('creates a complete remote-browser URL', () => {
    const result = buildAccessUrl(
      { url: 'https://jnbot-app.netlify.app/', room: 'room id' },
      { id: 'phone/id', token: 'secret token', name: 'My phone' },
    );
    const url = new URL(result);

    expect(url.origin).toBe('https://jnbot-app.netlify.app');
    expect(url.searchParams.get('room')).toBe('room id');
    expect(url.searchParams.get('token')).toBe('secret token');
    expect(url.searchParams.get('id')).toBe('phone/id');
    expect(url.searchParams.get('p2p')).toBe('true');
  });

  test('does not expose an incomplete link', () => {
    expect(
      buildAccessUrl(
        { url: 'https://jnbot-app.netlify.app/' },
        { id: 'phone', token: 'secret', name: 'My phone' },
      ),
    ).toBe('');
  });
});

test('creates a JNbot Mobile deep link', () => {
  const result = buildMobileAccessUrl(
    { room: 'room id' },
    { id: 'phone/id', token: 'secret token', name: 'My phone' },
  );
  const url = new URL(result);
  expect(url.protocol).toBe('jnbot:');
  expect(url.hostname).toBe('connect');
  expect(url.searchParams.get('room')).toBe('room id');
  expect(url.searchParams.get('id')).toBe('phone/id');
});
