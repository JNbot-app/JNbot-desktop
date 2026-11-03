import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Button,
  Empty,
  Flex,
  Modal,
  Tag,
  Typography,
  theme as antTheme,
} from 'antd';
import {
  CheckCircleOutlined,
  ClearOutlined,
  CopyOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons';
import type { MinecraftLaunchLogSnapshot } from '../../../main/src/types';
import useAppApi from '../../hooks/useAppApi';

interface LaunchLogsModalProps {
  open: boolean;
  onClose: () => void;
  snapshot: MinecraftLaunchLogSnapshot | null;
  onClear: () => void;
}

const formatTime = (timestamp: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(timestamp);

const LaunchLogsModal: React.FC<LaunchLogsModalProps> = ({
  open,
  onClose,
  snapshot,
  onClear,
}) => {
  const { token } = antTheme.useToken();
  const { message } = useAppApi();
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const followOutputRef = useRef(true);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const logs = useMemo(() => snapshot?.entries ?? [], [snapshot?.entries]);

  useEffect(() => {
    if (!open) return;
    followOutputRef.current = true;
    requestAnimationFrame(() => {
      const container = logsContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
  }, [open]);

  useEffect(() => {
    if (!open || !followOutputRef.current) return;
    const container = logsContainerRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [open, logs.length]);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const allLogsText = useMemo(
    () =>
      logs
        .map(
          (log) =>
            `[${formatTime(log.timestamp)}] [${log.type.toUpperCase()}] ${log.message}`,
        )
        .join('\n'),
    [logs],
  );

  const handleCopy = async () => {
    if (!allLogsText) return;
    try {
      await navigator.clipboard.writeText(allLogsText);
      setCopied(true);
      message.success('Launch logs copied');
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      message.error('Failed to copy launch logs');
    }
  };

  const getLogColor = (type: (typeof logs)[number]['type']) => {
    switch (type) {
      case 'error':
        return token.colorError;
      case 'stderr':
        return token.colorWarning;
      case 'info':
        return token.colorPrimary;
      case 'stdout':
        return token.colorText;
      default: {
        const exhaustive: never = type;
        return exhaustive;
      }
    }
  };

  return (
    <Modal
      title="Launch diagnostics"
      open={open}
      onCancel={onClose}
      footer={null}
      width={800}
      destroyOnHidden
    >
      <Flex vertical gap="small">
        <Flex justify="space-between" align="center" gap="middle" wrap>
          <Flex gap="small" align="center">
            <Typography.Text type="secondary">
              Minecraft launcher and runtime output
            </Typography.Text>
            {snapshot?.bridgeInstanceId && (
              <Tag variant="filled">
                Session {snapshot.bridgeInstanceId.slice(0, 8)}
              </Tag>
            )}
          </Flex>
          <Flex gap="small">
            <Button
              size="small"
              icon={copied ? <CheckCircleOutlined /> : <CopyOutlined />}
              onClick={handleCopy}
              disabled={logs.length === 0}
            >
              Copy
            </Button>
            <Button
              size="small"
              icon={<ClearOutlined />}
              onClick={onClear}
              disabled={logs.length === 0}
            >
              Clear
            </Button>
          </Flex>
        </Flex>

        {snapshot?.truncated && (
          <Flex gap="small" align="center">
            <InfoCircleOutlined
              aria-hidden
              style={{ color: token.colorTextSecondary }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Older output was removed to keep memory usage bounded.
            </Typography.Text>
          </Flex>
        )}

        <div
          ref={logsContainerRef}
          role="log"
          aria-label="Minecraft launch diagnostics"
          onScroll={(event) => {
            const element = event.currentTarget;
            followOutputRef.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              40;
          }}
          style={{
            height: 420,
            overflowY: 'auto',
            backgroundColor: token.colorBgLayout,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadius,
            padding: token.paddingSM,
            fontFamily: token.fontFamilyCode,
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {logs.length === 0 ? (
            <Flex align="center" justify="center" style={{ height: '100%' }}>
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No diagnostics recorded for this launch."
              />
            </Flex>
          ) : (
            logs.map((log) => (
              <div
                key={log.sequence}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: token.marginXS,
                  wordBreak: 'break-word',
                  whiteSpace: 'pre-wrap',
                }}
              >
                <span
                  style={{
                    color: token.colorTextTertiary,
                    flexShrink: 0,
                    userSelect: 'none',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {formatTime(log.timestamp)}
                </span>
                <span style={{ color: getLogColor(log.type) }}>
                  {log.message}
                </span>
              </div>
            ))
          )}
        </div>
      </Flex>
    </Modal>
  );
};

export default LaunchLogsModal;
