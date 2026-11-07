import { useState } from 'react';
import { Flex } from 'antd';
import type { ShareOverview, SharePreview } from '../../../common/share';
import LlmPrompt from '../llm/LlmPrompt';
import LlmAnswer from '../llm/LlmAnswer';

/** Ask the AI how a marketplace item works, from its description and code. */
const ShareAskAi = ({
  overview,
  load,
}: {
  overview: ShareOverview;
  /** The full preview (with code), downloaded on the first question. */
  load: () => Promise<SharePreview | null | undefined>;
}) => {
  const [answer, setAnswer] = useState('');

  const ask = async (question: string) => {
    const preview = await load();
    const content = preview
      ? JSON.stringify({
          details: preview.details,
          plugins: preview.plugins.map(({ name, description, scriptType, code }) => ({ name, description, scriptType, code })),
        })
      : JSON.stringify(overview);
    setAnswer(
      await window.ipcRenderer.get('LLM_ASK_SHARE', {
        question,
        title: overview.title,
        description: overview.description,
        content,
      }),
    );
  };

  return (
    <Flex vertical gap={8}>
      <LlmPrompt placeholder="Ask how this works, e.g. does it need a pickaxe?" button="Ask" onSubmit={ask} />
      {answer && <LlmAnswer text={answer} />}
    </Flex>
  );
};

export default ShareAskAi;
