export type RelayProps = {
  installationId: string;
  localClientId: string;
  scopes: string[];
};

export type DesktopAttachment = {
  role: 'desktop';
  installationId: string;
  connectedAt: number;
};

export type DesktopFrame =
  | {
      type: 'response';
      id: string;
      status: number;
      headers: Record<string, string>;
      body: string;
    }
  | {
      type: 'pairing_decision';
      pairingId: string;
      approved: boolean;
      localClientId?: string;
      scopes?: string[];
    }
  | {
      type: 'sync_pairings';
    };

export type RelayFrame =
  | {
      type: 'request';
      id: string;
      installationId: string;
      clientId: string;
      scopes: string[];
      nonce: string;
      timestamp: number;
      method: string;
      headers: Record<string, string>;
      body: string;
    }
  | {
      type: 'pairing_request';
      pairingId: string;
      code: string;
      clientName: string;
      requestedScopes: string[];
      expiresAt: number;
    };
