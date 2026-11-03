import React, { useEffect, useState } from 'react';
import { Button, Modal, Typography } from 'antd';

interface PopupData {
  title?: string;
  body?: string;
  visible: boolean;
}

const InfoPopup: React.FC = () => {
  const [popup, setPopup] = useState<PopupData>({ visible: false });
  const closePopup = () => setPopup((x) => ({ ...x, visible: false }));

  useEffect(() => {
    window.ipcRenderer.on('popup', (data: any) => {
      if (data.close) {
        closePopup();
      } else {
        setPopup({ ...data, visible: true });
      }
    });
  }, []);

  return (
    <Modal
      open={popup.visible}
      title={popup.title}
      onCancel={closePopup}
      footer={[
        <Button key="cancel" onClick={closePopup}>
          Cancel
        </Button>,
      ]}
    >
      <Typography.Paragraph>{popup.body}</Typography.Paragraph>
    </Modal>
  );
};

export default InfoPopup;
