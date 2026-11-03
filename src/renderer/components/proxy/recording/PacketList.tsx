import React, { useMemo } from 'react';
import { Tag, Space, Typography, theme } from 'antd';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { RecordingPacket } from '../../../../common/types/proxyApi';

const { Text } = Typography;

// Server->client and client->server packets get distinct colors + labels so
// the two streams are instantly distinguishable in a debug recording.
const DIRECTION_META = {
  s2c: {
    label: 'S→C',
    tip: 'Server → Client',
  },
  c2s: {
    label: 'C→S',
    tip: 'Client → Server',
  },
} as const;

const directionMeta = (d?: 'c2s' | 's2c') => DIRECTION_META[d ?? 'c2s'];

interface VirtualizedListProps {
  items: RecordingPacket[];
  selectedPacket: RecordingPacket | null;
  onPacketSelect: (packet: RecordingPacket) => void;
}

export const VirtualizedList: React.FC<VirtualizedListProps> = ({
  items,
  selectedPacket,
  onPacketSelect,
}) => {
  const parentRef = React.useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
    overscan: 5,
  });

  const { token } = theme.useToken();

  const formatTime = useMemo(
    () => (ms: number) => {
      const minutes = Math.floor(ms / 60000);
      const seconds = Math.floor((ms % 60000) / 1000);
      const milliseconds = ms % 1000;
      return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(3, '0')}`;
    },
    [],
  );

  React.useEffect(() => {
    if (!selectedPacket) return;
    const currentPacketIndex = items.indexOf(selectedPacket);
    if (currentPacketIndex !== -1 && parentRef.current) {
      const virtualItem = rowVirtualizer
        .getVirtualItems()
        .find((item) => item.index === currentPacketIndex);
      if (
        !virtualItem ||
        virtualItem.start < parentRef.current.scrollTop - 10 ||
        virtualItem.end >
          parentRef.current.scrollTop + parentRef.current.clientHeight + 10
      ) {
        rowVirtualizer.scrollToIndex(currentPacketIndex, { align: 'center' });
      }
    }
  }, [selectedPacket, items, rowVirtualizer]);

  return (
    <div
      ref={parentRef}
      style={{
        height: 'calc(100vh - 400px)',
        overflow: 'auto',
        border: `1px solid ${token.colorBorder}`,
        borderRadius: token.borderRadius,
      }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const packet = items[virtualRow.index];
          const isCurrentPacket = packet === selectedPacket;
          const dir = directionMeta(packet.d);
          const accent =
            packet.d === 's2c' ? token.colorInfo : token.colorSuccess;

          return (
            <div
              key={virtualRow.index}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div
                style={{
                  padding: '8px 16px',
                  background: isCurrentPacket
                    ? token.colorPrimaryBgHover
                    : undefined,
                  borderBottom: `1px solid ${token.colorBorder}`,
                  borderLeft: `3px solid ${accent}`,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  height: '100%',
                }}
                onClick={() => onPacketSelect(packet)}
              >
                <Space>
                  <Tag
                    style={{ width: 44, textAlign: 'center', margin: 0 }}
                    title={dir.tip}
                  >
                    {dir.label}
                  </Tag>
                  <Tag>{packet.n}</Tag>
                  <Text type="secondary">{formatTime(packet.dt)}</Text>
                </Space>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
