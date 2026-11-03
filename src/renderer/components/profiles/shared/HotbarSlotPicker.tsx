import { Radio, Typography, theme } from 'antd';

const { Text } = Typography;

interface Props {
  /** Slot number 1-9. */
  value: number;
  onChange: (slot: number) => void;
  label?: string;
}

const HotbarSlotPicker = ({ value, onChange, label }: Props) => {
  const { token } = theme.useToken();

  return (
    <div>
      {label && (
        <Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
          {label}
        </Text>
      )}
      <Radio.Group
        buttonStyle="solid"
        style={{ display: 'flex', gap: 4, width: '100%' }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
          <Radio.Button
            key={n}
            value={n}
            style={{
              flex: 1,
              textAlign: 'center',
              fontWeight: value === n ? 'bold' : 'normal',
            }}
          >
            {n}
          </Radio.Button>
        ))}
      </Radio.Group>
    </div>
  );
};

export default HotbarSlotPicker;
