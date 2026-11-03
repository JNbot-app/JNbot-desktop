import { FC } from 'react';
import { Avatar, Card, List, theme, Typography } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import type { UserListSectionData } from '../../../../../common/profileUiSchema';

interface Props {
  data: UserListSectionData;
  onSelectUser?: (username: string) => void;
}

const UserListCard: FC<Props> = ({ data, onSelectUser }) => {
  const { token } = theme.useToken();
  return (
    <Card
      variant="borderless"
      style={{ background: token.colorBgContainer }}
      styles={{
        body: { padding: token.paddingLG, paddingTop: token.paddingSM },
      }}
      title={
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <TeamOutlined />
          {data.title ?? 'Players'}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {data.items.length}
          </Typography.Text>
        </span>
      }
    >
      <List
        dataSource={data.items}
        locale={{ emptyText: 'No players' }}
        split={false}
        renderItem={(u) => {
          const clickable = !!onSelectUser;
          const onClick = clickable
            ? () => onSelectUser!(u.username)
            : undefined;
          const cursor = clickable ? 'pointer' : 'default';
          return (
            <List.Item
              key={u.username}
              style={{ padding: '6px 0' }}
              actions={
                u.extra
                  ? [
                      <Typography.Text
                        key="extra"
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        {u.extra}
                      </Typography.Text>,
                    ]
                  : undefined
              }
            >
              <List.Item.Meta
                avatar={
                  <div style={{ position: 'relative' }}>
                    <Avatar
                      shape="square"
                      src={`https://mc-heads.net/avatar/${u.username}`}
                      style={{ cursor, borderRadius: 8 }}
                      onClick={onClick}
                    />
                    {u.online && (
                      <span
                        style={{
                          position: 'absolute',
                          right: -2,
                          bottom: -2,
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: token.colorSuccess,
                          border: `2px solid ${token.colorBgContainer}`,
                        }}
                      />
                    )}
                  </div>
                }
                title={
                  <span style={{ cursor, fontWeight: 500 }} onClick={onClick}>
                    {u.username}
                  </span>
                }
              />
            </List.Item>
          );
        }}
        style={{ maxHeight: 360, overflow: 'auto' }}
      />
    </Card>
  );
};

export default UserListCard;
