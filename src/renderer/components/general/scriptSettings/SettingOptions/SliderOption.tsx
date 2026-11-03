import React, { FC } from 'react';
import { Slider as AntSlider, Form, SliderSingleProps } from 'antd';
import { ScriptSettingProps, ScriptSettingsProps_Slider } from '../ScriptSettingsProps.d';

const SliderOption: FC<{
  option: ScriptSettingsProps_Slider;
  onChange?: (value: number | string | (string | string[] | number[] | number)[], option: ScriptSettingProps) => void;
  value: number;
}> = ({ option, onChange, value }) => {
  const handleChange: SliderSingleProps['onChange'] = (value) => {
    onChange?.(value, option);
  };

  return (
    <Form.Item label={option.label} name={option.id}   style={{width:"100%"}}>
      <AntSlider
        value={value}
        min={option.min}
        max={option.max}
        step={option.step}
        style={{width:"100%"}}
        onChange={handleChange}
        marks={option.marks}
        className={option.className}
      />
    </Form.Item>
  );
};

export default SliderOption;
