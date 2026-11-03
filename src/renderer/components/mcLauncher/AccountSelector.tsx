import React from 'react';
import { Select, Avatar, Typography, Space } from 'antd';
import { UserOutlined } from '@ant-design/icons';

interface AccountSelectorProps {
  accounts: Array<{ username: string; premium: boolean; avatarUrl?: string }>;
  selectedAccount: string | null;
  onSelect: (username: string) => void;
}

const AccountSelector: React.FC<AccountSelectorProps> = ({
  accounts,
  selectedAccount,
  onSelect,
}) => {
  return (
    <div>
      <Typography.Text strong style={{ display: 'block', marginBottom: 8, fontSize: 14 }}>
        Select Account
      </Typography.Text>
      <Select
        value={selectedAccount}
        onChange={onSelect}
        style={{ width: '100%' }}
        size="large"
        placeholder="Choose an account"
        optionLabelProp="label"
      >
        {accounts.map((account) => (
          <Select.Option key={account.username} value={account.username} label={account.username}>
            <Space>
              <Avatar
                size="small"
                shape='square'
                src={account.avatarUrl ?? `https://mc-heads.net/avatar/${account.username}/32`}
                icon={<UserOutlined />}
              />
              <Typography.Text>{account.username}</Typography.Text>
              {account.premium && (
                <Typography.Text type="success" style={{ fontSize: 12 }}>
                  Premium
                </Typography.Text>
              )}
            </Space>
          </Select.Option>
        ))}
      </Select>
    </div>
  );
};

export default AccountSelector;
