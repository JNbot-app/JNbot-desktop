import { FC, useEffect, useState } from 'react';
import { Button, Dropdown, Empty, Flex, Tag, Typography } from 'antd';
import {
  LinkOutlined,
  DeleteOutlined,
  SettingOutlined,
  PlayCircleOutlined,
  StopOutlined,
  ShareAltOutlined,
  SyncOutlined,
  MoreOutlined,
} from '@ant-design/icons';
import {
  useSettingsStore,
  deleteChain,
  setChainOptions,
  selectScripts,
  selectActiveServerId,
} from '../../../redux/settings';
import type { Chain } from '../../../../main/src/types';
import { chainPluginId } from '../../../../common/chains';
import { openShareModal } from '../../share/useShareTarget';
import { useShareUpdateAction } from '../../share/useShareUpdateAction';
import useAppApi from '../../../hooks/useAppApi';

import Card from '../../Card';
import ChainFlow from './ChainFlow';
import ChainStatus from './ChainStatus';
import { toChainOptions } from './chainOptionsScheme';

const ScriptChain: FC<{
  selectedChainId: string;
  setSelectedChain: (c: string) => void;
  onSaveChain: (chain: Chain) => void;
  onEditSettings: () => void;
}> = ({ selectedChainId, setSelectedChain, onSaveChain, onEditSettings }) => {
  const [loading, setLoading] = useState(false);
  const { modal } = useAppApi();
  const scripts = useSettingsStore(selectScripts);
  const profileKey = useSettingsStore(selectActiveServerId);
  const chain = useSettingsStore((state) => state.settings.scripts?.chains?.[selectedChainId]);
  // Options live flat in settings.scripts[id] — the slot <ScriptSettings> uses.
  const options = useSettingsStore((state) => state.settings.scripts?.[selectedChainId]);
  const chainName = options?.name ?? chain?.name ?? 'Chain';
  const shareUpdate = useShareUpdateAction('chain', selectedChainId);
  const pluginId = chainPluginId(selectedChainId);
  const running = scripts.isScriptActiveById(pluginId);

  // Seed the flat options slot for chains created before options moved out of
  // the chain object (or that have never been opened).
  useEffect(() => {
    if (chain && !options) setChainOptions(chain.id, toChainOptions(chain));
  }, [chain, options]);

  if (!chain) {
    return (
      <Card title="Chain steps" icon={<LinkOutlined />} style={{ height: '100%' }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select or create a chain" />
      </Card>
    );
  }

  // Chains run like plugins, so cooldowns and schedules start them the same way.
  const runChain = async () => {
    setLoading(true);
    await scripts.startScript({ script: 'macro', arguments: { macroInfo: { pluginId } } });
    setLoading(false);
  };

  const confirmDelete = () =>
    modal.confirm({
      title: 'Delete chain',
      content: `Remove "${chainName}"? This cannot be undone.`,
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => {
        deleteChain(chain.id);
        setSelectedChain('');
      },
    });

  const isRunnable = !!chain.chains.length && chain.chains.every((step) => step.scriptId);

  return (
    <Card
      title={chainName}
      style={{ height: '100%' }}
      styles={{ body: { padding: 0 } }}
      icon={<LinkOutlined />}
      end={
        <Flex gap={8} style={{ transform: 'translateY(-8px)' }}>
          <Button onClick={onEditSettings} icon={<SettingOutlined />} type="text">
            Settings
          </Button>
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'share',
                  label: 'Share',
                  icon: <ShareAltOutlined />,
                  onClick: () => openShareModal({ kind: 'chain', ref: chain.id, profileKey, title: chainName }),
                },
                ...(shareUpdate
                  ? [{ key: 'share-update', label: shareUpdate.label, icon: <SyncOutlined />, onClick: shareUpdate.run }]
                  : []),
                { type: 'divider' },
                { key: 'delete', label: 'Delete chain', icon: <DeleteOutlined />, danger: true, onClick: confirmDelete },
              ],
            }}
          >
            <Button type="text" icon={<MoreOutlined />} aria-label="More chain actions" />
          </Dropdown>
          {running ? (
            <Button onClick={() => scripts.stopByScriptId(pluginId)} danger icon={<StopOutlined />}>
              Stop
            </Button>
          ) : (
            <Button disabled={!isRunnable} onClick={runChain} loading={loading} type="primary" icon={<PlayCircleOutlined />}>
              Run
            </Button>
          )}
        </Flex>
      }
    >
      <Flex vertical gap={8} style={{ padding: '16px 16px 0' }}>
        {options?.description && <Typography.Text type="secondary">{options.description}</Typography.Text>}
        <Flex gap={8} align="center" wrap>
          {options?.gamemode && options.gamemode !== 'any' && (
            <Tag variant="filled" style={{ marginInlineEnd: 0 }}>
              Gamemode: {options.gamemode}
            </Tag>
          )}
          <ChainStatus chain={chain} />
        </Flex>
      </Flex>
      <ChainFlow chain={chain} onChange={onSaveChain} />
    </Card>
  );
};

export default ScriptChain;
