import { Descriptions, Flex, Tag, Timeline, Typography, theme } from 'antd';
import {
  ArrowRightOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import {
  chainSteps,
  detailValue,
  type ShareDetailSection,
  type ShareItemSummary,
  type ShareOverview,
} from '../../../common/share';
import { useOfficialServers } from './ServerTargetSelect';

const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>
    {children}
  </Typography.Text>
);

/** Quiet bordered box; rows inside are split by hairlines. */
const Box: React.FC<{ children: React.ReactNode[] | React.ReactNode }> = ({
  children,
}) => {
  const { token } = theme.useToken();
  return (
    <Flex
      vertical
      style={{
        border: `1px solid ${token.colorBorderSecondary}`,
        borderRadius: token.borderRadiusLG,
        overflow: 'hidden',
      }}
    >
      {children}
    </Flex>
  );
};

const ItemList: React.FC<{ items: ShareItemSummary[] }> = ({ items }) => {
  const { token } = theme.useToken();
  return (
    <Box>
      {items.map((item, index) => (
        <Flex
          key={index}
          vertical
          style={{
            padding: token.paddingXS,
            paddingInline: token.paddingSM,
            borderTop: index
              ? `1px solid ${token.colorBorderSecondary}`
              : undefined,
          }}
        >
          <Flex justify="space-between" gap={token.marginXS}>
            <Typography.Text ellipsis>{item.name}</Typography.Text>
            {item.type && (
              <Typography.Text
                type="secondary"
                style={{ fontSize: token.fontSizeSM, whiteSpace: 'nowrap' }}
              >
                {item.type}
              </Typography.Text>
            )}
          </Flex>
          {item.description && (
            <Typography.Paragraph
              type="secondary"
              ellipsis={{ rows: 2 }}
              style={{ margin: 0, fontSize: token.fontSizeSM }}
            >
              {item.description}
            </Typography.Paragraph>
          )}
        </Flex>
      ))}
    </Box>
  );
};

const Facts: React.FC<{
  facts: Array<[string, React.ReactNode] | false | undefined>;
}> = ({ facts }) => (
  <Descriptions
    size="small"
    column={1}
    colon={false}
    styles={{ label: { width: 110 } }}
    items={facts
      .filter((fact) => !!fact)
      .map(([label, children]) => ({ key: label, label, children }))}
  />
);

const ChainSteps: React.FC<{ details: ShareDetailSection[] }> = ({
  details,
}) => (
  <div>
    <Heading>What it runs</Heading>
    <Timeline
      style={{ marginTop: 8, marginBottom: -24 }}
      items={chainSteps(details).map((step) => ({
        children: (
          <Flex vertical>
            <Typography.Text>{step.name}</Typography.Text>
            <Typography.Text type="secondary">{step.text}</Typography.Text>
          </Flex>
        ),
      }))}
    />
  </div>
);

const TRIGGER_FIXED_ROWS = new Set(['When', 'Cooldown', 'Runs on']);

/** One trigger rule as "When … then …". */
const TriggerRule: React.FC<{ section: ShareDetailSection }> = ({
  section,
}) => {
  const { token } = theme.useToken();
  const actions = section.rows.filter((row) =>
    /^Action( \d+)?$/.test(row.label),
  );
  const filters = section.rows.filter(
    (row) => !TRIGGER_FIXED_ROWS.has(row.label) && !actions.includes(row),
  );
  const cooldown = detailValue([section], 'Cooldown');
  const pad = { padding: token.paddingSM };
  return (
    <Box>
      <Flex
        vertical
        gap={2}
        style={{ ...pad, background: token.colorFillQuaternary }}
      >
        <Typography.Text
          type="secondary"
          style={{ fontSize: token.fontSizeSM }}
        >
          <ThunderboltOutlined /> When
        </Typography.Text>
        <Typography.Text strong>
          {detailValue([section], 'When') ?? section.title}
        </Typography.Text>
        {filters.map((row) => (
          <Typography.Text
            key={row.label}
            type="secondary"
            style={{ fontSize: token.fontSizeSM }}
          >
            {row.label}: {row.value}
          </Typography.Text>
        ))}
      </Flex>
      <Flex
        vertical
        gap={4}
        style={{ ...pad, borderTop: `1px solid ${token.colorBorderSecondary}` }}
      >
        <Typography.Text
          type="secondary"
          style={{ fontSize: token.fontSizeSM }}
        >
          <ArrowRightOutlined /> Then
        </Typography.Text>
        {actions.map((row) => (
          <Typography.Text key={row.label}>{row.value}</Typography.Text>
        ))}
        {cooldown && (
          <Typography.Text
            type="secondary"
            style={{ fontSize: token.fontSizeSM }}
          >
            At most once every {cooldown}
          </Typography.Text>
        )}
      </Flex>
    </Box>
  );
};

