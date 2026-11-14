import { useEffect } from 'react';
import useLlmRun from '../../hooks/useLlmRun';
import LlmActivity from './LlmActivity';

/** Streams the AI's explanation of an error as soon as it opens. */
const ExplainError = ({ error, scriptName }: { error: string; scriptName?: string }) => {
  const ai = useLlmRun();
  const { run } = ai;
  useEffect(() => {
    void run('LLM_EXPLAIN_ERROR', { error, scriptName });
  }, [run, error, scriptName]);
  return <LlmActivity run={ai} />;
};

export default ExplainError;
