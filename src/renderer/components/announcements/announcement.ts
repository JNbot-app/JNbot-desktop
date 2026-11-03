export const ANNOUNCEMENT_URL =
  'https://raw.githubusercontent.com/usserwout/JNbot-updater/refs/heads/main/announcement.json';

export const ANNOUNCEMENT_LIMITS = {
  id: 100,
  title: 120,
  body: 4_000,
  actionLabel: 40,
  url: 2_048,
  actions: 2,
} as const;

export type AnnouncementAction = {
  label: string;
  url: string;
};

export type Announcement = {
  id: string;
  body: string;
  actions: AnnouncementAction[];
  title?: string;
  startsAt?: string;
  expiresAt?: string;
};

const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const HTML_TAG_PATTERN = /<\/?[A-Za-z][^>]*>/;
const MARKDOWN_IMAGE_PATTERN = /!\[[^\]]*\]\([^)]*\)/;
const MARKDOWN_LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSizedText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= maxLength
  );
}

export function isSafeExternalUrl(value: string): boolean {
  if (value.length > ANNOUNCEMENT_LIMITS.url) return false;

  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function isValidUtcTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    ISO_UTC_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function hasSafeMarkdown(body: string): boolean {
  if (HTML_TAG_PATTERN.test(body) || MARKDOWN_IMAGE_PATTERN.test(body)) {
    return false;
  }

  return Array.from(body.matchAll(MARKDOWN_LINK_PATTERN)).every((match) =>
    isSafeExternalUrl(match[1]),
  );
}

function parseActions(value: unknown): AnnouncementAction[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > ANNOUNCEMENT_LIMITS.actions) {
    return null;
  }

  const actions = value.map((action): AnnouncementAction | null => {
    if (
      !isRecord(action) ||
      !isSizedText(action.label, ANNOUNCEMENT_LIMITS.actionLabel) ||
      typeof action.url !== 'string' ||
      !isSafeExternalUrl(action.url)
    ) {
      return null;
    }

    return { label: action.label.trim(), url: action.url };
  });
  if (actions.some((action) => action === null)) {
    return null;
  }

  return actions.filter(
    (action): action is AnnouncementAction => action !== null,
  );
}

export function parseAnnouncementDocument(
  value: unknown,
  now = new Date(),
): Announcement | null {
  if (!isRecord(value) || !('current' in value)) return null;
  if (value.current === null) return null;
  if (!isRecord(value.current)) return null;

  const { current } = value;
  if (
    !isSizedText(current.id, ANNOUNCEMENT_LIMITS.id) ||
    !isSizedText(current.body, ANNOUNCEMENT_LIMITS.body) ||
    !hasSafeMarkdown(current.body)
  ) {
    return null;
  }

  if (
    current.title !== undefined &&
    !isSizedText(current.title, ANNOUNCEMENT_LIMITS.title)
  ) {
    return null;
  }

  if (
    current.startsAt !== undefined &&
    !isValidUtcTimestamp(current.startsAt)
  ) {
    return null;
  }
  if (
    current.expiresAt !== undefined &&
    !isValidUtcTimestamp(current.expiresAt)
  ) {
    return null;
  }

  const actions = parseActions(current.actions);
  if (!actions) return null;

  const { startsAt, expiresAt } = current;
  if (
    startsAt !== undefined &&
    expiresAt !== undefined &&
    Date.parse(startsAt) >= Date.parse(expiresAt)
  ) {
    return null;
  }

  const nowMs = now.getTime();
  if (startsAt !== undefined && nowMs < Date.parse(startsAt)) return null;
  if (expiresAt !== undefined && nowMs >= Date.parse(expiresAt)) return null;

  return {
    id: current.id.trim(),
    body: current.body.trim(),
    actions,
    ...(current.title === undefined ? {} : { title: current.title.trim() }),
    ...(startsAt === undefined ? {} : { startsAt }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
}
