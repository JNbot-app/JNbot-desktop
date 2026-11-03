import { Typography, theme, Tooltip } from 'antd';

const { Text } = Typography;

interface Props {
  /** Slot index 0..(rows*9 - 1). `undefined` means no slot is selected. */
  value: number | undefined;
  onChange: (slot: number) => void;
  rows?: number;
  label?: string;
  hint?: string;
}

const InventorySlotPicker = ({
  value,
  onChange,
  rows = 6,
  label,
  hint,
}: Props) => {
  const { token } = theme.useToken();
  const total = rows * 9;

  return (
    <div>
      {label && (
        <Text strong style={{ display: 'block', marginBottom: token.marginXS }}>
          {label}
        </Text>
      )}
      {hint && (
        <Text
          type="secondary"
          style={{ display: 'block', marginBottom: token.marginXS, fontSize: 12 }}
        >
          {hint}
        </Text>
      )}
      <div
        role="grid"
        style={{
          display: 'inline-grid',
          gridTemplateColumns: 'repeat(9, 1fr)',
          gap: 3,
          padding: 6,
          background: '#8b8b8b',
          border: `2px solid #555`,
          borderRadius: 4,
        }}
      >
        {Array.from({ length: total }, (_, i) => i).map((slot) => {
          const selected = slot === value;
          return (
            <Tooltip key={slot} title={`Slot ${slot}`} mouseEnterDelay={0.3}>
              <button
                type="button"
                onClick={() => onChange(slot)}
                aria-label={`Slot ${slot}`}
                aria-pressed={selected}
                style={{
                  width: 28,
                  height: 28,
                  border: `2px solid ${selected ? token.colorPrimary : '#373737'}`,
                  background: selected ? token.colorPrimaryBg : '#8b8b8b',
                  boxShadow: selected
                    ? `inset 0 0 0 1px ${token.colorPrimary}`
                    : 'inset 1px 1px 0 #555, inset -1px -1px 0 #fff',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 10,
                  color: selected ? token.colorPrimary : 'transparent',
                  lineHeight: '24px',
                }}
              >
                {selected ? slot : ''}
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
};

export default InventorySlotPicker;
