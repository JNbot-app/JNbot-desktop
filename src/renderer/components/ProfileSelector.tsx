import type { SelectProps } from 'antd';
import { Select, Typography } from 'antd';
import { selectInstalledServers, useSettingsStore } from '../redux/settings';

interface ProfileSelectorProps
  extends Omit<SelectProps<string[]>, 'mode' | 'options' | 'onChange'> {
  onChange?: (next: string[]) => void;
  includeAll?: boolean;
}

function ProfileSelector({
  includeAll = false,
  onChange,
  ...props
}: ProfileSelectorProps) {
  const profiles = useSettingsStore(selectInstalledServers);

  return (
    <Select
      {...props}
      mode="multiple"
      options={[
        ...(includeAll
          ? [{ value: '*', label: 'All current and future profiles' }]
          : []),
        ...profiles.map((profile) => ({
          value: profile.id,
          label: (
            <span>
              {profile.name}{' '}
              <Typography.Text type="secondary">({profile.id})</Typography.Text>
            </span>
          ),
        })),
      ]}
      onChange={(values) => {
        onChange?.(values.includes('*') ? ['*'] : values);
      }}
    />
  );
}

export default ProfileSelector;
