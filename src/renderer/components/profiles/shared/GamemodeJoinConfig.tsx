import { Input, Radio, Select, Typography, theme } from 'antd';
import {
  DEFAULT_COMMAND_TEMPLATE,
  GAMEMODE_PLACEHOLDER,
  JOIN_KIND_DESCRIPTIONS,
  JOIN_KIND_LABELS,
  type GamemodeJoinBehaviour,
  type JoinBehaviourKind,
  makeDefaultBehaviour,
} from '../../../../common/joinBehaviour';
import HotbarSlotPicker from './HotbarSlotPicker';
import InventorySlotPicker from './InventorySlotPicker';
import ProfileActionPicker from '../scripts/ProfileActionPicker';

const { Text } = Typography;

interface Props {
  /** The gamemode this config belongs to (used in placeholder previews). */
  gamemode: string;
  value: GamemodeJoinBehaviour;
  onChange: (next: GamemodeJoinBehaviour) => void;
}

const KIND_OPTIONS: { value: JoinBehaviourKind; label: string }[] = (
  ['auto', 'direct', 'command', 'selector', 'action'] as JoinBehaviourKind[]
).map((k) => ({ value: k, label: JOIN_KIND_LABELS[k] }));

const GamemodeJoinConfig = ({ gamemode, value, onChange }: Props) => {
  const { token } = theme.useToken();

  const setKind = (kind: JoinBehaviourKind) => {
    if (kind === value.kind) return;
    onChange(makeDefaultBehaviour(kind));
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: token.marginSM,
        marginTop: token.marginSM,
        paddingTop: token.marginSM,
        borderTop: `1px dashed ${token.colorBorderSecondary}`,
      }}
    >
      <div>
        <Text strong style={{ display: 'block', marginBottom: token.marginXXS }}>
          How does the bot join this gamemode?
        </Text>
        <Select
          style={{ width: '100%' }}
          value={value.kind}
          onChange={setKind}
          options={KIND_OPTIONS}
        />
        <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 4 }}>
          {JOIN_KIND_DESCRIPTIONS[value.kind]}
        </Text>
      </div>

      {value.kind === 'command' && (
        <div>
          <Text strong style={{ display: 'block', marginBottom: token.marginXXS }}>
            Command template
          </Text>
          <Input
            value={value.command}
            placeholder={DEFAULT_COMMAND_TEMPLATE}
            onChange={(e) =>
              onChange({ kind: 'command', command: e.target.value })
            }
            autoComplete="off"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            Use <code>{GAMEMODE_PLACEHOLDER}</code> as a placeholder.
            {gamemode && (
              <>
                {' '}
                For <em>{gamemode}</em> the bot will run{' '}
                <code>
                  {(value.command || DEFAULT_COMMAND_TEMPLATE)
                    .split(GAMEMODE_PLACEHOLDER)
                    .join(gamemode)}
                </code>
                .
              </>
            )}
          </Text>
        </div>
      )}

      {value.kind === 'action' && (
        <ProfileActionPicker
          scriptType="action"
          value={value.action}
          onChange={(action) => onChange({ kind: 'action', action })}
          placeholder="Select an action"
          createModal={{
            title: 'Create join action',
            defaultName: `Join ${gamemode || 'gamemode'}`,
            defaultDescription: `Brings the bot to ${gamemode || 'the gamemode'}.`,
            helpText:
              'Creates a JS action. main(bot, settings, [gamemode]) should bring the bot to the gamemode; return false if joining failed. Use Edit code afterwards to write it.',
          }}
        />
      )}

      {value.kind === 'selector' && (
        <>
          <HotbarSlotPicker
            label="Hotbar slot of the selector item"
            value={value.hotbarSlot}
            onChange={(slot) => onChange({ ...value, hotbarSlot: slot })}
          />

          <div>
            <Text strong style={{ display: 'block', marginBottom: token.marginXXS }}>
              After opening the selector
            </Text>
            <Radio.Group
              value={value.pick}
              onChange={(e) =>
                onChange({
                  ...value,
                  pick: e.target.value,
                  staticSlot: e.target.value === 'slot' ? value.staticSlot ?? 0 : undefined,
                })
              }
              style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
            >
              <Radio value="name">
                Find the item with the gamemode in its name (recommended)
              </Radio>
              <Radio value="slot">Click a fixed slot in the menu</Radio>
            </Radio.Group>
          </div>

          {value.pick === 'slot' && (
            <InventorySlotPicker
              label="Slot to click"
              hint="Pick the slot in the chest GUI that opens the gamemode."
              value={value.staticSlot}
              onChange={(slot) => onChange({ ...value, staticSlot: slot })}
            />
          )}
        </>
      )}
    </div>
  );
};

export default GamemodeJoinConfig;
