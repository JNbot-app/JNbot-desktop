import React from 'react';
import { Button, Modal, Typography } from 'antd';
import {DiscordServer} from './DiscordServer';


const BugReport: React.FC<{ open: number | null; toggle: () => void }> = ({ open, toggle }) => {

  return (
    <Modal
      title={open === 1 ? 'Report bug' : 'Suggestion'}
      open={!!open}
      onCancel={toggle}
      footer={[
        <Button key="cancel" onClick={toggle}>
          Cancel
        </Button>,
      
      ]}
    >
      <Typography>
        We no longer accept bug reports or suggestions through the app. Please join our Discord server to report bugs or give suggestions.
      </Typography>
      <br/>
       <DiscordServer/>
    </Modal>
  );
};

export default BugReport;