/** What is inside a share, laid out for its kind, plus what happens after installing. */
const ShareContents: React.FC<{ overview: ShareOverview }> = ({ overview }) => {
  const { token } = theme.useToken();
  const servers = useOfficialServers();
  const { kind, details, items } = overview;
  const worksOn = overview.servers.length
    ? overview.servers
        .map((id) => servers.find((server) => server.value === id)?.label ?? id)
        .join(', ')
    : 'Every profile';
  const requires: [string, string] = [
    'Needs',
    `JNbot ${overview.minAppVersion} or newer`,
  ];

  let body: React.ReactNode;
  switch (kind) {
    case 'plugin':
      body = (
        <Facts
          facts={[
            !!items[0]?.type && ['Type', items[0].type],
            ['Works on', worksOn],
            requires,
          ]}
        />
      );
      break;
    case 'bundle':
      body = (
        <>
          <div>
            <Heading>{items.length} plugins in this bundle</Heading>
            <ItemList items={items} />
          </div>
          <Facts
            facts={[
              ['Folder', overview.title],
              ['Works on', worksOn],
              requires,
            ]}
          />
        </>
      );
      break;
    case 'profile': {
      const gamemodes = detailValue(details, 'Gamemodes')?.split(', ') ?? [];
      body = (
        <>
          <Facts
            facts={[
              [
                'Server',
                <Typography.Text key="server" copyable>
                  {detailValue(details, 'Server') ?? '—'}
                </Typography.Text>,
              ],
              !!gamemodes.length && [
                'Gamemodes',
                <Flex key="gamemodes" wrap gap={4}>
                  {gamemodes.map((mode) => (
                    <Tag key={mode} variant="filled" style={{ margin: 0 }}>
                      {mode}
                    </Tag>
                  ))}
                </Flex>,
              ],
              requires,
            ]}
          />
          {!!items.length && (
            <div>
              <Heading>{items.length} scripts included</Heading>
              <ItemList items={items} />
            </div>
          )}
        </>
      );
      break;
    }
    case 'chain':
      body = (
        <>
          <ChainSteps details={details} />
          <Facts
            facts={[
              !!detailValue(details, 'Gamemode') && [
                'Gamemode',
                detailValue(details, 'Gamemode'),
              ],
              ['Works on', worksOn],
              requires,
            ]}
          />
        </>
      );
      break;
    case 'trigger':
      body = (
        <>
          <Flex vertical gap={token.marginXS}>
            {details.map((section, index) => (
              <TriggerRule key={index} section={section} />
            ))}
          </Flex>
          <Facts facts={[['Works on', worksOn], requires]} />
        </>
      );
      break;
  }

  return (
    <Flex vertical gap={token.marginMD}>
      {body}
      {!!overview.stripped?.length && (
        <Typography.Text type="secondary">
          The publisher's own {overview.stripped.join(', ')} were removed before
          sharing.
        </Typography.Text>
      )}
    </Flex>
  );
};

export default ShareContents;
