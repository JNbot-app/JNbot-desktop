import React, { useState, useEffect } from 'react';
import { Button, Modal, Typography, Space, Card } from 'antd';
import { useSettingsStore, selectTutorial } from '../../redux/settings';
import { CSSProperties } from 'react';
import AddAltsTour from './appTours/AddAltsTour';

export enum Tutorials {
  CREATE_ALT,
}

const TUTORIALS = [
  {
    id: Tutorials.CREATE_ALT,
    title: 'Add your alts to JNbot',
    steps: 4,
    description: 'Learn how to add your Minecraft accounts to get started',
  },
];



const tutorialCardStyle: CSSProperties = {
  borderRadius: '12px',
  marginBottom: '12px',
  padding: '16px',
  cursor: 'pointer',
  transition: 'all 0.3s ease',
};

const AppTutorial: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [activeTutorial, setActiveTutorial] = useState<Tutorials | null>(null);
  const currTutorial = useSettingsStore(selectTutorial) as any;
  useEffect(
    () => window.ipcRenderer.on('START_TUTORIAL', () => setOpen(true)),
    [],
  );

  const close = () => {
    setOpen(false);
  };

  const stopTutorial = () => {
    setActiveTutorial(null);
  };

  const start = (id: Tutorials) => {
    //    startTutorial(id);
    setActiveTutorial(id);
    close();
  };

  return (
    <>
      <Modal
        title="Quick Start"
        open={open}
        onCancel={close}
        width={720}
        centered
        footer={
          <div style={{ textAlign: 'center' }}>
            <Button
              type="default"
              onClick={close}
              size="large"
              style={{ minWidth: '120px' }}
            >
              Close
            </Button>
          </div>
        }
        styles={{
          container: {
            borderRadius: '16px',
          },
        }}
      >
        <div style={{ padding: '16px 0' }}>
          <Space orientation="vertical" style={{ width: '100%' }}>
            {TUTORIALS.map((tutorial) => (
              <Card
                key={tutorial.id}
                style={tutorialCardStyle}
                hoverable
                onClick={() => start(tutorial.id)}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <Typography.Title level={4} style={{ margin: 0 }}>
                      {`${tutorial.id + 1}. ${tutorial.title}`}
                    </Typography.Title>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: '14px' }}
                    >
                      {tutorial.description}
                    </Typography.Text>
                  </div>
                  <Button
                    type={
                      (currTutorial?.tutorial ?? 0) === tutorial.id
                        ? 'primary'
                        : 'default'
                    }
                    size="large"
                    style={{ minWidth: '100px' }}
                  >
                    Start
                  </Button>
                </div>
              </Card>
            ))}
          </Space>

          <div
            style={{
              textAlign: 'center',
              marginTop: '24px',
              padding: '16px',
              borderRadius: '8px',
            }}
          >
            <Typography.Text type="secondary">
              💡 Need help? Contact <strong>usserwout</strong> on Discord
            </Typography.Text>
          </div>
        </div>
      </Modal>
      <AddAltsTour
        active={activeTutorial === Tutorials.CREATE_ALT}
        setActive={stopTutorial}
      />
    </>
  );
};

export default AppTutorial;
