import { FC, useEffect, useState } from 'react';
import { Button, Divider, Dropdown, Empty, Flex, Tooltip, Typography, theme } from 'antd';
import {
  LinkOutlined,
  DeleteOutlined,
  SettingOutlined,
  PlayCircleOutlined,
  StopOutlined,
  ShareAltOutlined,
  SyncOutlined,
  MoreOutlined,
  CodeOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
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
import RunningControls from '../../macros/RunningControls';
import { toChainOptions } from './chainOptionsScheme';
import LlmPrompt from '../../llm/LlmPrompt';
import type { LlmRun } from '../../../hooks/useLlmRun';
import type { ChainStep } from '../../../../common/chains';

const ScriptChain: FC<{
  selectedChainId: string;
  setSelectedChain: (c: string) => void;
  onSaveChain: (chain: Chain) => void;
  onEditSettings: () => void;
}> = ({ selectedChainId, setSelectedChain, onSaveChain, onEditSettings }) => {
  const { token } = theme.useToken();
  const [loading, setLoading] = useState(false);
  const { modal } = useAppApi();
  const navigate = useNavigate();
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

  // Opens the code editor on the chain's setup code.
  const editSetup = () => navigate(`/code/${encodeURIComponent(pluginId)}`);

  const gamemode = options?.gamemode && options.gamemode !== 'any' ? options.gamemode : undefined;
  const isRunnable = !!chain.chains.length && chain.chains.every((step) => step.scriptId);

  const generate = async (description: string, run: LlmRun['run']) => {
    const draft = await run<{ name?: string; steps?: ChainStep[] }>('LLM_GENERATE', { kind: 'chain', description });
    if (!draft) return;
    onSaveChain({ ...chain, chains: draft.steps ?? [] });
    if (draft.name && options) setChainOptions(chain.id, { ...options, name: draft.name });
  };

  return (
    <Card
      title={chainName}
      style={{ height: '100%' }}
      styles={{ body: { padding: 0 } }}
      icon={<LinkOutlined />}
      end={
        <Flex gap={8} style={{ transform: 'translateY(-8px)' }}>
          <ChainStatus chain={chain} />
          <Tooltip title="Chain settings">
            <Button onClick={onEditSettings} icon={<SettingOutlined />} type="text" aria-label="Chain settings" />
          </Tooltip>
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
                {
                  key: 'setup',
                  label: 'Edit setup code',
                  icon: <CodeOutlined />,
                  onClick: editSetup,
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
            <RunningControls pluginId={pluginId} name={chainName} stopIcon={<StopOutlined />} />
          ) : (
            <Button disabled={!isRunnable} onClick={runChain} loading={loading} type="primary" icon={<PlayCircleOutlined />}>
              Run
            </Button>
          )}
        </Flex>
      }
    >
      <Flex vertical gap={12} style={{ padding: '16px 16px 0' }}>
        {!chain.chains.length && (
          <LlmPrompt placeholder="Describe the steps, e.g. claim the daily kit, then sell everything" onSubmit={generate} />
        )}
        <Flex align="center" justify="space-between" gap={8}>
          <Flex align="center" gap={4}>
            <Typography.Text strong>Steps</Typography.Text>
            <Tooltip title="Each alt runs these steps from top to bottom, then the chain continues with the next alt.">
              <InfoCircleOutlined style={{ color: token.colorTextTertiary }} />
            </Tooltip>
          </Flex>
          <Flex align="center" gap={0}>
            {gamemode && <Typography.Text type="secondary">{gamemode}</Typography.Text>}
            {gamemode && chain.setup && <Divider orientation="vertical" />}
            {chain.setup && (
              <Button type="link" size="small" icon={<CodeOutlined />} onClick={editSetup}>
                Setup code
              </Button>
            )}
          </Flex>
        </Flex>
      </Flex>
      <ChainFlow chain={chain} onChange={onSaveChain} />
    </Card>
  );
};

export default ScriptChain;
