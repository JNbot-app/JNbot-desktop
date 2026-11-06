import React, { useEffect, useState } from 'react';
import {
  useSettingsStore,
  selectScripts,
  selectActiveScriptsActions,
} from '../../redux/settings';
import {
  Typography,
  Tooltip,
  Tag,
  Button,
  Progress,
  Divider,
  Flex,
  Space,
  Card as AntCard
} from 'antd';
import {
  CloseOutlined,
  ReloadOutlined,
  FileTextOutlined,
  PauseOutlined,
  CaretRightOutlined,
  RedoOutlined,
  StepForwardOutlined,
  StepBackwardOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import Card from '../Card';
import { ActiveScriptsType } from '../../../main/src/types';
import { ScriptControl } from '../../../common/CommonEnums';

const { Text } = Typography;

type ProgressInfo = { current: number; total: number; eta?: number };

const CONTROL_BUTTONS: { bit: ScriptControl; icon: React.ReactNode; title: string }[] = [
  { bit: ScriptControl.RESTART, icon: <RedoOutlined />, title: 'Restart' },
  { bit: ScriptControl.PREVIOUS, icon: <StepBackwardOutlined />, title: 'Previous' },
  { bit: ScriptControl.SKIP, icon: <StepForwardOutlined />, title: 'Skip' },
];

/** Turn a number of seconds into a compact "1h 2m" / "3m 20s" / "45s" label. */
const formatEta = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) {
    const s = seconds % 60;
    return s ? `${m}m ${s}s` : `${m}m`;
  }
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
};

/* ------------------------------------------------------------------ */
/* small pieces                                                        */
/* ------------------------------------------------------------------ */

const ControlBtn: React.FC<{
  icon: React.ReactNode;
  title: string;
  danger?: boolean;
  onClick: (e: React.MouseEvent) => void;
}> = ({ icon, title, danger, onClick }) => (
  <Tooltip title={title}>
    <Button type="text" shape="circle" danger={danger} icon={icon} aria-label={title} onClick={onClick} />
  </Tooltip>
);

const ProgressBlock: React.FC<{ progress: ProgressInfo }> = ({ progress }) => {
  const { current, total, eta } = progress;
  const percent = Math.min(100, Math.round((current / total) * 100));

  return (
    <Flex vertical gap={2}>
      <Progress percent={percent} size="small" showInfo={false} />
      <Flex align="center" gap={8} style={{ fontSize: 12 }}>
        <Text strong style={{ fontVariantNumeric: 'tabular-nums' }}>
          {percent}%
        </Text>
        <Text type="secondary">
          {current} / {total}
        </Text>
        {typeof eta === 'number' && eta > 0 && (
          <Text type="secondary" style={{ marginLeft: 'auto' }}>
            <ClockCircleOutlined /> {formatEta(eta)} left
          </Text>
        )}
      </Flex>
    </Flex>
  );
};

/* ------------------------------------------------------------------ */
/* row                                                                 */
/* ------------------------------------------------------------------ */

interface RowProps {
  activeScript: ActiveScriptsType[string];
  progress?: ProgressInfo;
  latestAction?: string;
  paused: boolean;
  onTogglePause: () => void;
  scriptsService: ReturnType<typeof selectScripts>;
}

