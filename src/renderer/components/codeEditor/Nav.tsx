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
import { savePlugin } from '../../redux/settings';
import PlayButton from '../PlayButton';
import PluginSettingsModal from './PluginSettingsModal';
import AIHelpModal from './AIHelpModal';
import BotContextMenu from './BotContextMenu';
import { usePanelContext } from '../other/botSideBar/SidePanelContextProvider';
import type { EditorInstance } from './CodeEditor';
import type { MacroInfo } from '../../../main/src/types';
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

  const back = () => navigate('/plugins');

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

  const handlePluginSave = (updatedMacro: MacroInfo) => {
    if (MacroInfoValidator(updatedMacro.name, updatedMacro.description)) return;
    savePlugin(updatedMacro);
    setMacroInfo(updatedMacro);
    window.localStorage.removeItem('macros_cache');
  };

  const runnable =
    pluginInfo.scriptType === 'script' || pluginInfo.scriptType === 'action';
  const hasOptions = !!pluginInfo.config?.length;

  const openOptions = () =>
    setPanel({
      active: true,
      tab: 'plugin',
      data: { plugin: pluginInfo, view: 'options' },
    });

  // Rarely used actions live in the overflow menu to keep the toolbar calm.
  const moreItems: MenuProps['items'] = [
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
    ...(!window.web
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
        <div style={{          marginLeft: isMac ? 76 : undefined,  display: 'flex',
          alignItems: 'center',
          gap: token.marginXS, flexShrink: 0, }}>
        <Button
          className="no-drag"
          type="text"
          icon={<ArrowLeftOutlined />}
          onClick={back}
          aria-label="Back to plugins"
        />

        <div
          style={{
            flex: 1,
            minWidth: 0,
            lineHeight: 1.2,
          }}
        >
          <Typography.Text strong ellipsis style={{ display: 'block' }}>
            {pluginInfo.name}
          </Typography.Text>
          <Typography.Text
            type="secondary"
            ellipsis
            style={{
              display: 'block',
              marginTop: 2,
              fontSize: token.fontSizeSM,
            }}
          >
            <CodeOutlined style={{ marginRight: token.marginXXS }} />
            {pluginInfo.scriptType} · {pluginInfo.language}
          </Typography.Text>
        </div>

        <Space
          className={isWin ? 'windows-controls-space no-drag' : 'no-drag'}
          size={token.marginXXS}
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

          {pluginInfo.scriptType !== 'profileUi' && (
            <BotContextMenu editorRef={editorRef} />
          )}
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

          <Tooltip title="Plugin settings">
            <Button
              type="text"
              icon={<SettingOutlined />}
              onClick={() => setPluginSettingsModal(true)}
              aria-label="Plugin settings"
            />
          </Tooltip>

          <Dropdown trigger={['click']} menu={{ items: moreItems }}>
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

      <PluginSettingsModal
        visible={pluginSettingsModal}
        onClose={() => setPluginSettingsModal(false)}
        macroData={pluginInfo}
        onSave={handlePluginSave}
      />

      <AIHelpModal
        visible={aiHelpModal}
        onClose={() => setAiHelpModal(false)}
      />
    </>
  );
};

export default Nav;
