import React from 'react';
import { theme } from 'antd';
import ProfilesTab from '../components/settings/ProfilesTab';

const Profiles: React.FC = () => {
  const { token } = theme.useToken();
  return (
    <div style={{ padding: token.paddingLG }}>
      <ProfilesTab />
    </div>
  );
};

export default Profiles;
