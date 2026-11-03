import { useState, useMemo, FC } from 'react';
import {
  Card,
  Typography,
  Space,
  Select,
  Input,
  Collapse,
  Segmented,
} from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { PacketTimeline } from './PacketTimeline';
import { VirtualizedList } from './PacketList';
import type { RecordingPacket } from '../../../../common/types/proxyApi';

const { Text } = Typography;
const { Panel } = Collapse;

const RecordingDetailPage: FC<{ packets: RecordingPacket[] }> = ({
  packets,
}) => {
  const [currentTime, setCurrentTime] = useState(0);
  const [filterType, setFilterType] = useState<string[]>([]);
  const [directionFilter, setDirectionFilter] = useState<'all' | 's2c' | 'c2s'>(
    'all',
  );
  const [searchQuery, setSearchQuery] = useState('');

  // Older debug files may omit direction; treat those entries as client traffic.
  const hasDirections = useMemo(
    () => packets.some((p) => p.d === 's2c'),
    [packets],
  );
  const [expandedPacket, setExpandedPacket] = useState<RecordingPacket | null>(
    null,
  );

  // Get unique packet types
  const packetTypes = useMemo(
    () =>
      Array.from(
        new Set(
          packets
            .map((p) => p?.n)
            .filter((n): n is string => typeof n === 'string' && n.length > 0),
        ),
      ),
    [packets],
  );

  // Filter packets based on type and search
  const filteredPackets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return packets.filter((packet) => {
      if (!packet) return false;
      const matchesType =
        filterType.length === 0 ||
        (typeof packet.n === 'string' && filterType.includes(packet.n));
      const matchesDirection =
        directionFilter === 'all' || (packet.d ?? 'c2s') === directionFilter;
      const matchesSearch =
        query === '' ||
        (typeof packet.n === 'string' &&
          packet.n.toLowerCase().includes(query)) ||
        (packet.p !== undefined &&
          JSON.stringify(packet.p)?.toLowerCase().includes(query));
      return Boolean(matchesType && matchesDirection && matchesSearch);
    });
  }, [packets, filterType, directionFilter, searchQuery]);

  // Find the packet that corresponds to a given playback time (first match wins
  // so groups of packets sharing the same timestamp resolve deterministically).
  const findPacketAtTime = useMemo(
    () => (time: number) => {
      let match: RecordingPacket | null = null;
      for (let i = 0; i < filteredPackets.length; i++) {
        if (filteredPackets[i].dt <= time) match = filteredPackets[i];
        else break;
      }
      return match;
    },
    [filteredPackets],
  );

  // Scrubbing the timeline drives packet selection by time.
  const onTimeChange = useMemo(
    () => (time: number) => {
      setCurrentTime(time);
      setExpandedPacket(findPacketAtTime(time));
    },
    [findPacketAtTime],
  );

  // Format time (ms to MM:SS.mmm)
  const formatTime = useMemo(
    () => (ms: number) => {
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      const milliseconds = ms % 1000;
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    },
    [],
  );

  const onPacketSelect = useMemo(
    () => (packet: RecordingPacket) => {
      setExpandedPacket(packet);
      setCurrentTime(packet.dt);
    },
    [],
  );

  return (
    <>
      <Card variant="borderless">
        <Space style={{ marginBottom: 16, width: '100%' }} size={[16, 8]} wrap>
          {hasDirections && (
            <Segmented
              value={directionFilter}
              onChange={(v) => setDirectionFilter(v as typeof directionFilter)}
              options={[
                { label: 'All', value: 'all' },
                { label: 'Server → Client', value: 's2c' },
                { label: 'Client → Server', value: 'c2s' },
              ]}
            />
          )}
          <Select
            mode="multiple"
            placeholder="Filter packet types"
            style={{ width: 300 }}
            value={filterType}
            onChange={setFilterType}
            maxTagCount={3}
            options={packetTypes.map((type) => ({
              label: type,
              value: type,
            }))}
          />
          <Input
            placeholder="Search packets..."
            prefix={<SearchOutlined />}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: 200 }}
          />
          <Text type="secondary">
            Showing {filteredPackets.length} of {packets.length} packets
          </Text>
        </Space>

        <div style={{ display: 'flex' }}>
          <div style={{ flex: 1, marginRight: 16 }}>
            <PacketTimeline
              packets={filteredPackets}
              currentTime={currentTime}
              onTimeChange={onTimeChange}
            />
            <VirtualizedList
              items={filteredPackets}
              selectedPacket={expandedPacket}
              onPacketSelect={onPacketSelect}
            />
          </div>

          {expandedPacket && (
            <Card
              style={{ width: 300, overflow: 'hidden' }}
              title="Packet Details"
            >
              <Space orientation="vertical" size={8}>
                <div>
                  <Text strong>Type:</Text> {expandedPacket.n}
                </div>
                <div>
                  <Text strong>Time:</Text> {formatTime(expandedPacket.dt)}
                </div>
                <Collapse ghost>
                  <Panel header="Packet Content" key="content">
                    <pre
                      style={{
                        maxHeight: 300,
                        overflow: 'auto',
                        fontSize: '12px',
                      }}
                    >
                      {JSON.stringify(expandedPacket.p, null, 2)}
                    </pre>
                  </Panel>
                  <Panel header="Metadata" key="metadata">
                    <pre
                      style={{
                        maxHeight: 300,
                        overflow: 'auto',
                        fontSize: '12px',
                      }}
                    >
                      {JSON.stringify(expandedPacket.m, null, 2)}
                    </pre>
                  </Panel>
                </Collapse>
              </Space>
            </Card>
          )}
        </div>
      </Card>
    </>
  );
};

export default RecordingDetailPage;
