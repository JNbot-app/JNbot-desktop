import React from 'react';
import { Input, Space, Table, Typography } from 'antd';
import type { ImportEntry } from './ImportAlts';

interface Props {
  entries: ImportEntry[];
  selectedUsernames: string[];
  onlineMode: boolean;
  onSelectionChange: (usernames: string[]) => void;
  onPasswordChange: (username: string, password: string) => void;
}

export default function SharedAltImportTable({
  entries,
  selectedUsernames,
  onlineMode,
  onSelectionChange,
  onPasswordChange,
}: Props) {
  const [search, setSearch] = React.useState('');
  const query = search.trim().toLowerCase();
  const selected = new Set(selectedUsernames);
  const filtered = entries.filter((entry) =>
    entry.username.toLowerCase().includes(query),
  );

  return (
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Input.Search
        aria-label="Search alts"
        placeholder="Search alts"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        allowClear
      />
      <Typography.Text type="secondary">
        {selectedUsernames.length} of {entries.length} selected
      </Typography.Text>
      <Table<ImportEntry>
        rowKey="username"
        size="small"
        pagination={false}
        scroll={{ y: 400 }}
        dataSource={filtered}
        locale={{
          emptyText: query
            ? 'No alts match your search.'
            : 'Every account is already part of this profile.',
        }}
        rowSelection={{
          selectedRowKeys: selectedUsernames,
          preserveSelectedRowKeys: true,
          onChange: (keys) => onSelectionChange(keys.map(String)),
          getCheckboxProps: (entry) => ({
            name: entry.username,
            'aria-label': `Import ${entry.username}`,
          }),
        }}
        columns={[
          {
            title: 'Username',
            dataIndex: 'username',
            render: (username: string) => (
              <Typography.Text strong>{username}</Typography.Text>
            ),
          },
          ...(!onlineMode
            ? [
                {
                  title: 'Server password (optional)',
                  key: 'password',
                  render: (_: unknown, entry: ImportEntry) =>
                    selected.has(entry.username) ? (
                      <Input.Password
                        aria-label={`Password for ${entry.username}`}
                        placeholder="Optional server password"
                        value={entry.password}
                        maxLength={45}
                        onChange={(event) =>
                          onPasswordChange(entry.username, event.target.value)
                        }
                      />
                    ) : (
                      <Typography.Text type="secondary">
                        Select to set a password
                      </Typography.Text>
                    ),
                },
              ]
            : []),
        ]}
      />
    </Space>
  );
}
