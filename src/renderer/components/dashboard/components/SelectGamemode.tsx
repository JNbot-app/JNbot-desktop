import React from 'react';
import { Select } from 'antd';
import {
  useSettingsStore,
  selectJNDataByServer,
  selectSettings,
  updateScriptSettings,
} from '../../../redux/settings';

interface SelectGamemodeProps {
  scriptName: string;
  gamemodes?: string[];
}

const SelectGamemode: React.FC<SelectGamemodeProps> = ({
  scriptName,
  gamemodes,
}) => {
  const settings = useSettingsStore(selectSettings);
  const JNdata = useSettingsStore(selectJNDataByServer);

  const handleChange = (value: string) => {
    updateScriptSettings({
      optionId: 'gamemode',
      value,
      scriptName: scriptName,
    });
  };

  const availableGamemodes = gamemodes || JNdata.data.gamemodes;

  return (
    <Select
      className={`${scriptName}-gamemode`}
      style={{ width: 300 }}
      value={settings.scripts?.gamemode}
      onChange={handleChange}
      placeholder="Gamemode"
    >
      {availableGamemodes.map((gm, i) => (
        <Select.Option key={i} value={gm}>
          {gm}
        </Select.Option>
      ))}
    </Select>
  );
};

export default SelectGamemode;
