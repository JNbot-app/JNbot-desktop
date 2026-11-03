export interface PluginSignatureV2 {
  algorithm: 'ed25519';
  publicKey: string;
  publisherName: string;
  signedAt: string;
  value: string;
}
