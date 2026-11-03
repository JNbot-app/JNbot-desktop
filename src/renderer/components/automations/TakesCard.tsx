import {
  Button,
  Card,
  Dropdown,
  Empty,
  Flex,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from 'antd';
import {
  DeleteOutlined,
  MoreOutlined,
  PlayCircleOutlined,
} from '@ant-design/icons';
import {
  RECORDING_BRAIN_STEP_MS,
  type BrainExample,
} from '../../../common/brainSpec';
import useAppApi from '../../hooks/useAppApi';
import { clock } from './automationUtils';

const { Text } = Typography;

interface TakesCardProps {
  takes: BrainExample[];
  /** the take whose steps replay */
  replayTake?: string;
  onUse: (file: string) => void;
  onDelete: (file: string) => void;
}

/** Every recorded take: all teach the AI, one of them is what replays exactly. */
export default function TakesCard({
  takes,
  replayTake,
  onUse,
  onDelete,
}: TakesCardProps) {
  const { token } = theme.useToken();
  const { modal } = useAppApi();
  const number = new Map(takes.map((take, index) => [take.file, index + 1]));

  const confirmDelete = (take: BrainExample) =>
    modal.confirm({
      title: `Delete take ${number.get(take.file)}?`,
      content: 'The AI stops learning from it. Replay steps are kept.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      onOk: () => onDelete(take.file),
    });

  return (
    <Card
      title="Takes"
      extra={
        <Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          Every take teaches the AI
        </Text>
      }
      styles={{ body: { padding: 0 } }}
      style={{ borderColor: token.colorBorderSecondary }}
    >
      <Table
        size="middle"
        pagination={false}
        rowKey="file"
        // newest first
        dataSource={[...takes].reverse()}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="No takes on this device yet"
            />
          ),
        }}
        columns={[
          {
            title: 'Take',
            key: 'take',
            render: (_, take: BrainExample) => (
              <Flex align="center" gap={token.marginXS} wrap>
                <Text strong>Take {number.get(take.file)}</Text>
                {take.file === replayTake && (
                  <Tag
                    color="processing"
                    bordered={false}
                    style={{ margin: 0 }}
                  >
                    Replays
                  </Tag>
                )}
                {take.partial && (
                  <Tooltip title="Recorded before blocks were fully captured, so the AI can't see e.g. how grown a crop is. Record it again for better results.">
                    <Tag color="warning" bordered={false} style={{ margin: 0 }}>
                      Old
                    </Tag>
                  </Tooltip>
                )}
              </Flex>
            ),
          },
          {
            title: 'Recorded',
            dataIndex: 'startedAt',
            responsive: ['md'],
            render: (at: number) => (
              <Text type="secondary">{new Date(at).toLocaleString()}</Text>
            ),
          },
          {
            title: 'Length',
            dataIndex: 'steps',
            render: (steps: number) => clock(steps * RECORDING_BRAIN_STEP_MS),
          },
          {
            title: 'Actions',
            dataIndex: 'actions',
            render: (actions?: number) =>
              actions === undefined ? (
                <Tooltip title="Recorded for the AI only">
                  <Text type="secondary">–</Text>
                </Tooltip>
              ) : (
                actions
              ),
          },
          {
            key: 'menu',
            width: 48,
            render: (_, take: BrainExample) => (
              <Dropdown
                trigger={['click']}
                menu={{
                  items: [
                    {
                      key: 'use',
                      icon: <PlayCircleOutlined />,
                      label: 'Use for exact replay',
                      disabled:
                        take.actions === undefined || take.file === replayTake,
                      onClick: () => onUse(take.file),
                    },
                    {
                      key: 'delete',
                      icon: <DeleteOutlined />,
                      label: 'Delete',
                      danger: true,
                      onClick: () => confirmDelete(take),
                    },
                  ],
                }}
              >
                <Button
                  type="text"
                  size="small"
                  icon={<MoreOutlined />}
                  aria-label={`Take ${number.get(take.file)} options`}
                />
              </Dropdown>
            ),
          },
        ]}
      />
    </Card>
  );
}
