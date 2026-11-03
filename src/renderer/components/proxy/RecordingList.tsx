import React, { useState, useEffect, useMemo } from 'react';
import {
  Button,
  Card,
  Empty,
  Flex,
  Input,
  Popconfirm,
  Space,
  Tag,
  Typography,
  theme,
} from 'antd';
import {
  BugOutlined,
  CalendarOutlined,
  DeleteOutlined,
  EyeOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import useAppApi from '../../hooks/useAppApi';
import {
  useSettingsStore,
  selectRecordings,
  setRecordings,
} from '../../redux/settings';
import type { RecordingHeader } from '../../../common/types/proxyApi';

const { Text } = Typography;

const RecordingList: React.FC = () => {
  const { token } = theme.useToken();
  const { message } = useAppApi();
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const recordings: RecordingHeader[] | null =
    useSettingsStore(selectRecordings);

  useEffect(() => {
    if (recordings === null) {
      window.ipcRenderer.action('GET_RECORDINGS');
    }
  }, [recordings]);

  const formatDate = (timestamp: number | string | Date) => {
    try {
      const d = new Date(timestamp);
      return (
        d.toDateString() +
        ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      );
    } catch {
      return String(timestamp);
    }
  };

  const saveEditedName = (name: string, id: string) => {
    if (!recordings) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    if (trimmed.match(/[^a-zA-Z0-9_-]/)) {
      message.error(
        'Recording name can only contain letters, numbers, underscores, and hyphens',
      );
      return;
    }
    setRecordings(
      recordings.map((rec) =>
        rec.id === id ? { ...rec, name: trimmed } : rec,
      ),
    );
    window.ipcRenderer.action('UPDATE_RECORDING_NAME', { id, name: trimmed });
  };

  const viewRecording = (id: string) => {
    navigate(`/jnbotproxy/recordings/${id}`);
  };

  const deleteRecording = (id: string) => {
    if (!recordings) return;
    setRecordings(recordings.filter((rec) => rec.id !== id));
    window.ipcRenderer.action('DELETE_RECORDING', id);
    message.success('Recording deleted');
  };

  const filtered = useMemo(() => {
    if (!recordings) return [];
    const q = search.trim().toLowerCase();
    const debugCaptures = recordings
      .filter((recording) => recording.kind === 'debug')
      .sort((a, b) => b.timestamp - a.timestamp);
    if (!q) return debugCaptures;
    return debugCaptures.filter((r) => r.name.toLowerCase().includes(q));
  }, [recordings, search]);

  return (
    <Card
      title={
        <Flex
          align="center"
          justify="space-between"
          wrap="wrap"
          gap={token.marginSM}
        >
          <Flex align="center" gap={8}>
            <BugOutlined />
            <span>Packet Debug Captures</span>
            <Tag>{filtered.length}</Tag>
          </Flex>
          <Input
            placeholder="Search debug captures…"
            prefix={
              <SearchOutlined style={{ color: token.colorTextTertiary }} />
            }
            allowClear
            size="small"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 180 }}
          />
        </Flex>
      }
      style={{
        borderColor: token.colorBorderSecondary,
        background: token.colorBgContainer,
      }}
    >
      {filtered.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            recordings && recordings.length > 0
              ? 'No matching debug captures found'
              : 'No packet debug captures saved yet'
          }
        />
      ) : (
        <Flex vertical gap={token.marginSM}>
          {filtered.map((recording) => (
            <div
              key={recording.id}
              style={{
                padding: `${token.paddingSM}px ${token.paddingMD}px`,
                borderRadius: token.borderRadiusSM,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorFillQuaternary,
                transition: 'all 0.15s ease',
              }}
            >
              <Flex
                align="center"
                justify="space-between"
                wrap="wrap"
                gap={token.marginSM}
              >
                <Flex vertical gap={2} style={{ minWidth: 0, flex: 1 }}>
                  <Flex align="center" gap={token.marginXS} wrap="wrap">
                    <Text
                      strong
                      editable={{
                        maxLength: 32,
                        onChange: (val) => saveEditedName(val, recording.id),
                      }}
                      style={{ fontSize: 14 }}
                    >
                      {recording.name}
                    </Text>
                  </Flex>

                  <Flex align="center" gap={token.marginMD} wrap="wrap">
                    <Flex align="center" gap={token.marginXXS}>
                      <CalendarOutlined
                        style={{ fontSize: 12, color: token.colorTextTertiary }}
                      />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {formatDate(recording.timestamp)}
                      </Text>
                    </Flex>
                  </Flex>
                </Flex>

                <Space size="small">
                  <Button
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => viewRecording(recording.id)}
                  >
                    View
                  </Button>

                  <Popconfirm
                    title="Delete debug capture?"
                    description="This debug capture will be permanently deleted."
                    onConfirm={() => deleteRecording(recording.id)}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                  >
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                    />
                  </Popconfirm>
                </Space>
              </Flex>
            </div>
          ))}
        </Flex>
      )}
    </Card>
  );
};

export default RecordingList;
