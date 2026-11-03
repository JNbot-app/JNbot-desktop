import { useEffect, useState } from 'react';
import { Button, Flex, Modal, Space, Tag, Tooltip, Typography, theme } from 'antd';
import {
  CloseOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import {
  isActiveSession,
  isRecordingSession,
  type AutomationSessionStatus,
} from '../../../common/automation';
import {
  controlAutomationSession,
  initAutomationSessions,
  useAutomationSessions,
} from '../../redux/automationSessions';

const { Text } = Typography;

const sessionTag = (session: AutomationSessionStatus) => {
  const recording = isRecordingSession(session);
  switch (session.state) {
    case 'recording':
      return { color: 'red', label: 'Recording' };
    case 'playing':
      return { color: 'processing', label: 'Replaying' };
    case 'paused':
      return {
        color: 'warning',
        label: recording ? 'Recording paused' : 'Replay paused',
      };
    case 'failed':
      return { color: 'error', label: 'Replay failed' };
    default:
      return { color: 'warning', label: 'Finished with warnings' };
  }
};

export default function AutomationSessionStrip() {
  const { token } = theme.useToken();
  const sessions = useAutomationSessions((state) => state.sessions);
  const [dismissed, setDismissed] = useState<Record<string, boolean>>({});
  const [report, setReport] = useState<AutomationSessionStatus>();

  useEffect(initAutomationSessions, []);

  const values = Object.values(sessions);
  // Running sessions always show; finished ones only when they need attention.
  const active =
    values.find(isActiveSession) ??
    values.find(
      (session) =>
        !dismissed[session.sessionId] &&
        (session.state === 'failed' ||
          (session.state === 'completed' && session.issues.length > 0)),
    );

  if (!active) return null;

  const running = isActiveSession(active);
  const tag = sessionTag(active);
  const hotkeys =
    running && active.target.kind === 'minecraft'
      ? active.state === 'paused'
        ? 'F9 resume · F8 stop'
        : 'F9 pause · F8 stop'
      : undefined;
  const detail = active.state === 'failed' ? active.error : active.message;

  return (
    <>
      <div
        style={{
          position: 'fixed',
          left: '50%',
          bottom: token.marginMD,
          transform: 'translateX(-50%)',
          zIndex: 1200,
          borderRadius: token.borderRadiusLG,
          padding: `${token.paddingXS}px ${token.paddingMD}px`,
          background: token.colorBgElevated,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: token.boxShadowSecondary,
        }}
      >
        <Space size="middle" align="center">
          <Tag color={tag.color} style={{ margin: 0 }}>
            {tag.label}
          </Tag>

          <Text ellipsis style={{ maxWidth: 360 }}>
            {active.target.username ?? String(active.target.id)}
            {!isRecordingSession(active) &&
              active.totalSteps > 0 &&
              ` · ${active.currentStep}/${active.totalSteps}`}
            {detail && ` · ${detail}`}
          </Text>

          {hotkeys && (
            <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
              {hotkeys}
            </Text>
          )}

          {running ? (
            <Space size={token.marginXS}>
              {active.state === 'paused' ? (
                <Tooltip title="Resume">
                  <Button
                    size="small"
                    icon={<PlayCircleOutlined />}
                    onClick={() => void controlAutomationSession(active, 'resume')}
                  />
                </Tooltip>
              ) : (
                <Tooltip title="Pause">
                  <Button
                    size="small"
                    icon={<PauseOutlined />}
                    onClick={() => void controlAutomationSession(active, 'pause')}
                  />
                </Tooltip>
              )}
              <Tooltip title="Stop">
                <Button
                  danger
                  size="small"
                  icon={<StopOutlined />}
                  onClick={() => void controlAutomationSession(active, 'stop')}
                />
              </Tooltip>
            </Space>
          ) : (
            <Space size={token.marginXS}>
              {active.issues.length > 0 && (
                <Button size="small" onClick={() => setReport(active)}>
                  Report ({active.issues.length})
                </Button>
              )}
              <Button
                type="text"
                size="small"
                icon={<CloseOutlined />}
                aria-label="Dismiss"
                onClick={() =>
                  setDismissed((current) => ({
                    ...current,
                    [active.sessionId]: true,
                  }))
                }
              />
            </Space>
          )}
        </Space>
      </div>

      <Modal
        title="Replay report"
        open={Boolean(report)}
        footer={null}
        onCancel={() => setReport(undefined)}
      >
        <Flex vertical gap={token.marginSM}>
          {(report?.issues ?? []).map((issue, index) => (
            <div
              key={index}
              style={{
                padding: `${token.paddingXS}px ${token.paddingSM}px`,
                background: token.colorFillTertiary,
                borderRadius: token.borderRadiusSM,
              }}
            >
              <Text strong>
                Step {issue.stepIndex}: {issue.kind}
              </Text>
              <div>
                <Text type="secondary">{issue.reason}</Text>
              </div>
            </div>
          ))}
        </Flex>
      </Modal>
    </>
  );
}
