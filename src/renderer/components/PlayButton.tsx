import React, { useState } from 'react';
import { useSettingsStore, selectScripts } from '../redux/settings';
import { Button } from 'antd';
import { PlayCircleOutlined, StopOutlined } from '@ant-design/icons';
import { MacroInfo } from '../../main/src/types';

interface PlayButtonProps {
  code?: React.RefObject<any>;
  pluginInfo?: MacroInfo;
  args?: Record<string, any>;
  script: string;
  consoleType?: string;
  id?: string;
}

const PlayButton: React.FC<PlayButtonProps> = ({
  code,
  pluginInfo,
  args,
  script,
  consoleType = 'console',
  id,
}) => {
  const scripts = useSettingsStore(selectScripts);
  const [loading, setLoading] = useState(false);
  const activeScript =
    !!pluginInfo && scripts.isScriptActiveById(pluginInfo.pluginId);

  const startMacro = async () => {
    if (loading || !pluginInfo?.pluginId) return;
    if (activeScript) {
      scripts.stopAll(scripts.getInstanceIdsById(pluginInfo.pluginId)[0]);
      return;
    }
    setLoading(true);
    await scripts.startMacro({
      pluginInfo,
      args: { ...(args || {}), scriptName: script },
      consoleType,
      codeRef: code,
    });
    setLoading(false);
  };

  return (
    <Button
      id={id}
      loading={loading}
      icon={activeScript ? <StopOutlined /> : <PlayCircleOutlined />}
      onClick={startMacro}
      type="primary"
      danger={activeScript}
    >
      {activeScript ? 'Stop' : 'Run'}
    </Button>
  );
};

export default PlayButton;
