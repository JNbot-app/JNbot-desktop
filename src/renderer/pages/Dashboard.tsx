import React from 'react';
import {
  Divider,
  Row,
  Col,
  Typography,
  theme,
} from 'antd';
import ContainerBreakpoint from '../components/general/ContainerBreakpoint';
import AccountWorth from '../components/dashboard/AccountWorth';
import NextGkit from '../components/dashboard/NextGkit';
import TotalOnlineBots from '../components/dashboard/TotalOnlineBots';
import ScriptUsed from '../components/dashboard/ScriptUsed';
import NextCooldown from '../components/dashboard/NextCooldown';
import PlayTime from '../components/dashboard/PlayTime';
import GkitTimeline from '../components/dashboard/GkitTimeline';
import ActiveBots from '../components/dashboard/ActiveBots';
import DisplayGkits from '../components/dashboard/DisplayGkits';
import ActiveScripts from '../components/dashboard/ActiveScripts';
import PlayerStats from '../components/dashboard/PlayerStats';
import DashboardScripts from '../components/dashboard/profileScripts/DashboardScripts';
import Chains from '../components/dashboard/scriptChain/Chains';
import PlayMcCard from '../components/mcLauncher/PlayMcCard';
// import McLauncher from '../components/dashboard/McLauncher';

const Dashboard: React.FC = () => {
  const { token } = theme.useToken();
  return (
    <ContainerBreakpoint>
        {(bp) => {
          const statSpan = bp === 'sm' ? 12 : bp === 'md' ? 8 : 4;
          const halfSpan = bp === 'sm' ? 24 : 12;
          const activeBotsSpan = bp === 'sm' ? 24 : 11;
          const activeScriptsSpan = bp === 'sm' ? 24 : 13;

          return (
            <>
              <Row gutter={[16, 16]}>
                <Col span={statSpan}>
                  <AccountWorth />
                </Col>
                <Col span={statSpan}>
                  <ScriptUsed />
                </Col>
                <Col span={statSpan}>
                  <TotalOnlineBots />
                </Col>
                <Col span={statSpan}>
                  <NextGkit />
                </Col>
                <Col span={statSpan}>
                  <NextCooldown />
                </Col>
                <Col span={statSpan}>
                  <PlayTime />
                </Col>
              </Row>


              <DashboardScripts />
              <Divider style={{ marginBottom: '2rem' }} />
              <Row gutter={[16, 16]}>
                <Col span={activeBotsSpan}>
                  <ActiveBots />
                </Col>
                <Col span={activeScriptsSpan}>
                  <ActiveScripts />
                </Col>
              </Row>

              <Typography.Title level={2} style={{ fontWeight: 600, fontSize: '1.7em', paddingTop: '1rem', color: token.colorPrimaryText }}>
                Kits
              </Typography.Title>
              <Divider style={{ marginBottom: '2rem', marginTop: 0 }} />
              <Row gutter={[16, 16]}>
                <Col span={halfSpan}>
                  <GkitTimeline />
                </Col>
                <Col span={halfSpan}>
                  <DisplayGkits />
                </Col>
              </Row>
              <Typography.Title level={2} style={{ fontWeight: 600, fontSize: '1.7em', paddingTop: '1rem', color: token.colorPrimaryText }}>
                Script chaining
              </Typography.Title>
              <Divider style={{ marginBottom: '2rem', marginTop: 0 }} />
              <Chains />
              <Typography.Title level={2} style={{ fontWeight: 600, fontSize: '1.7em', paddingTop: '1rem', color: token.colorPrimaryText }}>
                Other
              </Typography.Title>
              <Divider style={{ marginBottom: '2rem', marginTop: 0 }} />
              <Row gutter={[16, 16]}>
                <Col span={halfSpan}>
                  <PlayMcCard />
                </Col>
                <Col span={halfSpan}>
                  <PlayerStats />
                </Col>
              </Row>
            </>
          );
        }}
    </ContainerBreakpoint>
  );
};

export default Dashboard;
