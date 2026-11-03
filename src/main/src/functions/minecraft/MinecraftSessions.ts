import EventEmitter from 'node:events';

import type { MinecraftGameSessionInfo, MinecraftSessionsType } from '../../types';

const now = () => Date.now();

export type SessionJoinedPayload = {
  clientId: string;
  username?: string;
  uuid?: string;
  instanceId?: string;
  serverAddress: string;
  serverKind: 'singleplayer' | 'multiplayer' | 'unknown';
};

export default class MinecraftSessions extends EventEmitter {
  private readonly byClientId = new Map<string, MinecraftGameSessionInfo>();

  upsertJoined(payload: SessionJoinedPayload): void {
    const t = now();

    const next: MinecraftGameSessionInfo = {
      clientId: payload.clientId,
      username: payload.username,
      uuid: payload.uuid,
      instanceId: payload.instanceId,
      serverAddress: payload.serverAddress,
      serverKind: payload.serverKind,
      joinedAt: this.byClientId.get(payload.clientId)?.joinedAt ?? t,
      lastSeenAt: t,
    };

    this.byClientId.set(payload.clientId, next);
    this.send();
  }

  markSeen(clientId: string): void {
    const existing = this.byClientId.get(clientId);
    if (!existing) return;
    this.byClientId.set(clientId, { ...existing, lastSeenAt: now() });
    this.send();
  }

  remove(clientId: string): void {
    if (!this.byClientId.has(clientId)) return;
    this.byClientId.delete(clientId);
    this.send();
  }

  list(): MinecraftSessionsType {
    return [...this.byClientId.values()]
      .map((v) => ({ ...v }))
      .sort((a, b) => b.joinedAt - a.joinedAt);
  }

  send(): void {
    this.emit('changed', this.list());
  }
}
