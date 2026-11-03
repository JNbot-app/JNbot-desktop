import React from 'react';
import {
  useSettingsStore,
  selectSettings,
  updateScriptSettings,
} from '../../../redux/settings';
import { Slider } from 'antd';
import PropTypes from 'prop-types';

const marks = {
  1: '1 bot',
  2: '2 bots',
  3: '3 bots',
  4: '4 bots',
};

interface BotSliderProps {
  scriptName: string;
  name: string;
}

const BotSlider: React.FC<BotSliderProps> = ({ scriptName, name }) => {
  const settings = useSettingsStore(selectSettings);

  const handleChange = (value: number) => {
    if (settings.scripts?.[scriptName]?.[name] !== value) {
      updateScriptSettings({ optionId: name, value, scriptName: scriptName });
    }
  };

  return (
    <div style={{ width: '250px' }}>
      <Slider
        value={settings.scripts?.[scriptName]?.[name]}
        onChange={handleChange}
        step={1}
        marks={marks}
        max={4}
        min={1}
      />
    </div>
  );
};

BotSlider.propTypes = {
  scriptName: PropTypes.string.isRequired,
  name: PropTypes.string.isRequired,
};

export default BotSlider;
