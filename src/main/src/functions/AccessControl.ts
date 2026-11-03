import type { Address, TransportFrame } from '../../../common/messaging';
import { decodeAddress, isBroadcastTarget } from '../../../common/messaging';
import {
  CHANGE_GLOBAL_SETTINGS,
  FULL_REMOTE_PERMISSIONS,
  USE_ACTIVE_BOTS,
  USE_SCRIPTS,
  hasRemotePermission,
  unrestrictedPermissions,
  type ClientPrincipal,
  type RemotePermissionFlag,
} from '../../../common/clientPermissions';
import type Settings_ from './Settings';
import type ScriptHandler_ from './ScriptHandler';
import {
  backendMessaging,
  type BackendMessagingSystem,
} from '../messaging';
import {
  remoteRestriction,
  type OperationRestriction,
} from './RemotePermissionPolicy';

export class PermissionDeniedError extends Error {
  code = 'PERMISSION_DENIED';

  constructor(message = 'You do not have permission to perform this operation.') {
    super(message);
    this.name = 'PermissionDeniedError';
  }
}

export class UnsupportedRemoteError extends Error {
  code = 'UNSUPPORTED_REMOTE';

  constructor(message = 'This operation requires the desktop app.') {
    super(message);
    this.name = 'UnsupportedRemoteError';
  }
}

/** One authorization boundary shared by every remote transport. */
export default class AccessControl {
  constructor(
    private readonly settings: Settings_,
    private readonly scriptHandler: ScriptHandler_,
    private readonly messaging: BackendMessagingSystem = backendMessaging,
  ) {
    this.messaging.setRemoteFrameAuthorizer((principal, frame) =>
      this.authorizeFrame(principal, frame),
    );
    this.messaging.setRemoteFrameRecipientAuthorizer((principal, frame) =>
      this.canDeliverFrame(principal, frame),
    );
    this.messaging.setProfileRecipientAuthorizer((principal, profileId) => {
      try {
        this.assertRuntimeProfileForPrincipal(
          this.effectivePrincipal(principal),
          profileId,
        );
        return true;
      } catch {
        return false;
      }
    });
  }

  principal(origin?: Address): ClientPrincipal {
    return origin === undefined
      ? {
          kind: 'trusted-local',
          subjectId: 'local',
          permissions: unrestrictedPermissions(),
        }
      : this.messaging.principalForAddress(origin) ?? {
          kind: 'trusted-local',
          subjectId: 'local',
          permissions: unrestrictedPermissions(),
        };
  }

  assertProfile(origin: Address | undefined, profileKey: string): void {
    this.assertProfileForPrincipal(
      this.effectivePrincipal(this.principal(origin)),
      profileKey,
    );
  }

  assertClientAction(origin: Address | undefined, action: string): void {
    this.assertOperation(
      this.effectivePrincipal(this.principal(origin)),
      remoteRestriction.clientAction(action),
    );
  }

  assertProfileAction(
    origin: Address | undefined,
    profileId: number,
    action: string,
  ): void {
    const principal = this.effectivePrincipal(this.principal(origin));
    this.assertRuntimeProfileForPrincipal(principal, profileId);
    this.assertOperation(principal, remoteRestriction.profileAction(action));
  }

  assertGlobalSetting(origin: Address | undefined): void {
    this.assertOperation(
      this.effectivePrincipal(this.principal(origin)),
      CHANGE_GLOBAL_SETTINGS,
    );
  }

  hasPermission(
    origin: Address | undefined,
    permission: RemotePermissionFlag,
  ): boolean {
    const principal = this.effectivePrincipal(this.principal(origin));
    return (
      this.isUnrestricted(principal) ||
      hasRemotePermission(principal.permissions.permissionMask, permission)
    );
  }

  allowedProfileKeys(origin?: Address): string[] {
    const principal = this.effectivePrincipal(this.principal(origin));
    const all = this.settings
      .getAvailableProfiles()
      .map((profile) => profile.server);
    if (this.isUnrestricted(principal) || principal.permissions.profiles === '*')
      return all;
    const allowed = new Set(principal.permissions.profiles);
    return all.filter((key) => allowed.has(key));
  }

  private authorizeFrame(
    principal: ClientPrincipal,
    frame: TransportFrame,
  ): void {
    principal = this.effectivePrincipal(principal);
    const { envelope } = frame;

    if (envelope.type === 'unsubscribe') return;
    if (envelope.type === 'subscribe') {
      this.authorizeSubscription(principal, frame);
      return;
    }

    if (typeof envelope.to !== 'number') {
      if (envelope.to.broadcast === 'profile-clients') {
        this.assertRuntimeProfileForPrincipal(principal, envelope.to.profileId);
        return;
      }
      throw new PermissionDeniedError('This broadcast is not permitted.');
    }

    const target = decodeAddress(envelope.to);
    if (target.kind === 'worker' && target.profileId > 0) {
      this.assertRuntimeProfileForPrincipal(principal, target.profileId);
      this.assertOperation(
        principal,
        target.leafId > 0 ? USE_ACTIVE_BOTS : USE_SCRIPTS,
      );
      return;
    }
    if (envelope.to !== 0) {
      throw new PermissionDeniedError(
        `This remote operation (${envelope.event}) is not permitted.`,
      );
    }

    this.authorizeBackendEvent(principal, envelope.event, envelope.data);
  }

