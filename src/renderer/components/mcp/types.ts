import type { ReactNode } from 'react';
import type { McpClientGrant } from '../../../common/mcp';

export type PairingResult = {
  client: McpClientGrant;
  token: string;
  endpoint?: string;
  stdio: Record<string, unknown>;
};

export type PermissionKey = 'observe' | 'control' | 'code' | 'plugins';

export type PermissionRow = {
  key: PermissionKey;
  title: string;
  description: string;
  icon?: ReactNode;
};

export const defaultPermissions = {
  enabled: true,
  observe: 'allow' as const,
  control: 'allow' as const,
  code: 'ask' as const,
  plugins: 'ask' as const,
};

export const formatTime = (timestamp?: number): string => {
  if (!timestamp) return 'Never used';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Active just now';
  if (minutes < 60) return `Active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Active yesterday';
  if (days < 7) return `Active ${days}d ago`;
  return `Active ${new Date(timestamp).toLocaleDateString()}`;
};