const ScriptRow: React.FC<RowProps> = ({
  activeScript,
  progress,
  latestAction,
  paused,
  onTogglePause,
  scriptsService,
}) => {
  const isMinecraft = activeScript.origin === 'minecraft';
  const running = !paused;
  const controls = activeScript.controls ?? 0;
  const canToggle = (controls & (ScriptControl.PAUSE | ScriptControl.RESUME)) !== 0;

  return (
    <AntCard size="small" >
      <Flex align="center" gap={16}>
  

        <Flex vertical gap={7} flex={1} style={{ minWidth: 0 }}>
          <Flex align="center" gap={10}>
            <Text strong ellipsis style={{ fontSize: 15 }}>
              {activeScript.name}
            </Text>
            <Tag color={running ? 'success' : 'warning'} style={{ marginInlineEnd: 0 }}>
              {running ? 'Running' : 'Paused'}
            </Tag>
            {activeScript.presetName && (
              <Tag style={{ marginInlineEnd: 0 }}>{activeScript.presetName}</Tag>
            )}
          </Flex>

          {isMinecraft ? (
            <Space size={[4, 4]} wrap>
              <Tag>Version: {activeScript.minecraft?.requestedVersion ?? '/'}</Tag>
              <Tag>Stage: {activeScript.minecraft?.stage ?? '/'}</Tag>
              <Tag>Status: {activeScript.minecraft?.status ?? '/'}</Tag>
            </Space>
          ) : (
            <>
              {latestAction && (
                <Text type="secondary" ellipsis style={{ fontSize: 12.5 }}>
                  {latestAction}
                </Text>
              )}
              {progress && <ProgressBlock progress={progress} />}
            </>
          )}
        </Flex>

        <Flex align="center" gap={0}>
          {!isMinecraft && (
            <>
              {CONTROL_BUTTONS.filter((c) => controls & c.bit).map((c) => (
                <ControlBtn
                  key={c.bit}
                  icon={c.icon}
                  title={c.title}
                  onClick={(e) => {
                    e.stopPropagation();
                    scriptsService.sendControl(activeScript.instanceId, c.bit);
                  }}
                />
              ))}
              {canToggle && (
                <ControlBtn
                  icon={running ? <PauseOutlined /> : <CaretRightOutlined />}
                  title={running ? 'Pause' : 'Resume'}
                  onClick={(e) => {
                    e.stopPropagation();
                    scriptsService.sendControl(
                      activeScript.instanceId,
                      running ? ScriptControl.PAUSE : ScriptControl.RESUME,
                    );
                    onTogglePause();
                  }}
                />
              )}
              <ControlBtn
                icon={<ReloadOutlined />}
                title="Reload"
                onClick={(e) => {
                  e.stopPropagation();
                  scriptsService.restart(activeScript.instanceId);
                }}
              />
              <Divider orientation="vertical" />
            </>
          )}
          <ControlBtn
            icon={<CloseOutlined />}
            title="Stop"
            danger
            onClick={(e) => {
              e.stopPropagation();
              scriptsService.stop(activeScript.instanceId);
            }}
          />
        </Flex>
      </Flex>
    </AntCard>
  );
};

/* ------------------------------------------------------------------ */
/* card                                                                */
/* ------------------------------------------------------------------ */

