import type { ShareOverview, SharePreview } from '../../../common/share';
import LlmPrompt from '../llm/LlmPrompt';
import type { LlmRun } from '../../hooks/useLlmRun';

/** Ask the AI how a marketplace item works, from its description and code. */
const ShareAskAi = ({
  overview,
  load,
}: {
  overview: ShareOverview;
  /** The full preview (with code), downloaded on the first question. */
  load: () => Promise<SharePreview | null | undefined>;
}) => {
  const ask = async (question: string, run: LlmRun['run']) => {
    const preview = await load();
    const content = preview
      ? JSON.stringify({
          details: preview.details,
          plugins: preview.plugins.map(({ name, description, scriptType, code }) => ({ name, description, scriptType, code })),
        })
      : JSON.stringify(overview);
    await run('LLM_ASK_SHARE', { question, title: overview.title, description: overview.description, content });
  };

  return (
    <LlmPrompt
      placeholder="Ask how this works, e.g. does it need a pickaxe?"
      button="Ask"
      examples={['What does it need to work?', 'Is it safe to run?', 'Which settings matter most?']}
      onSubmit={ask}
    />
  );
};

export default ShareAskAi;
