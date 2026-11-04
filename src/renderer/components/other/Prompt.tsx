import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Input, Modal, Typography } from 'antd';

const { Text } = Typography;

interface PromptData {
  title?: string;
  label?: string;
  placeholder?: string;
  defaultValue?: string;
  promptID?: string;
  instanceId?: number;
  scriptId?: string;
  runtimeProfileId?: number;
  runtimeScriptId?: number;
  messageAddress?: number;
  description?: string;
}

const Prompt: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<PromptData>({});
  const openRef = useRef(open);

  const handleClickOpen = () => {
    setOpen(true);
  };

  const handleClose = useCallback((canceled = false, promptID = value.promptID) => {
    const input = document.getElementById('prompt-input') as HTMLInputElement;
    if (!input) return;

    if (value.messageAddress) {
      window.messenger.send('macro-prompt', value.messageAddress as any, {
        cancel: canceled,
        value: input.value,
        promptID,
      });
    }

    setOpen(false);
  }, [value.messageAddress, value.promptID]);

  useEffect(() => {
    const handleEvent = (data: PromptData) => {
      if (!openRef.current) {
        setValue(data);
        handleClickOpen();
      } else {
        handleClose(true, data.promptID);
      }
    };

    window.ipcRenderer.on('macro-prompt', handleEvent);

    return () => {
      window.ipcRenderer.removeAllListeners('macro-prompt');
    };
  }, [handleClose]);


  const keyHandler = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.code === 'Enter') handleClose();
  };

  return (
    <div>
      <Modal
        title={value.title}
        open={open}
        onCancel={() => handleClose(true)}
        footer={[
          <Button key="cancel" onClick={() => handleClose(true)}>
            Cancel
          </Button>,
          <Button key="done" type="primary" onClick={() => handleClose(false)}>
            Done
          </Button>,
        ]}
      >
        {value.description && (
          <div style={{ marginBottom: 12 }}>
            <Text type="secondary">{value.description}</Text>
          </div>
        )}
        <Text>{value.label}</Text>
        <Input
          autoFocus
          defaultValue={value.defaultValue ?? ''}
          id="prompt-input"
          placeholder={value.placeholder}
          onPressEnter={keyHandler}
        />
      </Modal>
    </div>
  );
};

export default Prompt;
