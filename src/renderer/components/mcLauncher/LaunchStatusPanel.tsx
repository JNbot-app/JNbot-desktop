import React from 'react';
import {
  Button,
  Flex,
  Progress,
  Spin,
  Typography,
  theme as antTheme,
} from 'antd';
import {
  CheckCircleFilled,
  CloseCircleFilled,
  FileTextOutlined,
  LoadingOutlined,
  MinusCircleFilled,
} from '@ant-design/icons';
import type { LauncherState } from '../../hooks/launcherState';

interface LaunchStatusPanelProps {
  state: Exclude<LauncherState, { kind: 'idle' }>;
  onOpenLogs: () => void;
  onOpenCrashReport: () => void;
}

const LaunchStatusPanel: React.FC<LaunchStatusPanelProps> = ({
  state,
  onOpenLogs,
  onOpenCrashReport,
}) => {
  const { token } = antTheme.useToken();

  const status = (() => {
    switch (state.kind) {
      case 'preparing':
        return {
          icon: <Spin indicator={<LoadingOutlined spin />} size="small" />,
          title: 'Checking installation…',
          detail: 'Verifying the selected version and required files.',
        };
      case 'downloading':
        return {
          icon: <Spin indicator={<LoadingOutlined spin />} size="small" />,
          title: 'Downloading required files…',
          detail: state.taskName,
        };
      case 'starting':
        return {
          icon: <Spin indicator={<LoadingOutlined spin />} size="small" />,
          title: 'Starting Minecraft…',
          detail: 'Preparing the game process and window.',
        };
      case 'running':
        return {
          icon: (
            <CheckCircleFilled
              aria-hidden
              style={{ color: token.colorSuccess }}
            />
          ),
          title: 'Minecraft is running',
          detail: 'The game window opened successfully.',
        };
      case 'exited':
        return {
          icon: (
            <MinusCircleFilled
              aria-hidden
              style={{ color: token.colorTextSecondary }}
            />
          ),
          title: 'Minecraft closed',
          detail: 'The game process exited normally.',
        };
      case 'failed':
        return {
          icon: (
            <CloseCircleFilled
              aria-hidden
              style={{ color: token.colorError }}
            />
          ),
          title: 'Launch failed',
          detail: state.message,
        };
      default: {
        const exhaustive: never = state;
        return exhaustive;
      }
    }
  })();


  if (state.kind === 'downloading'  && state.percent === 0) return null
  return (
    <div
      aria-live="polite"
      style={{
        padding: token.paddingSM,
        borderRadius: token.borderRadius,
        background: token.colorFillAlter,
      }}
    >
     { <Flex gap={token.marginSM} align="flex-start">
        <span style={{ paddingTop: 2, lineHeight: 1 }}>{status.icon}</span>
        <Flex vertical gap={2} style={{ minWidth: 0, flex: 1 }}>
          <Typography.Text strong>{status.title}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {status.detail}
          </Typography.Text>
        </Flex>
      </Flex>}

      {state.kind === 'downloading' && state.percent > 0 && (
        <Progress
          percent={state.percent}
          size="small"
          status="active"
          style={{ marginTop: token.marginXS, marginBottom: 0 }}
        />
      )}

      {state.kind === 'failed' && (
        <Flex gap="small" wrap style={{ marginTop: token.marginXS }}>
          <Button
            type="link"
            size="small"
            icon={<FileTextOutlined />}
            onClick={onOpenLogs}
            style={{ paddingInline: 0 }}
          >
            View logs
          </Button>
          {state.crashInfo && (
            <Button type="link" size="small" onClick={onOpenCrashReport}>
              View crash report
            </Button>
          )}
        </Flex>
      )}
    </div>
  );
};

export default LaunchStatusPanel;
