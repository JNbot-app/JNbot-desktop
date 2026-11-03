import React, { useEffect, useState } from 'react';
import { Button, Modal, Typography } from 'antd';
import { BaseButtonProps } from 'antd/es/button/Button';

interface Action {
  type: BaseButtonProps["type"];
  danger?: boolean;
  label: string;
}

interface DialogData {
  title: string;
  body: string;
  buttons: Action[];
  id: string;
  script?: string;
  instanceId: number;
  messageAddress?: number;
}

const DialogAPI: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DialogData>({} as any);

  useEffect(() => {
    const r = window.ipcRenderer.on('DIALOG', (s: any) => {
      setOpen(true);
      setData(s);
    });

    return () => {
      r();
    };
  }, []);

  const response = (label: string | null) => {
    if (data.script && data.messageAddress) {
      window.messenger.send('DIALOG', data.messageAddress as any, {
        id: data.id,
        response: label,
      });
    } else {
      window.ipcRenderer.send('DIALOG', {
        id: data.id,
        response: label,
      });
    }
    setOpen(false);
  };

  return (
    <Modal
      open={open}
      title={data.title}
      onCancel={() => response(null)}
      footer={data.buttons?.map((action: Action, i: number) => (
        <Button
          key={i}
          type={action.type}
          onClick={() => response(action.label)}
          danger={action.danger}
        >
          {action.label}
        </Button>
      ))}
    >
      <Typography>{data.body}</Typography>
    </Modal>
  );
};

export default DialogAPI;
