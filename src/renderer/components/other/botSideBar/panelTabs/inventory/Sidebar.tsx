import React from 'react';
import { Button, Input, Tooltip, Typography, Space } from 'antd';
import { MdClose, MdMessage, MdMouse, MdNotInterested } from 'react-icons/md';
import useBotId from './useBotId';
import botEvents from '../../../../../utils/botEvents';


const Sidebar: React.FC = () => {
  const botId = useBotId()!


  interface ItemProps {
    icon: React.ReactNode;
    title: React.ReactNode;
    action?: () => void;
  }

  const items: ItemProps[] = [
    { icon: <MdClose size={20} style={{ color: "#777" }} />, title: 'Close window', action: () => botEvents.action(botId,'closeWindow') },
    { icon: <MdMouse size={20} style={{ color: "#777" }} />, title: 'Activate item', action: () => botEvents.action(botId,'activateItem') },
    { icon: <MdNotInterested  size={20} style={{ color: "#777" }} />, title: 'Toss item', action: () => botEvents.action(botId,'tossItems') },
    {
      icon: <MdMessage size={20} style={{ color: "#777" }} />,
      title: (
        <div>
          <Typography.Text strong style={{ color: 'white' }}>Send command</Typography.Text>
          <Input
            placeholder="your command"
            defaultValue="/"
            autoFocus

            onPressEnter={(e) => {
              if (
                e.currentTarget.value.startsWith?.('/') &&
                e.currentTarget.value.length > 1
              ) {
                botEvents.action(botId, "chatMessage", e.currentTarget.value);
                e.currentTarget.value = '/';
              }
            }}
          />
        </div>
      ),
    },
  ];

  const Item: React.FC<ItemProps> = ({ icon, title, action }) => {
    return (
      <Tooltip title={title} placement='left'>
        <Button
          type="link"
          icon={icon}
          onClick={action}
          style={{
            textAlign: 'center',
            margin: 0,
            width: '3rem',
            minWidth: 'unset',
          }}
        />
      </Tooltip>
    );
  };

  return (
    <div
      style={{
        width: '3rem',
        height: '400px',
        background: 'rgba(0,0,0,0.1)',
        marginTop: '1rem',
        position: 'relative',
        zIndex: 1,
      }}
    >
      <Space orientation='vertical' size="large">
      {items.map((item, index) => (
          <Item {...item} key={index} />
      ))}


      </Space>
    </div>
  );
};

export default Sidebar;
