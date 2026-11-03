import { ANNOUNCEMENT_LIMITS, parseAnnouncementDocument } from './announcement';

const validDocument = {
  current: {
    id: 'android-testers-2026-08',
    title: 'Help test JNbot for Android',
    body: 'We are looking for **20 Android testers**.',
    actions: [
      { label: 'Become a tester', url: 'https://example.com/test' },
      { label: 'Join Discord', url: 'https://discord.gg/JNbGgypERe' },
    ],
    startsAt: '2026-08-27T12:00:00Z',
    expiresAt: '2026-09-15T12:00:00Z',
  },
};

describe('parseAnnouncementDocument', () => {
  it('accepts an explicitly empty document', () => {
    expect(parseAnnouncementDocument({ current: null })).toBeNull();
  });

  it('accepts a body-only announcement', () => {
    expect(
      parseAnnouncementDocument({
        current: { id: 'body-only', body: 'A short message.' },
      }),
    ).toEqual({
      id: 'body-only',
      body: 'A short message.',
      actions: [],
    });
  });

  it('accepts formatting, two actions, and an active date window', () => {
    expect(
      parseAnnouncementDocument(
        validDocument,
        new Date('2026-09-01T12:00:00Z'),
      ),
    ).toEqual(validDocument.current);
  });

  it.each([
    [{ current: { body: 'Missing id' } }],
    [{ current: { id: 'missing-body' } }],
    [{ current: { id: '', body: 'Empty id' } }],
    [{ current: { id: 'empty-body', body: '  ' } }],
    [{ current: { id: 'bad-actions', body: 'Message', actions: {} } }],
    [
      {
        current: {
          id: 'too-many-actions',
          body: 'Message',
          actions: [
            { label: 'One', url: 'https://example.com/1' },
            { label: 'Two', url: 'https://example.com/2' },
            { label: 'Three', url: 'https://example.com/3' },
          ],
        },
      },
    ],
    [
      {
        current: {
          id: 'unsafe-url',
          body: 'Message',
          actions: [{ label: 'Run', url: 'javascript:alert(1)' }],
        },
      },
    ],
    [
      {
        current: {
          id: 'bad-date',
          body: 'Message',
          startsAt: 'tomorrow',
        },
      },
    ],
    [
      {
        current: {
          id: 'backwards-window',
          body: 'Message',
          startsAt: '2026-09-16T00:00:00Z',
          expiresAt: '2026-09-15T00:00:00Z',
        },
      },
    ],
  ])('rejects an invalid document', (document) => {
    expect(parseAnnouncementDocument(document)).toBeNull();
  });

  it('rejects oversized fields', () => {
    expect(
      parseAnnouncementDocument({
        current: {
          id: 'x'.repeat(ANNOUNCEMENT_LIMITS.id + 1),
          title: 'x'.repeat(ANNOUNCEMENT_LIMITS.title + 1),
          body: 'x'.repeat(ANNOUNCEMENT_LIMITS.body + 1),
        },
      }),
    ).toBeNull();
  });

  it('hides announcements outside their active window', () => {
    expect(
      parseAnnouncementDocument(
        validDocument,
        new Date('2026-08-27T11:59:59Z'),
      ),
    ).toBeNull();
    expect(
      parseAnnouncementDocument(
        validDocument,
        new Date('2026-09-15T12:00:00Z'),
      ),
    ).toBeNull();
  });

  it('accepts only absolute HTTP and HTTPS URLs', () => {
    const withUrl = (url: string) => ({
      current: {
        id: `url-${url}`,
        body: 'Message',
        actions: [{ label: 'Open', url }],
      },
    });

    expect(
      parseAnnouncementDocument(withUrl('http://example.com')),
    ).not.toBeNull();
    expect(
      parseAnnouncementDocument(withUrl('https://example.com')),
    ).not.toBeNull();
    expect(parseAnnouncementDocument(withUrl('/relative'))).toBeNull();
    expect(
      parseAnnouncementDocument(withUrl('mailto:test@example.com')),
    ).toBeNull();
  });
});