const ActiveScripts: React.FC = () => {
  const scriptsService = useSettingsStore(selectScripts);
  const activeScriptActions = useSettingsStore(selectActiveScriptsActions);
  const [progress, setProgress] = useState<Record<string, ProgressInfo>>({});
  // Optimistic pause/resume state — flipped when the user toggles.
  const [pausedMap, setPausedMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const removeListener = window.ipcRenderer.on('PROGRESS_UPDATE', (p: any) => {
      if (!p) return;
      if (typeof p.total === 'number' && typeof p.current === 'number') {
        if (!p.instanceId) return;
        setProgress((pr) => ({
          ...pr,
          [p.instanceId]: { current: p.current, total: p.total, eta: p.eta },
        }));
      } else {
        setProgress(p);
      }
    });

    window.ipcRenderer.action('SCRIPT_PROGRESS');
    return () => removeListener();
  }, []);

  const scripts = Object.values(scriptsService.raw);

  return (
    <Card
      title="Active scripts"
      icon={<FileTextOutlined />}
      style={{ height: '100%', minHeight: '350px' }}
    >
      {scripts.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden' }}>
          <img
            className="unselectable undragable"
            style={{ width: '185px', opacity: 0.1, marginTop: '1rem' }}
            src="data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgNTEyIDUxMiIgeG1sOnNwYWNlPSJwcmVzZXJ2ZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTIzLjM5IDM5MS45NTJoMTcuMjg0djMuNDc2YzAgMzEuOTMyIDI4LjMwNCA1Ny45MDIgNjMuMDkzIDU3LjkwMkgzODguNmMzNC43OTkgMCA2My4wMTA0LTI1Ljk3MSA2My4wMTA0LTU3LjkwMlYxNzcuOTUyYzAtMzEuOTIzLTI4LjMwNS01Ny45MDMtNjMuMDEwNC01Ny45MDNoLTE3LjI4M3YtMy40NzVjMC0zMS45MzUtMjguMjk1LTU3LjkwNC02My4wOTQtNTcuOTA0SDEyMy4zOWMtMzQuNzg5IDAtNjMuMDkzIDI1Ljk3LTYzLjA5MyA1Ny45MDR2MjE3LjQ3NGMwIDMxLjkyMiAyOC4zMDQgNTcuOTA0IDYzLjA5MyA1Ny45MDR6TTM4OC42IDEzOS4wMDRjMjMuNDQ1IDAgNDIuNDQ1IDE3LjQzOCA0Mi40NDUgMzguOTQ4djIxNy40NzZjMCAyMS41MDktMTkgMzguOTQ5LTQyLjQ0NSAzOC45NDlIMjAzLjc2OGMtMjMuNDM2IDAtNDIuNDM1LTE3LjQ0LTQyLjQzNS0zOC45NDlWMTc3Ljk1MmMwLTIxLjUxMSAxOC45OTktMzguOTQ4IDQyLjQzNS0zOC45NDhIMzg4LjZ6bS0zMDcuNjU2LTIyLjQzYzAtMjEuNTExIDE4Ljk5OS0zOC45NDkgNDIuNDQ2LTM4Ljk0OWgxODQuODMzYzIzLjQ0NyAwIDQyLjQ0NSAxNy40MzggNDIuNDQ1IDM4Ljk0OXYzLjQ3NWgtMTQ2LjljLTM0Ljc4OSAwLTYzLjA5MyAyNS45OC02My4wOTMgNTcuOTAzdjE5NS4wNDVIMTIzLjM5Yy0yMy40NDcgMC00Mi40NDYtMTcuNDQ5LTQyLjQ0Ni0zOC45NDlWMTE2LjU3NHoiIGZpbGw9IiM1YjcwOGMiIGNsYXNzPSJmaWxsLTAwMDAwMCI+PC9wYXRoPjxwYXRoIGQ9Ik0xOTYuNzA4IDE5OC4wMzVhOC4yMDcgOC4yMDcgMCAwIDAtOC4yMSA4LjIxMSA4LjIwNyA4LjIwNyAwIDAgMCA4LjIxIDguMjFoMTY0LjIyOGE4LjIwOCA4LjIwOCAwIDAgMCA4LjIxMS04LjIxIDguMjA4IDguMjA4IDAgMCAwLTguMjExLTguMjExSDE5Ni43MDh6TTIyMi42NTUgMjYyLjAzNmMwIDQuNTM3IDMuNjg1IDguMjExIDguMjIyIDguMjExSDM4NC43N2M0LjUzNyAwIDguMjIzLTMuNjc0IDguMjIzLTguMjExcy0zLjY4Ni04LjIyMS04LjIyMy04LjIyMUgyMzAuODc3Yy00LjUzNyAwLTguMjIyIDMuNjg0LTguMjIyIDguMjIxek0zNDkuMTUzIDMxNy44MTVhOC4yMDkgOC4yMDkgMCAwIDAtOC4yMTEtOC4yMUgxOTYuNzA4YTguMjA2IDguMjA2IDAgMCAwLTguMjEgOC4yMWMwIDQuNTM2IDMuNjczIDguMjIzIDguMjEgOC4yMjNoMTQ0LjIzNGM0LjUzNSAwIDguMjExLTMuNjg3IDguMjExLTguMjIzek00ODM4NC43NyAzNjUuMzk1SDI0OS42MWE4LjIwOSA4LjIwOSAwIDAgMC04LjIxIDguMjEyIDguMjA3IDguMjA3IDAgMCAwIDguMjEgOC4yMDloMTM1LjE2YzQuNTM3IDAgOC4yMjMtMy42NzMgOC4yMjMtOC4yMDktLjAwMDEtNC41MzctMy42ODYtOC4yMTItOC4yMjMtOC4yMTJ6IiBmaWxsPSIjNWI3MDhjIiBjbGFzcz0iZmlsbC0wMDAwMDAiPjwvcGF0aD48L3N2Zz4="
            alt="No scripts"
          />
        </div>
      ) : (
        <Flex vertical gap={12}>
          {scripts.map((s) => {
            const actions = activeScriptActions[s.instanceId];
            const latestAction = actions?.length ? actions[actions.length - 1].action : undefined;
            return (
              <ScriptRow
                key={s.instanceId}
                activeScript={s}
                progress={progress[s.instanceId]}
                latestAction={latestAction}
                paused={!!pausedMap[s.instanceId]}
                onTogglePause={() =>
                  setPausedMap((m) => ({ ...m, [s.instanceId]: !m[s.instanceId] }))
                }
                scriptsService={scriptsService}
              />
            );
          })}
        </Flex>
      )}
    </Card>
  );
};

export default ActiveScripts;
