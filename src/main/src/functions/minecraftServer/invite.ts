import crypto from 'node:crypto';
import {
  MINECRAFT_SERVER_INVITE_PREFIX,
  type MinecraftServerInvite,
} from '../../../../common/minecraftServers';

const SAFE_TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

export const randomSecret = () => crypto.randomBytes(32).toString('base64url');

export const roomIdFromHostKey = (hostKey: string) =>
  crypto.createHash('sha256').update(hostKey, 'utf8').digest('base64url');

export function encodeMinecraftInvite(invite: MinecraftServerInvite): string {
  validateInvite(invite);
  return `${MINECRAFT_SERVER_INVITE_PREFIX}${Buffer.from(
    JSON.stringify(invite),
    'utf8',
  ).toString('base64url')}`;
}

export function decodeMinecraftInvite(raw: string): MinecraftServerInvite {
  const input = raw?.trim();
  if (!input?.startsWith(MINECRAFT_SERVER_INVITE_PREFIX) || input.length > 2048)
    throw new Error('Invalid JNbot Minecraft invite');
  try {
    const parsed = JSON.parse(
      Buffer.from(input.slice(MINECRAFT_SERVER_INVITE_PREFIX.length), 'base64url').toString(
        'utf8',
      ),
    ) as MinecraftServerInvite;
    validateInvite(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid ')) throw error;
    throw new Error('Invalid JNbot Minecraft invite');
  }
}

export function validateInvite(invite: MinecraftServerInvite): void {
  if (!invite || invite.v !== 1) throw new Error('Invalid invite version');
  if (!SAFE_TOKEN.test(invite.r) || !SAFE_TOKEN.test(invite.k))
    throw new Error('Invalid invite credentials');
  if (typeof invite.n !== 'string' || !invite.n.trim() || invite.n.length > 80)
    throw new Error('Invalid invite name');
  if (typeof invite.m !== 'string' || !invite.m.trim() || invite.m.length > 64)
    throw new Error('Invalid Minecraft version');
}

export function secretsEqual(expected: string, received: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

