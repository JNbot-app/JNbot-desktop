import { FC, useMemo } from 'react';
import { List } from 'antd';
import type { AppSettings } from '../../../../main/src/types';
import SettingListItem from '../../settings/SettingListItem';
import { getProfileSettingDescriptors } from '../../settings/settingsSchema';
import SectionHeader from '../SectionHeader';


interface Props {
  /** The profile's current default values (`data.appSettingsDefaults`). */
  value: Partial<AppSettings> | undefined;
  onChange: (next: Partial<AppSettings>) => void;
}

/**
 * Wizard step where the profile creator chooses the default values for the
 * settings that are stored per profile (see
 * `src/common/appSettingsSchema.ts`). Reuses the exact same controls as the
 * Settings page via the shared schema, so the two never drift. The chosen
 * values are stored on `data.appSettingsDefaults`; users of the profile start
 * from these and can still override them per profile.
 */
const StepDefaultSettings: FC<Props> = ({ value, onChange }) => {
  const descriptors = useMemo(() => getProfileSettingDescriptors(), []);
  const defaults = value ?? {};

  const changeSetting = ({ key, value: v }: { key: string; value: any }) =>
    onChange({ ...defaults, [key]: v });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <SectionHeader title="Default settings">
          Starting settings for this server. They can still be changed later.
        </SectionHeader>
      </div>

      <List
        dataSource={descriptors}
        renderItem={(setting) => (
          <List.Item key={setting.key}>
            <SettingListItem
              changeSetting={changeSetting}
              value={defaults[setting.key]}
              setting={setting}
            />
          </List.Item>
        )}
      />
    </div>
  );
};

export default StepDefaultSettings;
