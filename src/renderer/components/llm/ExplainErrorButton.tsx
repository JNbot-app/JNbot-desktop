import { useState } from 'react';
import { Button } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import useAppApi from '../../hooks/useAppApi';
import useLlm from '../../hooks/useLlm';

/** "Explain" on an error log line. Hidden until an AI provider is set up. */
const ExplainErrorButton = ({ error, scriptName }: { error: string; scriptName?: string }) => {
  const { configured } = useLlm();
  const { modal, message } = useAppApi();
  const [loading, setLoading] = useState(false);
  if (!configured) return null;

  const explain = async () => {
    setLoading(true);
    try {
      const answer = await window.ipcRenderer.get('LLM_EXPLAIN_ERROR', { error, scriptName });
      // Loaded on demand: the console stays free of the markdown renderer.
      const { default: LlmAnswer } = await import('./LlmAnswer');
      modal.info({ title: 'What went wrong', width: 640, content: <LlmAnswer text={answer} /> });
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button size="small" type="link" icon={<RobotOutlined />} loading={loading} onClick={explain}>
      Explain
    </Button>
  );
};

export default ExplainErrorButton;
