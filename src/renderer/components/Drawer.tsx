import React from 'react';
import { Drawer, Button, Typography } from 'antd';
import { CloseOutlined } from '@ant-design/icons';


interface DrawerContainerProps {
  children: React.ReactNode;
  open: boolean;
  toggle: () => void;
}

const DrawerContainer: React.FC<DrawerContainerProps> = ({ children, open, toggle }) => {
  return (
    <Drawer
      placement="bottom"
      open={open}
      onClose={toggle}
      getContainer={false}
      style={{ position: 'fixed' }}
    >
      {children}
    </Drawer>
  );
};

interface DrawerProps {
  children: React.ReactNode;
  open: boolean;
  toggle: () => void;
  title?: React.ReactNode;
  end?: React.ReactNode;
  bg?: string;
}

const CustomDrawer: React.FC<DrawerProps> = ({ children, open, toggle, title, end, bg }) => {
  return (
    <DrawerContainer open={open} toggle={toggle}>
      <div style={{ padding: '1rem 4rem', background: bg ?? '' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button
            type="text"
            icon={<CloseOutlined />}
            onClick={toggle}
            style={{ position: 'absolute', left: '0.5rem', top: '0.5rem' }}
          />
          <div style={{ marginLeft: '3rem' }}>
            {typeof title === 'string' ? (
              <Typography.Title level={2} style={{ position: 'relative', top: '-1rem' }}>
                {title}
              </Typography.Title>
            ) : (
              title
            )}
          </div>
          <div style={{ position: 'sticky' }}>{end ? end : null}</div>
        </div>
        <div style={{ minHeight: '40vh' }}>{children}</div>
      </div>
    </DrawerContainer>
  );
};

export default CustomDrawer;
