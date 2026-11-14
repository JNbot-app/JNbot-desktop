import React from 'react';
import { Flex, InputNumber } from 'antd';
import { DAY, HOUR, MINUTE } from '../../../../common/cooldowns';

/** Days/hours/minutes inputs for a duration in milliseconds. */
const DurationFields: React.FC<{ value: number; onChange: (ms: number) => void }> = ({ value, onChange }) => {
  const days = Math.floor(value / DAY);
  const hours = Math.floor((value % DAY) / HOUR);
  const minutes = Math.round((value % HOUR) / MINUTE);

  const field = (amount: number, unit: number, suffix: string, label: string, max?: number) => (
    <InputNumber
      aria-label={label}
      min={0}
      max={max}
      precision={0}
      value={amount}
      onChange={(next) => onChange(days * DAY + hours * HOUR + minutes * MINUTE + ((next ?? 0) - amount) * unit)}
      suffix={suffix}
      style={{ flex: 1 }}
    />
  );

  return (
    <Flex gap={8}>
      {field(days, DAY, 'days', 'Days')}
      {field(hours, HOUR, 'hrs', 'Hours', 23)}
      {field(minutes, MINUTE, 'min', 'Minutes', 59)}
    </Flex>
  );
};

export default DurationFields;