  private authorizeBackendEvent(
    principal: ClientPrincipal,
    event: string,
    payload: unknown,
  ): void {
    if (event === 'profile:enable') {
      this.assertProfileForPrincipal(
        principal,
        this.stringField(payload, 'profileKey'),
      );
      return;
    }
    if (event === 'profile:snapshot') {
      this.assertRuntimeProfileForPrincipal(
        principal,
        this.integerField(payload, 'profileId'),
      );
      return;
    }
    if (event === 'client:profile-action') {
      const profileId = this.integerField(payload, 'profileId');
      const action = this.stringField(payload, 'event');
      this.assertRuntimeProfileForPrincipal(principal, profileId);
      this.assertOperation(principal, remoteRestriction.profileAction(action));
      return;
    }
    if (event === 'client:action') {
      this.assertOperation(
        principal,
        remoteRestriction.clientAction(this.stringField(payload, 'event')),
      );
      return;
    }
    if (event === 'client:invoke') {
      const data = this.field(payload, 'data');
      const profileKey =
        this.optionalStringField(data, 'profileKey') ??
        this.optionalStringField(data, 'server');
      if (profileKey) this.assertProfileForPrincipal(principal, profileKey);
      this.assertOperation(
        principal,
        remoteRestriction.invoke(this.stringField(payload, 'channel')),
      );
      return;
    }
    if (event === 'client:send') {
      this.assertOperation(
        principal,
        remoteRestriction.send(
          this.stringField(payload, 'channel'),
          this.field(payload, 'data'),
        ),
      );
    }
  }

  private canDeliverFrame(
    principal: ClientPrincipal,
    frame: TransportFrame,
  ): boolean {
    principal = this.effectivePrincipal(principal);
    try {
      const source = decodeAddress(frame.envelope.from);
      if (source.kind === 'worker' && source.profileId > 0) {
        this.assertRuntimeProfileForPrincipal(principal, source.profileId);
        this.assertOperation(
          principal,
          source.leafId > 0 ? USE_ACTIVE_BOTS : USE_SCRIPTS,
        );
      }
      if (frame.envelope.event === 'profile:event') {
        const publication = frame.envelope.data;
        if (publication && typeof publication === 'object') {
          const event = Reflect.get(publication, 'event');
          if (typeof event === 'string') {
            this.assertOperation(
              principal,
              remoteRestriction.profilePublication(event),
            );
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  private authorizeSubscription(
    principal: ClientPrincipal,
    frame: TransportFrame,
  ): void {
    const { envelope } = frame;
    const requested = this.field(envelope.data, 'target');

    if (isBroadcastTarget(requested)) {
      if (requested.broadcast === 'profile-clients') {
        this.assertRuntimeProfileForPrincipal(principal, requested.profileId);
        return;
      }
      if (requested.broadcast === 'clients') {
        this.assertOperation(
          principal,
          remoteRestriction.clientSubscription(envelope.event),
        );
        return;
      }
      throw new PermissionDeniedError('This subscription is not permitted.');
    }

    if (typeof envelope.to === 'number') {
      const publisher = decodeAddress(envelope.to);
      if (publisher.kind === 'worker' && publisher.profileId > 0) {
        this.assertRuntimeProfileForPrincipal(principal, publisher.profileId);
        this.assertOperation(
          principal,
          publisher.leafId > 0 ? USE_ACTIVE_BOTS : USE_SCRIPTS,
        );
        return;
      }
    }
    throw new PermissionDeniedError('This subscription is not permitted.');
  }

  private assertOperation(
    principal: ClientPrincipal,
    restriction: OperationRestriction | undefined,
  ): void {
    if (principal.kind === 'trusted-local') return;
    if (restriction === 'unsupported-remote') throw new UnsupportedRemoteError();
    if (!restriction || this.isUnrestricted(principal)) return;
    if (restriction === 'not-listed') throw new PermissionDeniedError();
    const required = Array.isArray(restriction)
      ? restriction
      : [restriction as RemotePermissionFlag];
    if (
      required.some(
        (permission) =>
          !hasRemotePermission(principal.permissions.permissionMask, permission),
      )
    ) {
      throw new PermissionDeniedError();
    }
  }

  private assertProfileForPrincipal(
    principal: ClientPrincipal,
    profileKey: string,
  ): void {
    if (this.isUnrestricted(principal) || principal.permissions.profiles === '*')
      return;
    if (principal.permissions.profiles.includes(profileKey)) return;
    throw new PermissionDeniedError(
      'You do not have permission to access this profile.',
    );
  }

  private assertRuntimeProfileForPrincipal(
    principal: ClientPrincipal,
    profileId: number,
  ): void {
    this.assertProfileForPrincipal(
      principal,
      this.scriptHandler.getRuntime(profileId).profileKey,
    );
  }

  private effectivePrincipal(principal: ClientPrincipal): ClientPrincipal {
    if (principal.kind !== 'remote') return principal;
    const device = this.settings.shared.devices.find(
      (item) => item.id === principal.subjectId,
    );
    return device ? { ...principal, permissions: device.permissions } : principal;
  }

  private isUnrestricted(principal: ClientPrincipal): boolean {
    return (
      principal.kind === 'trusted-local' ||
      principal.permissions.permissionMask === FULL_REMOTE_PERMISSIONS
    );
  }

  private field(value: unknown, key: string): unknown {
    return value && typeof value === 'object'
      ? Reflect.get(value, key)
      : undefined;
  }

  private stringField(value: unknown, key: string): string {
    const field = this.field(value, key);
    if (typeof field === 'string') return field;
    throw new PermissionDeniedError(`Invalid ${key}.`);
  }

  private integerField(value: unknown, key: string): number {
    const field = this.field(value, key);
    if (Number.isInteger(field)) return field as number;
    throw new PermissionDeniedError(`Invalid ${key}.`);
  }

  private optionalStringField(value: unknown, key: string): string | undefined {
    const field = this.field(value, key);
    return typeof field === 'string' ? field : undefined;
  }
}
