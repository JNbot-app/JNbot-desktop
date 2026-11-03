import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Flex, Result, theme } from 'antd';
import { useNavigate } from 'react-router-dom';
import { MinecraftLauncherTypes } from '../../common/CommonEnums';
import type {
  MinecraftBridgeClientSummary,
  MinecraftServerSummary,
  MinecraftWorldInfo,
} from '../../common/minecraftServers';
import type { VersionInfo } from '../../main/src/functions/minecraft/launcher/MinecraftLauncherTypes';
import ServerHeader from '../components/mcServer/ServerHeader';
import ServerWorkspace, {
  McServerView,
} from '../components/mcServer/ServerWorkspace';
import {
  CreateServerDialog,
  JoinServerDialog,
  ShareWorldDialog,
} from '../components/mcServer/ServerDialogs';
import type {
  CreateServerValues,
  JoinServerValues,
  ShareWorldValues,
} from '../components/mcServer/types';
import useAppApi from '../hooks/useAppApi';

type DialogType = 'create' | 'join' | 'share';

const McServer: React.FC = () => {
  const { token } = theme.useToken();
  const { message, modal } = useAppApi();
  const navigate = useNavigate();

  const [servers, setServers] = useState<MinecraftServerSummary[]>([]);
  const [versions, setVersions] = useState<string[]>([]);
  const [worlds, setWorlds] = useState<MinecraftWorldInfo[]>([]);
  const [bridgeClients, setBridgeClients] = useState<
    MinecraftBridgeClientSummary[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [dialog, setDialog] = useState<DialogType>();
  const [dialogDataLoading, setDialogDataLoading] = useState(false);
  const [dialogDataError, setDialogDataError] = useState<string>();
  const [view, setView] = useState<McServerView>('hosted');

  const notifyError = useCallback(
    (error: unknown) => message.error(errorText(error)),
    [message],
  );

  const loadServers = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    try {
      setServers(await window.ipcRenderer.get('MC_SERVERS_LIST'));
    } catch (error) {
      setLoadError(errorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (window.web) return undefined;
    loadServers().catch(notifyError);
    const disposeUpdate = window.ipcRenderer.on(
      'MC_SERVERS_UPDATE',
      (next: MinecraftServerSummary[]) => {
        setServers(next);
        setLoadError(undefined);
      },
    );
    return () => disposeUpdate?.();
  }, [loadServers, notifyError]);

  const openCreate = async () => {
    setDialog('create');
    setDialogDataLoading(true);
    setDialogDataError(undefined);
    try {
      const [allVersions, foundWorlds] = await Promise.all([
        window.ipcRenderer.get('GET_MINECRAFT_VERSIONS') as Promise<
          VersionInfo[]
        >,
        window.ipcRenderer.get('MC_SERVER_WORLDS') as Promise<
          MinecraftWorldInfo[]
        >,
      ]);
      setVersions(uniqueFabricVersions(allVersions));
      setWorlds(foundWorlds);
    } catch (error) {
      setDialogDataError(errorText(error));
      notifyError(error);
    } finally {
      setDialogDataLoading(false);
    }
  };

  const openShare = async () => {
    setDialog('share');
    setDialogDataLoading(true);
    setDialogDataError(undefined);
    try {
      const [clients, allVersions] = await Promise.all([
        window.ipcRenderer.get('MC_SERVER_BRIDGE_CLIENTS') as Promise<
          MinecraftBridgeClientSummary[]
        >,
        window.ipcRenderer.get('GET_MINECRAFT_VERSIONS') as Promise<
          VersionInfo[]
        >,
      ]);
      setBridgeClients(clients);
      setVersions(uniqueFabricVersions(allVersions));
    } catch (error) {
      setDialogDataError(errorText(error));
      notifyError(error);
    } finally {
      setDialogDataLoading(false);
    }
  };

  const addWorldFolder = async () => {
    const selected = await window.ipcRenderer.get('SELECT_DIRECTORY');
    if (selected.canceled || !selected.filePaths.length) return;
    try {
      const found = (await window.ipcRenderer.get(
        'MC_SERVER_WORLDS',
        selected.filePaths[0],
      )) as MinecraftWorldInfo[];
      setWorlds((current) => [
        ...current,
        ...found.filter(
          (world) => !current.some((item) => item.path === world.path),
        ),
      ]);
    } catch (error) {
      notifyError(error);
    }
  };

  const createServer = async (values: CreateServerValues) => {
    const world = worlds.find((item) => item.path === values.worldPath);
    setBusy('create');
    try {
      await window.ipcRenderer.get('MC_SERVER_CREATE', {
        name: values.name.trim(),
        version: values.version,
        memoryMB: values.memoryMB,
        onlineMode: values.onlineMode,
        eulaAccepted: values.eulaAccepted,
        world,
        allowUnknownWorldVersion: Boolean(values.allowUnknownWorldVersion),
      });
      setDialog(undefined);
      message.success('Minecraft server created');
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(undefined);
    }
  };

  const joinServer = async ({ invite }: JoinServerValues) => {
    setBusy('join');
    try {
      await window.ipcRenderer.get('MC_SERVER_IMPORT_INVITE', invite.trim());
      setDialog(undefined);
      message.success('Private server added');
      setView('joined');
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(undefined);
    }
  };

  const shareWorld = async (values: ShareWorldValues) => {
    setBusy('share');
    try {
      if (values.mode === 'client') {
        const client = bridgeClients.find(
          (entry) => entry.clientId === values.clientId,
        );
        await window.ipcRenderer.get('MC_SERVER_SHARE_CLIENT', {
          name: values.name.trim(),
          clientId: values.clientId,
          version: client?.mcVersion || values.version,
          cheatsAllowed: values.cheatsAllowed,
        });
      } else {
        await window.ipcRenderer.get('MC_SERVER_SHARE_LAN', {
          name: values.name.trim(),
          version: values.version,
          port: values.port,
        });
      }
      setDialog(undefined);
      message.success('World is now shared privately');
      setView('hosted');
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(undefined);
    }
  };

  const run = async (id: string, task: () => Promise<unknown>) => {
    setBusy(id);
    try {
      await task();
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(undefined);
    }
  };

  const start = async (server: MinecraftServerSummary) => {
    const active = servers.find(
      (entry) =>
        entry.role === 'host' &&
        entry.id !== server.id &&
        entry.state === 'online',
    );
    if (active) {
      modal.confirm({
        title: `Switch from ${active.name} to ${server.name}?`,
        content: 'Only one local Minecraft world can be hosted at a time.',
        okText: 'Switch profile',
        onOk: () =>
          run(server.id, async () => {
            await window.ipcRenderer.get('MC_SERVER_STOP', { id: active.id });
            await window.ipcRenderer.get('MC_SERVER_START', { id: server.id });
          }),
      });
      return;
    }
    await run(server.id, () =>
      window.ipcRenderer.get('MC_SERVER_START', { id: server.id }),
    );
  };

  const stop = (server: MinecraftServerSummary) =>
    run(server.id, () =>
      window.ipcRenderer.get('MC_SERVER_STOP', { id: server.id }),
    );

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      message.success(`${label} copied`);
    } catch (error) {
      notifyError(error);
    }
  };

  const copyInvite = async (server: MinecraftServerSummary, rotate = false) => {
    try {
      const invite = rotate
        ? await window.ipcRenderer.get('MC_SERVER_ROTATE_INVITE', {
            id: server.id,
          })
        : await window.ipcRenderer.get('MC_SERVER_INVITE', { id: server.id });
      await copy(invite, rotate ? 'New invite' : 'Invite');
    } catch (error) {
      notifyError(error);
    }
  };

  const remove = (server: MinecraftServerSummary) => {
    const removesFiles =
      server.role === 'host' && server.source === 'dedicated';
    modal.confirm({
      title: `Remove ${server.name}?`,
      content: removesFiles
        ? 'The managed copy will move to Trash. An originally imported world is not affected.'
        : 'This removes the server from JNbot.',
      okButtonProps: { danger: true },
      okText: removesFiles ? 'Move to Trash' : 'Remove',
      onOk: async () => {
        try {
          await window.ipcRenderer.get('MC_SERVER_REMOVE', {
            id: server.id,
            deleteFiles: removesFiles,
          });
          message.success(`${server.name} removed`);
        } catch (error) {
          notifyError(error);
          throw error;
        }
      },
    });
  };

  const hosted = useMemo(
    () => servers.filter((server) => server.role === 'host'),
    [servers],
  );
  const joined = useMemo(
    () => servers.filter((server) => server.role === 'joined'),
    [servers],
  );

  if (window.web) {
    return (
      <Result
        status="info"
        title="Minecraft hosting is available in the JNbot desktop app"
        subTitle="The desktop app is required to run private connections and Minecraft processes."
      />
    );
  }

  return (
    <Flex vertical gap={token.marginLG}>
      <ServerHeader
        totalServers={servers.length}
        onlineServers={servers.filter((s) => s.state === 'online').length}
        onCreate={() => void openCreate()}
        onJoin={() => setDialog('join')}
        onShare={() => void openShare()}
      />

      <ServerWorkspace
        hosted={hosted}
        joined={joined}
        loading={loading}
        error={loadError}
        busy={busy}
        view={view}
        onViewChange={setView}
        onRetry={loadServers}
        onCreate={() => void openCreate()}
        onJoin={() => setDialog('join')}
        onStart={start}
        onStop={stop}
        onCopy={copy}
        onInvite={copyInvite}
        onOpen={(server) => navigate(`/mc-server/${server.id}`)}
        onRemove={remove}
      />

      <CreateServerDialog
        open={dialog === 'create'}
        loading={dialogDataLoading || busy === 'create'}
        error={dialog === 'create' ? dialogDataError : undefined}
        data={{ versions, worlds }}
        onCancel={() => setDialog(undefined)}
        onRetry={openCreate}
        onAddWorldFolder={addWorldFolder}
        onSubmit={createServer}
      />

      <JoinServerDialog
        open={dialog === 'join'}
        loading={busy === 'join'}
        onCancel={() => setDialog(undefined)}
        onSubmit={joinServer}
      />

      <ShareWorldDialog
        open={dialog === 'share'}
        loading={dialogDataLoading || busy === 'share'}
        error={dialog === 'share' ? dialogDataError : undefined}
        data={{ versions, bridgeClients }}
        onCancel={() => setDialog(undefined)}
        onRetry={openShare}
        onSubmit={shareWorld}
      />
    </Flex>
  );
};

const uniqueFabricVersions = (versions: VersionInfo[]) => [
  ...new Set(
    versions
      .filter(
        (version) =>
          version.launcherType === MinecraftLauncherTypes.FABRIC &&
          version.type === 'release',
      )
      .map((version) => version.id),
  ),
];

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export default McServer;
