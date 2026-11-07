import { useState } from 'react';
import { Input } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import useAppApi from '../../hooks/useAppApi';
import useLlm from '../../hooks/useLlm';

interface LlmPromptProps {
  placeholder: string;
  button?: string;
  /** Runs the AI request; the input clears when it resolves. */
  onSubmit: (text: string) => Promise<void>;
}

/** "Describe it" input. Renders nothing until an AI provider is set up. */
const LlmPrompt = ({ placeholder, button = 'Generate', onSubmit }: LlmPromptProps) => {
  const { configured } = useLlm();
  const { message } = useAppApi();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  if (!configured) return null;

  const submit = async (value: string) => {
    if (!value.trim() || loading) return;
    setLoading(true);
    try {
      await onSubmit(value.trim());
      setText('');
    } catch (error) {
      message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Input.Search
      value={text}
      onChange={(event) => setText(event.target.value)}
      onSearch={submit}
      placeholder={placeholder}
      prefix={<RobotOutlined />}
      enterButton={button}
      loading={loading}
      allowClear
    />
  );
};

export default LlmPrompt;
