import {
  APP_VERSION_PATTERN,
  MAX_BANNER_URL_LENGTH,
  MAX_LISTING_BYTES,
  MAX_SHARE_ITEMS,
  MAX_SHARE_SERVERS,
  SERVER_ID_PATTERN,
  isShareKind,
  type ShareListing,
} from '../../../src/common/share';

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length <= max;

const isTextList = (value: unknown, count: number, max: number): value is string[] =>
  Array.isArray(value) && value.length <= count && value.every((entry) => isText(entry, max));

/** Light structural check of an uploaded listing; the app verifies the content itself. */
export function parseListing(text: string): ShareListing | null {
  if (new TextEncoder().encode(text).byteLength > MAX_LISTING_BYTES) return null;
  try {
    const listing = JSON.parse(text) as ShareListing;
    const validItems =
      Array.isArray(listing.items) &&
      listing.items.length <= MAX_SHARE_ITEMS &&
      listing.items.every(
        (item) =>
          isText(item?.name, 100) &&
          (item.type === undefined || isText(item.type, 50)) &&
          (item.description === undefined || isText(item.description, 300)),
      );
    const validDetails =
      Array.isArray(listing.details) &&
      listing.details.length <= 50 &&
      listing.details.every(
        (section) =>
          isText(section?.title, 200) &&
          Array.isArray(section.rows) &&
          section.rows.length <= 210 &&
          section.rows.every((row) => isText(row?.label, 100) && isText(row?.value, 500)),
      );
    const valid =
      isShareKind(listing.kind) &&
      isText(listing.title, 100) &&
      listing.title.trim().length > 0 &&
      isText(listing.description, 2000) &&
      validItems &&
      validDetails &&
      (listing.stripped === undefined || isTextList(listing.stripped, 20, 100)) &&
      isText(listing.minAppVersion, 20) &&
      APP_VERSION_PATTERN.test(listing.minAppVersion) &&
      isTextList(listing.servers, MAX_SHARE_SERVERS, 64) &&
      listing.servers.every((server) => SERVER_ID_PATTERN.test(server)) &&
      isText(listing.publisherName, 100) &&
      listing.publisherName.trim().length > 0 &&
      (listing.color === undefined || (isText(listing.color, 9) && /^#[0-9a-fA-F]{3,8}$/.test(listing.color))) &&
      (listing.bannerUrl === undefined ||
        (isText(listing.bannerUrl, MAX_BANNER_URL_LENGTH) && /^https?:\/\/\S+$/i.test(listing.bannerUrl))) &&
      (listing.serverId === undefined || (isText(listing.serverId, 64) && SERVER_ID_PATTERN.test(listing.serverId)));
    return valid ? listing : null;
  } catch {
    return null;
  }
}
