import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { app } from 'electron';

type RelayIdentity = {
  publicKey: string;
  privateKey: string;
};

type Configuration = {
  version: 4;
  installationId: string;
  relayIdentity?: RelayIdentity;
};

function isRelayIdentity(value: unknown): value is RelayIdentity {
  if (!value || typeof value !== 'object') return false;
  const identity = value as Record<string, unknown>;
  return (
    typeof identity.publicKey === 'string' &&
    typeof identity.privateKey === 'string'
  );
}

export class McpStorage {
  readonly directory: string;

  private readonly configurationPath: string;

  private configuration: Configuration;

  constructor(directory = path.join(app.getPath('userData'), 'ai-control')) {
    this.directory = directory;
    this.configurationPath = path.join(directory, 'config.json');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(directory, 0o700);
    } catch {
      // Windows relies on the user's AppData ACLs.
    }
    this.configuration = this.readConfiguration();
  }

  get installationId(): string {
    return this.configuration.installationId;
  }

  getOrCreateRelayIdentity(): RelayIdentity {
    if (this.configuration.relayIdentity) {
      return this.configuration.relayIdentity;
    }
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const identity = {
      publicKey: publicKey
        .export({ type: 'spki', format: 'der' })
        .toString('base64url'),
      privateKey: privateKey
        .export({ type: 'pkcs8', format: 'pem' })
        .toString(),
    };
    this.configuration = { ...this.configuration, relayIdentity: identity };
    this.writeConfiguration();
    return identity;
  }

  private readConfiguration(): Configuration {
    try {
      const value = JSON.parse(
        fs.readFileSync(this.configurationPath, 'utf8'),
      ) as Record<string, unknown>;
      if (
        value.version === 4 &&
        typeof value.installationId === 'string' &&
        /^[a-f0-9]{32}$/i.test(value.installationId) &&
        (value.relayIdentity === undefined ||
          isRelayIdentity(value.relayIdentity))
      ) {
        return {
          version: 4,
          installationId: value.installationId,
          ...(value.relayIdentity
            ? { relayIdentity: value.relayIdentity }
            : {}),
        };
      }
    } catch {
      // Create a clean configuration below.
    }
    const configuration: Configuration = {
      version: 4,
      installationId: randomBytes(16).toString('hex'),
    };
    this.configuration = configuration;
    this.writeConfiguration();
    return configuration;
  }

  private writeConfiguration(): void {
    const temporary = `${this.configurationPath}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(this.configuration), {
      mode: 0o600,
    });
    fs.renameSync(temporary, this.configurationPath);
    try {
      fs.chmodSync(this.configurationPath, 0o600);
    } catch {
      // Windows relies on the user's AppData ACLs.
    }
  }

  close(): void {
    // No-op: configuration writes are synchronous and don't maintain persistent file handles.
  }
}

export default McpStorage;
