import {
  ArrowLeftOutlined,
  CodeOutlined,
  ExportOutlined,
  MoreOutlined,
  PlayCircleOutlined,
  ReadOutlined,
  RobotOutlined,
  SettingOutlined,
  ShareAltOutlined,
  SlidersOutlined,
} from '@ant-design/icons';
import {
  Button,
  Divider,
  Dropdown,
  Flex,
  Space,
  theme,
  Tooltip,
  Typography,
  type MenuProps,
} from 'antd';
import {
  useEffect,
  useState,
  type FC,
  type MutableRefObject,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { MacroInfoValidator } from '../../validators/MacroValidator';
import { savePlugin, setChain, useSettingsStore } from '../../redux/settings';
import PlayButton from '../PlayButton';
import PluginSettingsModal from './PluginSettingsModal';
import ChainConfigModal from './ChainConfigModal';
import AIHelpModal from './AIHelpModal';
import useLlm from '../../hooks/useLlm';
import { LLM_CODE_TAB } from './LlmCodePanel';
import useBotContextMenu, { BOT_CONTEXT_KEY } from './BotContextMenu';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import type { EditorInstance } from './CodeEditor';
import type { MacroInfo } from '../../../main/src/types';
import type { ScriptSettingsSection } from '../general/scriptSettings/ScriptSettingsProps.d';
import { chainIdFromPluginId } from '../../../common/chains';
import { VscLayoutSidebarRightOff } from 'react-icons/vsc';

const Nav: FC<{
  pluginInfo: MacroInfo;
  code: any;
  editorRef: MutableRefObject<EditorInstance | null>;
  setMacroInfo: (info: any) => void;
  onSelectActiveTab: (tab: string | null) => void;
  onRunPreview: () => void;
}> = ({
  pluginInfo,
  code,
  editorRef,
  onSelectActiveTab,
  onRunPreview,
  setMacroInfo,
}) => {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { setPanel } = usePanelContext();
  const [pluginSettingsModal, setPluginSettingsModal] = useState(false);
  const [aiHelpModal, setAiHelpModal] = useState(false);
  const llm = useLlm();

  const platform = (window as any).platform as NodeJS.Platform | undefined;
  const isMac = platform === 'darwin' && !window.web;
  const isWin = platform === 'win32' && !window.web;
  const [canOpenExternal, setCanOpenExternal] = useState(false);

  useEffect(() => {
    if (window.web) return;
    void window.ipcRenderer.invoke<{ mode: string }>('storage:status')
      .then((status) => setCanOpenExternal(status.mode === 'local'))
      .catch(() => setCanOpenExternal(false));
  }, []);

  useEffect(() => {
    const removeListener = window.ipcRenderer.on('CODE_MACRO_ERROR', () => {
      onSelectActiveTab('logs');
    });
    return () => removeListener();
  }, [onSelectActiveTab]);

  // A chain's setup code has no plugin file or settings, only the chain's options.
  const chainId = chainIdFromPluginId(pluginInfo.pluginId);
  const chainSetup = !!chainId;
  const chain = useSettingsStore((state) => (chainId ? state.settings.scripts?.chains?.[chainId] : undefined));
  const back = () => navigate(chainSetup ? '/' : '/plugins');

  const exportMacro = () => {
    window.ipcRenderer.action('EXPORT_MACRO', {
      macroInfo: pluginInfo,
      code: { code: code.current },
    });
  };

  const openInEditor = () => {
    // Persist the latest in-app edits first so the external editor opens the
    // current source, then hand off to the user's editor.
    window.ipcRenderer.action('SAVE_MACRO', {
      pluginId: pluginInfo.pluginId,
      code: { code: code.current },
    });
    window.ipcRenderer.action('OPEN_PLUGIN_EXTERNAL', pluginInfo.pluginId);
  };

  const saveChainConfig = (config: ScriptSettingsSection[]) => {
    if (chain) setChain({ ...chain, config: (config.length ? config : undefined) as typeof chain.config });
  };

  const handlePluginSave = (updatedMacro: MacroInfo) => {
    if (MacroInfoValidator(updatedMacro.name, updatedMacro.description)) return;
    savePlugin(updatedMacro);
    setMacroInfo(updatedMacro);
    window.localStorage.removeItem('macros_cache');
  };

  const runnable =
    !chainSetup && (pluginInfo.scriptType === 'script' || pluginInfo.scriptType === 'action');
  const hasOptions = !!pluginInfo.config?.length;

  const openOptions = () =>
    setPanel({
      active: true,
      tab: 'plugin',
      data: { plugin: pluginInfo, view: 'options' },
    });

  // Rarely used actions live in the overflow menu to keep the toolbar calm.
  const botContext = useBotContextMenu(editorRef);
  const moreItems: MenuProps['items'] = [
    ...(llm.configured && pluginInfo.scriptType !== 'profileUi' && !chainSetup
      ? [
          {
            key: 'ai-assistant',
            icon: <RobotOutlined />,
            label: 'AI assistant',
            onClick: () => onSelectActiveTab(LLM_CODE_TAB),
          },
        ]
      : []),
    {
      key: 'ai',
      icon: <RobotOutlined />,
      label: 'AI help',
      onClick: () => setAiHelpModal(true),
    },
    {
      key: 'docs',
      icon: <ReadOutlined />,
      label: 'Documentation',
      onClick: () => window.open('https://jnbot.netlify.app/docs', '_blank'),
    },
    ...(!window.web && !chainSetup
      ? [
          { type: 'divider' as const },
          {
            key: 'open-external',
            icon: <ExportOutlined />,
            label: canOpenExternal
              ? 'Open in external editor'
              : 'External editor (local storage only)',
            disabled: !canOpenExternal,
            onClick: openInEditor,
          },
          {
            key: 'export',
            icon: <ShareAltOutlined />,
            label: 'Export plugin',
            onClick: exportMacro,
          },
        ]
      : []),
  ];

  return (
    <>
      <header
        className="drag-region"
        style={{
          minWidth: 0,
          height: 54,
          boxSizing: 'border-box',
          padding: `${token.paddingXXS}px ${token.paddingSM}px`,
          borderBottom: `${token.lineWidth}px ${token.lineType} ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
        }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr minmax(0, auto) 1fr',
            alignItems: 'center',
            gap: token.marginSM,
            height: '100%',
          }}
        >
          <div style={{ marginLeft: isMac ? 76 : undefined }}>
            <Button
              className="no-drag"
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={back}
              aria-label={chainSetup ? 'Back to the dashboard' : 'Back to plugins'}
            />
          </div>

          <Flex vertical align="center" style={{ minWidth: 0, lineHeight: 1.3 }}>
            <Typography.Text strong ellipsis style={{ maxWidth: '100%' }}>
              {pluginInfo.name}
            </Typography.Text>
            <Typography.Text
              type="secondary"
              ellipsis
              style={{ maxWidth: '100%', fontSize: token.fontSizeSM }}
            >
              <CodeOutlined style={{ marginRight: token.marginXXS }} />
              {chainSetup ? 'Runs for every alt before the steps' : `${pluginInfo.scriptType} · ${pluginInfo.language}`}
            </Typography.Text>
          </Flex>

        <Space
          className={isWin ? 'windows-controls-space no-drag' : 'no-drag'}
          size={token.marginXXS}
          style={{ justifySelf: 'end' }}
        >
          {runnable && (
              <PlayButton
                pluginInfo={pluginInfo}
                code={code}
                id="run-macro-btn"
                script="macro"
                args={{ devMode: true }}
                consoleType="macro_console"
              />
          )}
          {pluginInfo.scriptType === 'profileUi' && (
              <Button
                id="run-macro-btn"
                type="primary"
                icon={<PlayCircleOutlined />}
                onClick={onRunPreview}
              >
                Run
              </Button>
          )}

          <Divider orientation="vertical" style={{ marginInline: token.marginXXS }} />

          {runnable && (
            <Tooltip
              title={
                hasOptions
                  ? 'Plugin options'
                  : 'No options yet — add them in Plugin settings'
              }
            >
              <Button
                type="text"
                icon={<SlidersOutlined />}
                onClick={openOptions}
                disabled={!hasOptions}
                aria-label="Plugin options"
              />
            </Tooltip>
          )}

          <Tooltip title={chainSetup ? 'Chain options' : 'Plugin settings'}>
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setPluginSettingsModal(true)}
              aria-label={chainSetup ? 'Chain options' : 'Plugin settings'}
            />
          </Tooltip>

          <Dropdown
            trigger={['click']}
            menu={{
              items: moreItems,
              onClick: ({ key }) => botContext.onClick(key),
              onOpenChange: (keys) => keys.includes(BOT_CONTEXT_KEY) && botContext.load(),
            }}
          >
            <Button type="text" icon={<MoreOutlined />} aria-label="More actions" />
          </Dropdown>

            <Button
              type="text"
              icon={<VscLayoutSidebarRightOff />}
              onClick={() => onSelectActiveTab('logs')}
              aria-label="Open logs"
            />
        </Space>
        </div>
      </header>

      {chainSetup ? (
        pluginSettingsModal && (
          <ChainConfigModal
            config={chain?.config as ScriptSettingsSection[] | undefined}
            onClose={() => setPluginSettingsModal(false)}
            onSave={saveChainConfig}
          />
        )
      ) : (
        <PluginSettingsModal
          visible={pluginSettingsModal}
          onClose={() => setPluginSettingsModal(false)}
          macroData={pluginInfo}
          onSave={handlePluginSave}
        />
      )}

      <AIHelpModal
        visible={aiHelpModal}
        onClose={() => setAiHelpModal(false)}
      />

    </>
  );
};

export default Nav;
