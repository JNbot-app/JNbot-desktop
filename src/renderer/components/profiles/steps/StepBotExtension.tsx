import { FC } from 'react';
import ProfileActionPicker from '../scripts/ProfileActionPicker';
import SectionHeader from '../SectionHeader';
import type { ProfileScript } from '../../../../common/profileScripts';


interface Props {
  value: ProfileScript | undefined;
  onChange: (next: ProfileScript | undefined) => void;
}

/**
 * Wizard step that binds an optional bot action to the
 * profile. The plugin is loaded as the LAST bot plugin for every
 * bot instance that joins this server — see
 * `src/main/src/workers/bot/join.js`. Picker UI is shared with the
 * profile-UI step via `ProfileActionPicker`.
 */
const StepBotExtension: FC<Props> = ({ value, onChange }) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <SectionHeader title="Bot action">
          Code that runs for every bot that joins this server.
        </SectionHeader>

        <ProfileActionPicker
          scriptType="botExtension"
          value={value}
          onChange={onChange}
          candidatesTitle="Your actions and legacy bot extensions"
          createModal={{
            title: 'Create bot action',
            defaultName: 'My bot action',
            defaultDescription: 'Action run for every bot on this server.',
            helpText:
              'Creates a JS plugin pre-filled with a main function. Use Edit code afterwards to customize it.',
          }}
        />
      </div>
    </div>
  );
};

export default StepBotExtension;
