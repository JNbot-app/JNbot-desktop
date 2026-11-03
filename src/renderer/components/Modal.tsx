import React, {  ReactNode } from 'react';
import {
  Modal as AntModal,
  Button,
  Typography,
} from 'antd';
import { CloseOutlined } from '@ant-design/icons';

interface ModalProps {
  open: boolean;
  toggle: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  sx?: React.CSSProperties;
  secondary?: string;
  fullscreen?: boolean;
  innerStyle?: React.CSSProperties;
  headerStyle?: React.CSSProperties;
  onClose?: () => void;
  end?: ReactNode;
}

const Modal: React.FC<ModalProps> = ({
  open,
  toggle,
  title,
  children,
  actions,
  sx,
  secondary,
  fullscreen,
  innerStyle,
  headerStyle,
  onClose,
  end,
}) => {
  const onCloseHandler = () => {
    if (typeof onClose === 'function') onClose();
    toggle();
  };

  return (
    <AntModal
      open={open}
      onCancel={onCloseHandler}
      footer={actions ? actions : null}
      centered
      width={fullscreen ? '100%' : undefined}
      styles={{ body: innerStyle }}
      style={sx}
      title={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', ...headerStyle }}>
          <Typography.Title level={fullscreen ? 2 : 4} style={{ margin: 0 }}>
            {title}
          </Typography.Title>
          {end}
          {fullscreen && (
            <Button
              type="text"
              icon={<CloseOutlined />}
              onClick={toggle}
              style={{ fontSize: '1.5em' }}
            />
          )}
        </div>
      }

    >
      {children}
      {secondary && (
        <Typography.Text type="secondary" style={{ display: 'block', marginTop: '1em' }}>
          {secondary}
        </Typography.Text>
      )}
    </AntModal>
  );
};

export default Modal;
