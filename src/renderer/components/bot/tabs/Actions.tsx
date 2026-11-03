import React, { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Typography, theme as antTheme } from 'antd';
import {
  LogoutOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RightCircleOutlined,
  UnlockOutlined,
} from '@ant-design/icons';
import {
  useSettingsStore,
  selectJNDataByServer,
} from '../../../redux/settings';
import { ScriptActionInfo } from '../../../../main/src/types';
import { groupActionOptions } from '../../../utils/actionOptions';
import botActionHandler from '../botActionHandler';
import { BotInfo } from '../types';
import MouseControls from './MouseControls';

interface ActionsProps {
  bot: BotInfo;
  small?: boolean;
}

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <Typography.Text
    strong
    style={{
      fontSize: 11,
      letterSpacing: 1,
      textTransform: 'uppercase',
      display: 'block',
      marginBottom: 12,
    }}
  >
    {children}
  </Typography.Text>
);

const Actions: React.FC<ActionsProps> = ({ bot, small }) => {
  const JNdata = useSettingsStore(selectJNDataByServer);
  const { token } = antTheme.useToken();

  const [selectedGamemode, setSelectedGamemode] = useState<string>(() => {
    try {
      const storage = JSON.parse(localStorage.getItem('lastGamemode') || '{}');
      return storage[JNdata.server] || JNdata.data.defaultGamemode;
    } catch {
      return JNdata.data.defaultGamemode;
    }
  });
  const [joiningGamemode, setJoiningGamemode] = useState(false);

  const [actions, setActions] = useState<ScriptActionInfo[] | null>(null);
  const [scriptAction, setScriptAction] = useState<string>('');
  const [scriptArg, setScriptArg] = useState<string>('');
  const [runningAction, setRunningAction] = useState(false);

  const [eating, setEating] = useState(false);

  useEffect(() => {
    (async () => {
      const list: ScriptActionInfo[] =
        await window.ipcRenderer.get('GET_SCRIPT_ACTIONS');
      setActions(list);
    })();
  }, []);

  const actionOptions = useMemo(
    () => groupActionOptions(actions ?? []),
    [actions],
  );

  const joinGamemode = async () => {
    if (!selectedGamemode) return;
    const storage = (() => {
      try {
        return JSON.parse(localStorage.getItem('lastGamemode') || '{}');
      } catch {
        return {};
      }
    })();
    storage[JNdata.server] = selectedGamemode;
    localStorage.setItem('lastGamemode', JSON.stringify(storage));
    setJoiningGamemode(true);
    await botActionHandler('joinGamemode', selectedGamemode, true);
    setJoiningGamemode(false);
  };

  const runScriptAction = async () => {
    if (!scriptAction) return;
    setRunningAction(true);
    await botActionHandler(
      'runScriptAction',
      { arg: scriptArg, id: scriptAction },
      true,
    );
    setRunningAction(false);
  };

  const eat = async () => {
    setEating(true);
    await botActionHandler('eat', undefined, true);
    setEating(false);
  };

  const manualActions: {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    loading?: boolean;
    danger?: boolean;
  }[] = [
    {
      label: 'Eat held food',
      icon: null,
      onClick: eat,
      loading: eating,
    },
    {
      label: 'Enter password',
      icon: <UnlockOutlined />,
      onClick: () => botActionHandler('login'),
    },
    {
      label: 'Right-click item',
      icon: <RightCircleOutlined />,
      onClick: () => botActionHandler('activateItem'),
    },
    {
      label: 'Respawn',
      icon: <ReloadOutlined />,
      onClick: () => botActionHandler('respawn'),
    },
    {
      label: 'Quit server',
      icon: <LogoutOutlined />,
      danger: true,
      onClick: () => botActionHandler('leave'),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: small ? 20 : 28 }}>
      <div>
        <SectionLabel>Join a gamemode</SectionLabel>
        <div style={{ display: 'flex', gap: 8 }}>
          <Select
            value={selectedGamemode}
            onChange={setSelectedGamemode}
            options={JNdata.data.gamemodes.map((gm) => ({
              label: gm,
              value: gm,
            }))}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={joinGamemode}
            loading={joiningGamemode}
          >
            Join
          </Button>
        </div>
      </div>

      <div>
        <SectionLabel>Run a script action</SectionLabel>
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}
        >
          <div style={{ flex: '1 1 160px' }}>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 11, display: 'block', marginBottom: 4 }}
            >
              Action
            </Typography.Text>
            <Select
              placeholder="Select script action..."
              value={scriptAction || undefined}
              onChange={setScriptAction}
              loading={actions === null}
              options={actionOptions}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <Typography.Text
              type="secondary"
              style={{ fontSize: 11, display: 'block', marginBottom: 4 }}
            >
              Argument (optional)
            </Typography.Text>
            <Input
              placeholder="e.g. 64"
              value={scriptArg}
              onChange={(e) => setScriptArg(e.target.value)}
            />
          </div>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            onClick={runScriptAction}
            loading={runningAction}
            disabled={!scriptAction}
          >
            Run
          </Button>
        </div>
      </div>

      <div>
        <SectionLabel>Mouse</SectionLabel>
        <MouseControls botId={bot.botId} />
      </div>

      <div>
        <SectionLabel>Manual actions</SectionLabel>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fit, minmax(${small ? 120 : 160}px, 1fr))`,
            gap: 8,
          }}
        >
          {manualActions.map((a) => (
            <Button
              key={a.label}
              icon={a.icon}
              onClick={a.onClick}
              loading={a.loading}
              danger={a.danger}
              style={{
                height: small ? 36 : 44,
                background: token.colorFillTertiary,
                border: 'none',
              }}
            >
              {a.label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default Actions;
