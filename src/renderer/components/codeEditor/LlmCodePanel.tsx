import { useEffect, type MutableRefObject } from 'react';
import { Button, Flex, Typography, theme } from 'antd';
import { UndoOutlined } from '@ant-design/icons';
import { JS_BLOCK, codeBlock, isWholePlugin, type LlmPluginDraft } from '../../../common/llm';
import type { MacroInfo } from '../../../main/src/types';
import { savePlugin } from '../../redux/settings';
import useLlmRun from '../../hooks/useLlmRun';
import LlmPrompt, { type LlmPromptProps } from '../llm/LlmPrompt';
import type { EditorInstance } from './CodeEditor';

export const LLM_CODE_TAB = 'ai';

const NEW_EXAMPLES = {
  script: ['Mine sugar cane and sell it every 10 minutes', 'Chat with players using an AI persona', 'Keep all alts online and reconnect when kicked'],
  action: ['Open /shop and buy 64 cobblestone', 'Claim the daily kit', 'Drop everything except tools'],
};
const CHANGE_EXAMPLES = ['What does this plugin do?', 'Add options for the hard-coded values', 'Recover when the bot is kicked to the hub', 'Make it work on several alts at once'];

/**
 * Replace the editor's code as one undoable edit. While streaming, text that
 * only grows is appended, so the editor follows the AI as it types. Edits go
 * through the model: the editor itself ignores edits while it is read-only.
 */
function writeCode(editor: EditorInstance | null, code: string, follow = false) {
  const model = editor?.getModel();
  if (!editor || !model) return;
  const current = model.getValue();
  if (current === code) return;
  const end = model.getFullModelRange().getEndPosition();
  const appending = follow && code.startsWith(current);
  model.pushEditOperations(
    [],
    [
      {
        range: appending
          ? { startLineNumber: end.lineNumber, startColumn: end.column, endLineNumber: end.lineNumber, endColumn: end.column }
          : model.getFullModelRange(),
        text: appending ? code.slice(current.length) : code,
      },
    ],
    () => null,
  );
  if (follow) editor.revealLine(model.getLineCount());
}

interface LlmCodePanelProps {
  pluginInfo: MacroInfo;
  codeRef: MutableRefObject<string>;
  editorRef: MutableRefObject<EditorInstance | null>;
  setMacroInfo: (info: MacroInfo) => void;
}

/** Side panel tab: the AI writes or changes the open plugin, live in the editor. */
const LlmCodePanel = ({ pluginInfo, codeRef, editorRef, setMacroInfo }: LlmCodePanelProps) => {
  const { token } = theme.useToken();
  const ai = useLlmRun();
  const hasCode = codeRef.current.trim().length > 80;
  const scriptType = pluginInfo.scriptType === 'action' ? 'action' : 'script';

  // Stream the code into the editor as it is written.
  useEffect(() => {
    if (!ai.running) return;
    // Only a whole plugin, not an example snippet in an answer.
    const live = codeBlock(ai.text, JS_BLOCK, true);
    if (live !== undefined && isWholePlugin(live)) writeCode(editorRef.current, live, true);
  }, [ai.text, ai.running, editorRef]);

  const submit: LlmPromptProps['onSubmit'] = async (description, run) => {
    const editor = editorRef.current;
    const before = codeRef.current;
    const changing = before.trim().length > 80;
    editor?.getModel()?.pushStackElement();
    editor?.updateOptions({ readOnly: true });
    try {
      const draft = await run<LlmPluginDraft>('LLM_WRITE_PLUGIN', {
        description,
        scriptType,
        source: changing ? before : undefined,
        optionSchema: changing ? pluginInfo.config : undefined,
      });
      // Stopped, failed, or a question that was answered: keep the code as it was.
      if (!draft?.source) {
        writeCode(editor, before);
        return undefined;
      }
      writeCode(editor, draft.source);
      editor?.getModel()?.pushStackElement();
      if (Array.isArray(draft.optionSchema) && draft.optionSchema.length) {
        const updated = { ...pluginInfo, config: draft.optionSchema as MacroInfo['config'] };
        savePlugin(updated);
        setMacroInfo(updated);
      }
      return (dismiss) => (
        <Flex align="center" gap={token.marginXS} wrap>
          <Button
            size="small"
            icon={<UndoOutlined />}
            onClick={() => {
              writeCode(editorRef.current, before);
              dismiss();
            }}
          >
            Undo
          </Button>
        </Flex>
      );
    } finally {
      editor?.updateOptions({ readOnly: false });
    }
  };

  return (
    <Flex vertical gap={token.marginSM} style={{ padding: token.paddingSM }}>
      <Typography.Text type="secondary">
        {hasCode
          ? 'Describe what to change, or ask about the code. Changes appear live in the editor.'
          : `Describe what this ${scriptType === 'action' ? 'action' : 'plugin'} should do. The AI writes the code and its options.`}
      </Typography.Text>
      <LlmPrompt
        ai={ai}
        placeholder={hasCode ? 'e.g. also eat when food is low' : 'e.g. mine sugar cane and sell it every 10 minutes'}
        button={hasCode ? 'Change' : 'Write'}
        examples={hasCode ? CHANGE_EXAMPLES : NEW_EXAMPLES[scriptType]}
        writingLabel="Writing code"
        onSubmit={submit}
      />
    </Flex>
  );
};

export default LlmCodePanel;
