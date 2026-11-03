import React from 'react';
import { Card } from 'antd';
import BotListPanel, { JoinBotCard } from '../components/bot/BotListPanel';
import BotTabs from '../components/bot/BotTabs';
import { useSettingsStore, selectSelectedBot } from '../redux/settings';
import ContainerBreakpoint from '../components/general/ContainerBreakpoint';

const Bot: React.FC = () => {
  const selectedBot = useSettingsStore(selectSelectedBot);

  return (
    <ContainerBreakpoint>
      {(bp) => {
        const stacked = bp === 'sm';
        return (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: stacked ? '1fr' : '280px 1fr',
              gap: 16,
              height: stacked ? '' : 'calc(100vh - 80px)',
              minHeight: '42rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                minHeight: 0,
              }}
            >
              <Card
                className="card"
                styles={{
                  body: {
                    padding: 0,
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                  },
                }}
                style={{
                  flex: 1,
                  overflow: 'hidden',
                  padding: 0,
                  minHeight: 200,
                }}
              >
                <BotListPanel selectedBot={selectedBot} />
              </Card>
              <Card
                className="card"
                styles={{ body: { padding: 0 } }}
                style={{ overflow: 'hidden', padding: 0 }}
              >
                <JoinBotCard />
              </Card>
            </div>
            <Card
              className="card"
              styles={{
                body: {
                  padding: 0,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                },
              }}
              style={{ height: '100%', overflow: 'hidden' }}
            >
              <BotTabs selectedBot={selectedBot} />
            </Card>
          </div>
        );
      }}
    </ContainerBreakpoint>
  );
};

export default Bot;
