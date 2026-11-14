import { useEffect, useRef, useState } from 'react';
import { Button, Flex, Typography, theme } from 'antd';
import { CheckCircleFilled, CheckOutlined, CloseOutlined, LoadingOutlined } from '@ant-design/icons';
import { llmAnswerText } from '../../../common/llm';
import type { LlmRun } from '../../hooks/useLlmRun';
import LlmAnswer from './LlmAnswer';

/** Seconds since `since`, ticking while `running`. */
function useElapsed(since?: number, until?: number, running?: boolean) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  return since ? Math.max(0, Math.round(((running ? now : until ?? now) - since) / 1_000)) : 0;
}

/** Reasoning: the latest line while it streams, all of it on demand. */
function Thinking({ text, live }: { text: string; live: boolean }) {
  const { token } = theme.useToken();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [text, open]);
  if (!text.trim()) return null;
  const latest = text.trim().split('\n').filter(Boolean).at(-1);
  return (
    <Flex vertical gap={4}>
      <Typography.Link type="secondary" style={{ fontSize: token.fontSizeSM }} onClick={() => setOpen(!open)}>
        {open ? 'Hide reasoning' : 'Show reasoning'}
      </Typography.Link>
      {open ? (
        <div
          ref={box}
          style={{
            maxHeight: 160,
            overflow: 'auto',
            whiteSpace: 'pre-wrap',
            fontSize: token.fontSizeSM,
            color: token.colorTextSecondary,
            borderInlineStart: `2px solid ${token.colorBorderSecondary}`,
            paddingInlineStart: token.paddingXS,
          }}
        >
          {text.trim()}
        </div>
      ) : (
        live && (
          <Typography.Text type="secondary" italic ellipsis style={{ fontSize: token.fontSizeSM }}>
            {latest}
          </Typography.Text>
        )
      )}
    </Flex>
  );
}

interface LlmActivityProps {
  run: LlmRun;
  /** Step shown while the reply streams a code block (the result being written). */
  writingLabel?: string;
  /** Show the reply's sentences (not its code) as the answer. */
  showAnswer?: boolean;
  onDismiss?: () => void;
}

/**
 * What an AI request is doing right now: its steps, live reasoning and the
 * streamed answer, so the user never stares at a bare spinner.
 */
const LlmActivity = ({ run, writingLabel = 'Writing code', showAnswer = true, onDismiss }: LlmActivityProps) => {
  const { token } = theme.useToken();
  const elapsed = useElapsed(run.startedAt, run.finishedAt, run.running);
  if (!run.startedAt) return null;

  const answer = llmAnswerText(run.text);
  const writing = run.text.includes('```');
  const steps = [...run.steps];
  if (writing) steps.push(writingLabel);
  else if (run.running && !steps.length) steps.push(run.thinking ? 'Thinking' : 'Starting');
  else if (run.running && run.text) steps.push('Answering');

  return (
    <Flex
      vertical
      gap={token.marginXS}
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        padding: token.paddingSM,
        background: token.colorFillQuaternary,
      }}
    >
      <Flex align="center" gap={token.marginXS}>
        {run.running ? (
          <LoadingOutlined style={{ color: token.colorPrimary }} />
        ) : run.error ? (
          <CloseOutlined style={{ color: token.colorError }} />
        ) : (
          <CheckCircleFilled style={{ color: token.colorSuccess }} />
        )}
        <Typography.Text strong style={{ flex: 1 }}>
          {run.running ? steps.at(-1) : run.error ? 'Something went wrong' : run.stopped ? 'Stopped' : 'Done'}
        </Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          {elapsed}s
        </Typography.Text>
        {run.running ? (
          <Button size="small" onClick={run.stop}>
            Stop
          </Button>
        ) : (
          onDismiss && <Button size="small" type="text" icon={<CloseOutlined />} onClick={onDismiss} aria-label="Dismiss" />
        )}
      </Flex>
      {steps.length > 1 && (
        <Flex vertical gap={2} style={{ paddingInlineStart: token.paddingXXS }}>
          {steps.slice(0, run.running ? -1 : undefined).map((step, index) => (
            <Typography.Text key={index} type="secondary" style={{ fontSize: token.fontSizeSM }}>
              <CheckOutlined style={{ color: token.colorSuccess, marginInlineEnd: token.marginXS }} />
              {step}
            </Typography.Text>
          ))}
        </Flex>
      )}
      <Thinking text={run.thinking} live={run.running && !run.text} />
      {run.error && <Typography.Text type="danger">{run.error}</Typography.Text>}
      {showAnswer && answer && <LlmAnswer text={answer} />}
    </Flex>
  );
};

export default LlmActivity;
