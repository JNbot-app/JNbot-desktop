import React, { useMemo } from 'react';
import { Modal, Space, Typography, Input, Button } from 'antd';
import useAppApi from '../../hooks/useAppApi';
import type { MinecraftCrashInfo } from '../../../main/src/types';

interface CrashReportModalProps {
  open: boolean;
  crashInfo: MinecraftCrashInfo | null;
  onClose: () => void;
}

const CrashReportModal: React.FC<CrashReportModalProps> = ({
  open,
  crashInfo,
  onClose,
}) => {
  const { message } = useAppApi();

  const crashText = useMemo(() => {
    if (!crashInfo) return '';
    const sections: string[] = [];

    sections.push(`JNbot Minecraft Crash Info`);
    sections.push(`Account: ${crashInfo.username}`);
    sections.push(`Version: ${crashInfo.version}`);
    sections.push(`Instance: ${crashInfo.instancePath}`);
    if (crashInfo.code !== undefined)
      sections.push(`Exit code: ${crashInfo.code}`);
    if (crashInfo.signal) sections.push(`Signal: ${crashInfo.signal}`);
    if (crashInfo.error) sections.push(`Error: ${crashInfo.error}`);

    const maybeAdd = (title: string, value?: string) => {
      if (!value) return;
      sections.push('');
      sections.push(`=== ${title} ===`);
      sections.push(value);
    };

    maybeAdd(
      `latest.log (${crashInfo.latestLogPath ?? 'unknown'})`,
      crashInfo.latestLogTail,
    );
    maybeAdd(
      `Crash Report (${crashInfo.crashReportPath ?? 'none'})`,
      crashInfo.crashReportTail,
    );
    maybeAdd(
      `JVM hs_err (${crashInfo.hsErrPath ?? 'none'})`,
      crashInfo.hsErrTail,
    );
    maybeAdd('Process stderr (tail)', crashInfo.stderrTail);
    maybeAdd('Process stdout (tail)', crashInfo.stdoutTail);

    return sections.join('\n');
  }, [crashInfo]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(crashText);
      message.success('Crash report copied to clipboard');
    } catch (err) {
      message.error('Failed to copy crash report');
    }
  };

  return (
    <Modal
      open={open}
      title="Minecraft crash details"
      onCancel={onClose}
      width={900}
      footer={
        <Space>
          <Button onClick={handleCopy} disabled={!crashText}>
            Copy
          </Button>
          <Button type="primary" onClick={onClose}>
            Close
          </Button>
        </Space>
      }
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          This is a tail of the most relevant logs (latest.log, crash-reports,
          JVM hs_err, and launcher stdout/stderr).
        </Typography.Paragraph>
        <Input.TextArea
          value={crashText}
          readOnly
          autoSize={{ minRows: 10, maxRows: 22 }}
          style={{
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          }}
        />
      </Space>
    </Modal>
  );
};

export default CrashReportModal;
