import { FC, useMemo } from 'react';
import { Alert, Card, Skeleton, Space } from 'antd';
import type {
  ProfileUiJson,
  ProfileUiSection,
} from '../../../../../common/profileUiSchema';
import GkitsCard from './GkitsCard';
import IdentityCard from './IdentityCard';
import KpiStrip from './KpiStrip';
import RanksCard from './RanksCard';
import StatsCard from './StatsCard';
import UserListCard from './UserListCard';
import './accountProfile.css';

interface AccountProfileViewProps {
  json: ProfileUiJson | null;
  loading: boolean;
  error?: string | null;
  onSelectUser?: (username: string) => void;
}

const renderSection = (
  section: ProfileUiSection,
  player: ProfileUiJson['player'],
  onSelectUser?: (username: string) => void,
) => {
  if (section.visible === false) return null;

  switch (section.type) {
    case 'identity':
      return <IdentityCard player={player} data={section.data} />;
    case 'kpiStrip':
      return <KpiStrip data={section.data} />;
    case 'ranks':
      return <RanksCard data={section.data} />;
    case 'stats':
      return <StatsCard data={section.data} />;
    case 'userList':
      return <UserListCard data={section.data} onSelectUser={onSelectUser} />;
    case 'gkits':
      return <GkitsCard data={section.data} />;
  }
};

const ProfileSkeleton: FC = () => (
  <div className="account-profile">
    <div className="account-profile-columns">
      {[0, 1].map((column) => (
        <Card key={column} variant="borderless">
          <Skeleton active avatar paragraph={{ rows: 6 }} />
        </Card>
      ))}
    </div>
  </div>
);

const AccountProfileView: FC<AccountProfileViewProps> = ({
  json,
  loading,
  error,
  onSelectUser,
}) => {
  const columns = useMemo(() => {
    const result: [ProfileUiSection[], ProfileUiSection[]] = [[], []];
    json?.sections.forEach((section) => {
      result[section.column === 'right' ? 1 : 0].push(section);
    });
    return result;
  }, [json]);

  if (loading && !json) return <ProfileSkeleton />;
  if (!json) {
    return (
      <div className="account-profile">
        <Alert
          type="error"
          showIcon
          title="Failed to load profile"
          description={error ?? 'Unknown error'}
        />
      </div>
    );
  }

  return (
    <div className="account-profile">
      <div className="account-profile-columns">
        {columns.map((sections, column) => (
          <Space
            key={column}
            orientation="vertical"
            size={12}
            style={{ width: '100%', minWidth: 0 }}
          >
            {sections.map((section) => (
              <div key={section.id}>
                {renderSection(section, json.player, onSelectUser)}
              </div>
            ))}
          </Space>
        ))}
      </div>
    </div>
  );
};

export default AccountProfileView;
