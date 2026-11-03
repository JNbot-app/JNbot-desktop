import { Flex, Popover, Progress, Table, Tag, Typography, theme } from 'antd';
import {
  brainActionName,
  brainVerdict,
  type BrainInfo,
  type BrainTrainStatus,
} from '../../../../common/brainSpec';

const { Text } = Typography;

const VERDICT = {
  good: { label: 'Good', color: 'success' },
  okay: { label: 'Okay', color: 'warning' },
  more: { label: 'Needs more examples', color: 'error' },
} as const;

interface TeachSkillProps {
  model: BrainInfo['model'];
  training: BrainTrainStatus | null;
}

/** The AI's state: learning progress, or how well it learned with details one hover away. */
export default function TeachSkill({ model, training }: TeachSkillProps) {
  const { token } = theme.useToken();
  const verdict = model && !model.stale && brainVerdict(model.report);

  let state;
  if (training)
    state = (
      <Progress
        percent={Math.round(training.progress * 100)}
        size="small"
        style={{ margin: 0 }}
      />
    );
  else if (!verdict)
    state = (
      <Text type="secondary" style={{ fontSize: 12 }}>
        {model
          ? 'Learns your new examples when it plays next'
          : 'Learns automatically when it plays'}
      </Text>
    );
  else
    state = (
      <Popover
        placement="left"
        title="How well it learned"
        content={
          <Flex vertical gap={token.marginSM} style={{ maxWidth: 340 }}>
            {verdict.hints.map((hint) => (
              <Text key={hint}>{hint}</Text>
            ))}
            <Table
              size="small"
              pagination={false}
              rowKey="name"
              dataSource={Object.entries(model.report.heads).map(
                ([name, head]) => ({ name, accuracy: head.accuracy }),
              )}
              columns={[
                {
                  title: 'Learned to',
                  dataIndex: 'name',
                  render: brainActionName,
                },
                {
                  title: 'Right',
                  dataIndex: 'accuracy',
                  align: 'right',
                  render: (accuracy?: number) =>
                    accuracy === undefined
                      ? '–'
                      : `${Math.round(accuracy * 100)}%`,
                },
              ]}
            />
          </Flex>
        }
      >
        <Tag
          color={VERDICT[verdict.level].color}
          style={{ margin: 0, cursor: 'help', alignSelf: 'flex-start' }}
        >
          {VERDICT[verdict.level].label}
        </Tag>
      </Popover>
    );

  return (
    <Flex vertical gap={token.marginXS}>
      <Text strong style={{ fontSize: 12 }}>
        {training ? 'Learning…' : 'AI skill'}
      </Text>
      {state}
    </Flex>
  );
}
