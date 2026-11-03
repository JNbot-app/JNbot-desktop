import EventEmitter from 'node:events';

import type {
  MinecraftInstanceInfo,
  MinecraftInstancesType,
  MinecraftLaunchStage,
  MinecraftInstanceStatus,
  MinecraftLaunchStatusPayload,
} from '../../types';

export const isMinecraftLaunchStatusPayload = (value: unknown): value is MinecraftLaunchStatusPayload => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  const stages: MinecraftLaunchStage[] = [
    'installing-modloader',
    'installing',
    'launching',
    'window-ready',
    'exit',
    'error',
  ];
  if (typeof v.bridgeInstanceId !== 'string') return false;
  if (typeof v.stage !== 'string') return false;
  if (!stages.includes(v.stage as MinecraftLaunchStage)) return false;
  if (typeof v.username !== 'string') return false;
  if (typeof v.version !== 'string') return false;
  return true;
};

const now = () => Date.now();

const statusFromStage = (stage: MinecraftLaunchStage): MinecraftInstanceStatus => {
  if (stage === 'exit') return 'exited';
  if (stage === 'error') return 'error';
  if (
    stage === 'launching' ||
    stage === 'installing' ||
    stage === 'installing-modloader'
  ) {
    return 'starting';
  }
  return 'running';
};

export default class MinecraftInstances extends EventEmitter {
  private readonly byId = new Map<string, MinecraftInstanceInfo>();

  hasRunning(): boolean {
    for (const inst of this.byId.values()) {
      if (inst.status === 'running' || inst.status === 'starting') return true;
    }
    return false;
  }

  create(params: {
    instanceId: string;
    username: string;
    requestedVersion: string;
  }): MinecraftInstanceInfo {
    const createdAt = now();
    const instance: MinecraftInstanceInfo = {
      instanceId: params.instanceId,
      username: params.username,
      requestedVersion: params.requestedVersion,
      status: 'starting',
      stage: 'installing',
      createdAt,
      updatedAt: createdAt,
    };

    this.byId.set(instance.instanceId, instance);
    this.send();
    return instance;
  }


  stop(instanceId: string): void {
    const existing = this.byId.get(instanceId);
    if (!existing) return;

    this.byId.set(instanceId, { ...existing, status: 'exited', updatedAt: now() });
    this.send();
  }


  failed(instanceId: string): void {
    const existing = this.byId.get(instanceId);
    if (!existing) return;

    this.byId.set(instanceId, { ...existing, status: 'error', updatedAt: now() });
    this.send();
  }

  updateFromLaunchStatus(payload: MinecraftLaunchStatusPayload): void {
    const instanceId = payload.bridgeInstanceId;
    if (!instanceId) return;

    const existing = this.byId.get(instanceId);
    const updatedAt = now();

    const next: MinecraftInstanceInfo = {
      instanceId,
      username: payload.username,
      requestedVersion: payload.version,
      status: statusFromStage(payload.stage),
      stage: payload.stage,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
      pid: payload.pid ?? existing?.pid,
      instancePath: payload.instancePath ?? existing?.instancePath,
      minecraftRoot: existing?.minecraftRoot,
      modLoader: payload.modLoader ?? existing?.modLoader,
      clientId: existing?.clientId,
    };

    this.byId.set(instanceId, next);
    this.send();
  }

  setMinecraftRoot(instanceId: string, minecraftRoot: string): void {
    const existing = this.byId.get(instanceId);
    if (!existing) return;
    if (existing.minecraftRoot === minecraftRoot) return;

    this.byId.set(instanceId, { ...existing, minecraftRoot, updatedAt: now() });
    this.send();
  }

  associateClient(instanceId: string, clientId: string): void {
    const existing = this.byId.get(instanceId);
    if (!existing) return;
    if (existing.clientId === clientId) return;

    this.byId.set(instanceId, { ...existing, clientId, updatedAt: now() });
    this.send();
  }

  list(): MinecraftInstancesType {
    return [...this.byId.values()]
      .map((v) => ({ ...v }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  send(): void {
    this.emit('changed', this.list());
  }
}
