import { useEffect, useMemo, useState } from 'react';
import RecordingDetailPage from '../components/proxy/recording/RecordingDetailPage';
import { useNavigate, useParams } from 'react-router-dom';
import { useSettingsStore, selectRecordings } from '../redux/settings';
import { Layout, Button, Typography, Space } from 'antd';
import {
  ClockCircleOutlined,
  InfoCircleOutlined,
  LeftOutlined,
  SendOutlined,
} from '@ant-design/icons';
import type {
  RecordingHeader,
  RecordingPacket,
} from '../../common/types/proxyApi';

const { Title, Text } = Typography;
const { Header } = Layout;

function parseContent(content: string): RecordingPacket[] {
  const lines = content.split('\n');
  const parsed: RecordingPacket[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj.n === 'string') {
        parsed.push(obj);
      }
    } catch {}
  }

  return parsed;
}

const Recording = () => {
  const [recording, setRecording] = useState<RecordingPacket[] | null>(null);
  const { id } = useParams();
  const navigate = useNavigate();
  const recordings = useSettingsStore(selectRecordings) || [];
  const recordingInfo = recordings.find((r: RecordingHeader) => r.id === id);

  const packetTypes = useMemo(
    () => (recording ? Array.from(new Set(recording.map((p) => p.n))) : []),
    [recording],
  );

  useEffect(() => {
    if (!id) {
      return navigate(-1);
    }

    window.ipcRenderer
      .get<string | null>('GET_RECORDING_DATA', id)
      .then((data) => {
        if (!data) {
          console.log('Recording not found');
          return navigate(-1);
        }
        setRecording(parseContent(data));
      });
  }, [id]);

  const formatTime = useMemo(
    () => (ms: number) => {
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      const milliseconds = ms % 1000;
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    },
    [],
  );

  if (recording === null) {
    return null;
  }

  return (
    <Layout
      style={{
        height: 'calc(100vh - 100px)',
        background: 'transparent',
        overflow: 'hidden',
      }}
    >
      <Header
        style={{
          background: 'transparent',
          padding: '16px',
          height: 'auto',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <Space orientation="vertical" size={4}>
          <Title level={4} style={{ margin: 0 }}>
            {recordingInfo.name ?? 'Packet debug capture'}
          </Title>
          <Space size={16}>
            <Text type="secondary">
              <ClockCircleOutlined /> Duration:{' '}
              {formatTime(recording[recording.length - 1]?.dt || 0)}
            </Text>
            <Text type="secondary">
              <SendOutlined /> Packets: {recording.length}
            </Text>
            <Text type="secondary">
              <InfoCircleOutlined /> Packet types: {packetTypes.length}
            </Text>
          </Space>
        </Space>
        <Space>
          <Button icon={<LeftOutlined />} onClick={() => navigate(-1)}>
            Back
          </Button>
        </Space>
      </Header>

      <RecordingDetailPage packets={recording} />
    </Layout>
  );
};

export default Recording;
