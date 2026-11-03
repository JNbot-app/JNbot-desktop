import { useEffect } from 'react';
import { Select } from 'antd';
import { selectCustomProfiles, useSettingsStore } from '../../redux/settings';
import { loadMarket, useMarket } from '../../redux/shares';

/** Official servers: installed official profiles plus the ones on the marketplace. */
export function useOfficialServers(): Array<{ value: string; label: string }> {
  const profiles = useSettingsStore(selectCustomProfiles);
  const entries = useMarket((state) => state.entries);
  useEffect(() => {
    void loadMarket();
  }, []);
  const servers = new Map<string, string>();
  for (const profile of profiles) {
    if (profile.share?.official) servers.set(profile.id, profile.data.name);
  }
  for (const entry of entries ?? []) {
    if (entry.kind === 'profile' && entry.publisher.official && entry.listing.serverId) {
      servers.set(entry.listing.serverId, entry.listing.title);
    }
  }
  return [...servers].map(([value, label]) => ({ value, label }));
}

/** Pick which official servers a share is meant for; empty means all profiles. */
const ServerTargetSelect: React.FC<{
  value: string[];
  onChange: (servers: string[]) => void;
  disabled?: boolean;
}> = ({ value, onChange, disabled }) => {
  const options = useOfficialServers();
  return (
    <Select
      mode="multiple"
      allowClear
      disabled={disabled}
      value={value}
      onChange={onChange}
      options={options}
      placeholder="All profiles"
      style={{ width: '100%' }}
      maxTagCount="responsive"
    />
  );
};

export default ServerTargetSelect;
