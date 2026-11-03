import type { CustomProfile } from '../../../common/profiles';

export const BRAND_COLORS = [
  '#FED53E',
  '#FCEB38',
  '#7C5CFF',
  '#52C41A',
  '#1677FF',
  '#FF4D4F',
  '#FA8C16',
  '#EB2F96',
] as const;

export type SectionKey =
  | 'server'
  | 'gamemodes'
  | 'ranks'
  | 'appSettings'
  | 'scripts'
  | 'profileUi'
  | 'botExtension';

/** Whether a section holds anything beyond the defaults (drives the sidebar check). */
export function isSectionConfigured(
  profile: CustomProfile,
  key: SectionKey,
): boolean {
  switch (key) {
    case 'server':
      return !!profile.data.name && !!profile.data.defaultIp;
    case 'gamemodes':
      return (profile.data.gamemodes ?? []).length > 0;
    case 'ranks':
      return Object.values(profile.gamemodes ?? {}).some(
        (g) =>
          Object.keys(g?.ranks ?? {}).length > 0 ||
          Object.keys(g?.gkits ?? {}).length > 0,
      );
    case 'scripts':
      return (
        (profile.scripts ?? []).length > 0 ||
        (profile.disallowedPlugins ?? []).length > 0
      );
    case 'profileUi':
      return !!profile.profileUiAction;
    case 'botExtension':
      return !!profile.botExtensionAction;
    case 'appSettings':
      return Object.keys(profile.data.appSettingsDefaults ?? {}).length > 0;
  }
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

/** Split what people paste ("https://play.x.net:25566/") into host and port. */
export function parseAddress(raw: string): { host: string; port: number } {
  const clean = raw.trim().replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').replace(/:$/, '');
  const match = clean.match(/^(.+?):(\d{1,5})$/);
  const port = match ? Number(match[2]) : 25565;
  return {
    host: (match ? match[1] : clean).toLowerCase(),
    port: port >= 1 && port <= 65535 ? port : 25565,
  };
}

export const formatAddress = (host: string, port = 25565) =>
  port === 25565 || !host ? host : `${host}:${port}`;

/** "play.jartexnetwork.com" → "Jartexnetwork". */
export function guessServerName(host: string): string {
  const labels = host.split('.').filter(Boolean);
  if (labels.length > 2 && /^(play|mc|join|hub|www|server|srv)$/.test(labels[0]))
    labels.shift();
  const base = labels[0] ?? '';
  if (/^\d+$/.test(base)) return '';
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** The most saturated colour of an image, as hex — used to tint a profile after its icon. */
export function iconColor(src: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onerror = () => resolve(undefined);
    img.onload = () => {
      const size = 16;
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return resolve(undefined);
      ctx.canvas.width = ctx.canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);
      let px: Uint8ClampedArray;
      try {
        px = ctx.getImageData(0, 0, size, size).data;
      } catch {
        return resolve(undefined); // cross-origin image
      }
      let r = 0, g = 0, b = 0, total = 0;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 200) continue;
        const max = Math.max(px[i], px[i + 1], px[i + 2]);
        const min = Math.min(px[i], px[i + 1], px[i + 2]);
        const weight = ((max - min) / 255) ** 2;
        r += px[i] * weight;
        g += px[i + 1] * weight;
        b += px[i + 2] * weight;
        total += weight;
      }
      if (total < 1) return resolve(undefined);
      const hex = (v: number) => Math.round(v / total).toString(16).padStart(2, '0');
      resolve(`#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase());
    };
    img.src = src;
  });
}
