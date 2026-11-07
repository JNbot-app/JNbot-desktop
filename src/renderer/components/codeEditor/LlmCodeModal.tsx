import type { FC, MutableRefObject } from 'react';
import { Modal, Typography } from 'antd';
import type { MacroInfo } from '../../../main/src/types';
import { savePlugin } from '../../redux/settings';
import LlmPrompt from '../llm/LlmPrompt';
import type { EditorInstance } from './CodeEditor';

interface LlmCodeModalProps {
  open: boolean;
  onClose: () => void;
  pluginInfo: MacroInfo;
  code: MutableRefObject<string>;
  editorRef: MutableRefObject<EditorInstance | null>;
  setMacroInfo: (info: MacroInfo) => void;
}

/** Let the user's AI provider write or change the open plugin. */
const LlmCodeModal: FC<LlmCodeModalProps> = ({ open, onClose, pluginInfo, code, editorRef, setMacroInfo }) => {
  const hasCode = code.current.trim().length > 80;

  const generate = async (description: string) => {
    const draft = (await window.ipcRenderer.get('LLM_WRITE_PLUGIN', {
      description: `${description}\n(This is a${pluginInfo.scriptType === 'action' ? 'n action' : ' normal plugin'}.)`,
      source: hasCode ? code.current : undefined,
    })) as { source: string; optionSchema?: MacroInfo['config'] };
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (editor && model) {
      // One undoable edit, so Ctrl+Z restores the previous code.
      editor.pushUndoStop();
      editor.executeEdits('ai', [{ range: model.getFullModelRange(), text: draft.source }]);
      editor.pushUndoStop();
    }
    if (draft.optionSchema?.length) {
      const updated = { ...pluginInfo, config: draft.optionSchema };
      savePlugin(updated);
      setMacroInfo(updated);
    }
    onClose();
  };

  return (
    <Modal open={open} onCancel={onClose} footer={null} title="Write with AI" destroyOnHidden>
      <Typography.Paragraph type="secondary">
        {hasCode
          ? 'Describe what to change. The AI edits the code in the editor; press Ctrl+Z to undo, and save when you are happy.'
          : 'Describe what the plugin should do. The AI writes the code and its options; save when you are happy.'}
      </Typography.Paragraph>
      <LlmPrompt
        placeholder={hasCode ? 'e.g. also eat when food is low' : 'e.g. mine sugar cane and sell it every 10 minutes'}
        button={hasCode ? 'Change' : 'Write'}
        onSubmit={generate}
      />
    </Modal>
  );
};

export default LlmCodeModal;
