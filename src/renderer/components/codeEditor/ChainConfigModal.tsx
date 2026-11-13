import { useState, type FC } from 'react';
import { Modal } from 'antd';
import SettingsBuilder from '../general/scriptSettings/SettingsBuilder';
import type { ScriptSettingsSection } from '../general/scriptSettings/ScriptSettingsProps.d';

/**
 * Defines a chain's own options, with the same builder as a plugin's
 * configuration. Mount it only while open, so it starts from `config`.
 */
const ChainConfigModal: FC<{
  config?: ScriptSettingsSection[];
  onClose: () => void;
  onSave: (config: ScriptSettingsSection[]) => void;
}> = ({ config, onClose, onSave }) => {
  const [sections, setSections] = useState(config ?? []);
  return (
    <Modal
      title="Chain options"
      open
      onCancel={onClose}
      onOk={() => {
        onSave(sections);
        onClose();
      }}
      okText="Save changes"
      width={860}
    >
      <SettingsBuilder
        sections={sections}
        onChange={setSections}
        title=""
        description=""
      />
    </Modal>
  );
};

export default ChainConfigModal;
