import { useRef, useState, type ReactNode } from 'react';
import { Button, Flex, Input, Tooltip, theme } from 'antd';
import { ArrowUpOutlined, BulbOutlined } from '@ant-design/icons';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import useLlm from '../../hooks/useLlm';
import useLlmRun, { type LlmRun } from '../../hooks/useLlmRun';
import LlmActivity from './LlmActivity';

/** Something to show under the prompt once a request finishes, e.g. changes to review. */
export type LlmResult = (dismiss: () => void) => ReactNode;

export interface LlmPromptProps {
  placeholder: string;
  button?: string;
  /** Example requests, shown as one-click starters while the field is empty. */
  examples?: string[];
  /** Progress label while the reply writes its result (code or JSON). */
  writingLabel?: string;
  /** Show the reply's sentences as an answer under the prompt. */
  showAnswer?: boolean;
  /** Start as a small link with this label; the field appears on click. */
  collapsedLabel?: string;
  /** Use this run instead of an own one, to follow its progress (e.g. stream code into an editor). */
  ai?: LlmRun;
  /** Runs the request through `run` (which streams progress). */
  onSubmit: (text: string, run: LlmRun['run']) => Promise<LlmResult | void>;
}

/** "Describe it" field with live progress. Renders nothing until an AI provider is set up. */
const LlmPrompt = ({ placeholder, button = 'Generate', examples = [], writingLabel = 'Writing the draft', showAnswer = true, collapsedLabel, ai: shared, onSubmit }: LlmPromptProps) => {
  const { configured } = useLlm();
  const { token } = theme.useToken();
  const own = useLlmRun();
  const ai = shared ?? own;
  const input = useRef<TextAreaRef>(null);
  const [text, setText] = useState('');
  const [expanded, setExpanded] = useState(!collapsedLabel);
  const [result, setResult] = useState<LlmResult>();
  if (!configured) return null;

  if (!expanded) {
    return (
      <Button
        type="text"
        size="small"
        icon={<BulbOutlined />}
        onClick={() => {
          setExpanded(true);
          setTimeout(() => input.current?.focus());
        }}
        style={{ alignSelf: 'flex-start', color: token.colorTextSecondary }}
      >
        {collapsedLabel}
      </Button>
    );
  }

  const dismiss = () => {
    setResult(undefined);
    ai.reset();
  };

  const submit = async (value = text) => {
    if (!value.trim() || ai.running) return;
    setResult(undefined);
    let succeeded = false;
    const run: LlmRun['run'] = async (event, data) => {
      const reply = await ai.run<any>(event, data);
      succeeded = reply !== undefined;
      return reply;
    };
    const shown = await onSubmit(value.trim(), run);
    // A stopped or failed run keeps the text, so it can be tweaked and sent again.
    if (succeeded) setText('');
    if (shown) setResult(() => shown);
  };

  return (
    <Flex vertical gap={token.marginXS}>
      <div style={{ position: 'relative' }}>
        <Input.TextArea
          ref={input}
          variant="filled"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPressEnter={(event) => {
            if (event.shiftKey) return;
            event.preventDefault();
            void submit();
          }}
          onBlur={() => {
            if (collapsedLabel && !text && !ai.running && !ai.startedAt && !result) setExpanded(false);
          }}
          placeholder={placeholder}
          autoSize={{ minRows: 1, maxRows: 6 }}
          disabled={ai.running}
          style={{ paddingRight: 44 }}
        />
        <Tooltip title={button}>
          <Button
            type="primary"
            shape="circle"
            size="small"
            aria-label={button}
            icon={<ArrowUpOutlined />}
            loading={ai.running}
            disabled={!text.trim()}
            onClick={() => submit()}
            style={{ position: 'absolute', right: 8, bottom: 6 }}
          />
        </Tooltip>
      </div>
      {!text && !ai.startedAt && examples.length > 0 && (
        <Flex gap={token.marginXXS} wrap>
          {examples.map((example) => (
            <Button
              key={example}
              size="small"
              color="default"
              variant="filled"
              onClick={() => {
                setText(example);
                input.current?.focus();
              }}
            >
              {example}
            </Button>
          ))}
        </Flex>
      )}
      <LlmActivity run={ai} writingLabel={writingLabel} showAnswer={showAnswer} onDismiss={dismiss} />
      {result?.(dismiss)}
    </Flex>
  );
};

export default LlmPrompt;
