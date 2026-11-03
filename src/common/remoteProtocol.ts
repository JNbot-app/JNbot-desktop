/** Version of the authenticated peer Messenger contract shared by web and mobile clients. */
export const REMOTE_PROTOCOL_VERSION = 1 as const;

export type RemoteClientHello = {
  kind: 'web' | 'mobile';
  appVersion: string;
  remoteProtocolVersion: typeof REMOTE_PROTOCOL_VERSION;
};

export type RemoteCapabilities = {
  protocolVersion: typeof REMOTE_PROTOCOL_VERSION;
  /** Additive feature flags. Clients must gracefully hide unavailable controls. */
  capabilities: readonly string[];
};
