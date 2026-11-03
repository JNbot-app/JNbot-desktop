import { Button, Checkbox, Flex, Input, Space, Typography, theme } from 'antd';
import { DeleteOutlined, DownOutlined, PlusOutlined, UpOutlined } from '@ant-design/icons';
import { useState } from 'react';
import {
  DEFAULT_JOIN_BEHAVIOUR,
  JOIN_KIND_LABELS,
  type GamemodeJoinBehaviour,
} from '../../../../common/joinBehaviour';
import { gamemodeKey } from '../../../../common/profiles';
import GamemodeJoinConfig from '../shared/GamemodeJoinConfig';
import SectionHeader from '../SectionHeader';

const { Text } = Typography;

export interface GamemodesValues {
  gamemodes: string[];
  kitGamemodes: string[];
  defaultGamemode: string;
  joinBehaviours: Record<string, GamemodeJoinBehaviour>;
}

interface Props {
  value: GamemodesValues;
  onChange: (patch: Partial<GamemodesValues>) => void;
}

const StepGamemodes = ({ value, onChange }: Props) => {
  const { token } = theme.useToken();
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { gamemodes, kitGamemodes, joinBehaviours } = value;
  const defaultGamemode = value.defaultGamemode || gamemodes[0];
  // Gamemode ids are alphanumeric; clean the input instead of rejecting it.
  const cleaned = draft.replace(/[^a-zA-Z0-9]/g, '');
  const duplicate = gamemodes.some((g) => g.toLowerCase() === cleaned.toLowerCase());

  const add = () => {
    if (!cleaned || duplicate) return;
    onChange({ gamemodes: [...gamemodes, cleaned] });
    setDraft('');
  };

  const remove = (mode: string) => {
    const nextBehaviours = { ...joinBehaviours };
    delete nextBehaviours[gamemodeKey(mode)];
    onChange({
      gamemodes: gamemodes.filter((g) => g !== mode),
      kitGamemodes: kitGamemodes.filter((g) => g !== mode),
      joinBehaviours: nextBehaviours,
      ...(value.defaultGamemode === mode && { defaultGamemode: '' }),
    });
  };

  const behaviourOf = (mode: string) =>
    joinBehaviours[gamemodeKey(mode)] ?? DEFAULT_JOIN_BEHAVIOUR;

  return (
    <div style={{ maxWidth: 640 }}>
      <SectionHeader title="Gamemodes">
        The parts of the server bots can join. Skip this if the server has just
        one.
      </SectionHeader>

      <Space.Compact style={{ width: '100%' }}>
        <Input
          value={draft}
          placeholder="e.g. Skyblock"
          autoComplete="off"
          status={duplicate ? 'warning' : undefined}
          onChange={(e) => setDraft(e.target.value)}
          onPressEnter={add}
        />
        <Button icon={<PlusOutlined />} onClick={add} disabled={!cleaned || duplicate}>
          Add
        </Button>
      </Space.Compact>
      <Text
        type="secondary"
        style={{ display: 'block', minHeight: token.lineHeight * token.fontSize, marginTop: token.marginXXS }}
      >
        {duplicate
          ? 'Already added'
          : cleaned !== draft.trim() && cleaned
            ? `Will be added as ${cleaned}`
            : null}
      </Text>

      {gamemodes.length === 0 ? (
        <Text type="secondary" style={{ display: 'block', marginTop: token.margin }}>
          No gamemodes yet. Bots stay where they land when they join.
        </Text>
      ) : (
        <div
          style={{
            marginTop: token.margin,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: token.borderRadiusLG,
          }}
        >
          {gamemodes.map((mode, i) => {
            const open = expanded === mode;
            const behaviour = behaviourOf(mode);
            const isDefault = mode === defaultGamemode;
            return (
              <div
                key={mode}
                style={{
                  padding: `${token.paddingXS}px ${token.paddingSM}px ${token.paddingXS}px ${token.padding}px`,
                  borderTop: i ? `1px solid ${token.colorBorderSecondary}` : undefined,
                }}
              >
                <Flex align="center" gap={token.marginSM}>
                  <Text strong style={{ flex: 1, minWidth: 0 }} ellipsis>
                    {mode}
                    {isDefault && gamemodes.length > 1 && (
                      <Text type="secondary" style={{ fontWeight: 'normal' }}>
                        {' '}· default
                      </Text>
                    )}
                  </Text>
                  <Button
                    type="text"
                    size="small"
                    onClick={() => setExpanded(open ? null : mode)}
                    icon={open ? <UpOutlined /> : <DownOutlined />}
                    iconPlacement="end"
                  >
                    <Text type="secondary">{JOIN_KIND_LABELS[behaviour.kind]}</Text>
                  </Button>
                  <Button
                    type="text"
                    size="small"
                    icon={<DeleteOutlined />}
                    aria-label={`Remove ${mode}`}
                    onClick={() => remove(mode)}
                  />
                </Flex>

                {open && (
                  <div style={{ paddingBottom: token.paddingSM }}>
                    <GamemodeJoinConfig
                      gamemode={mode}
                      value={behaviour}
                      onChange={(next) =>
                        onChange({
                          joinBehaviours: { ...joinBehaviours, [gamemodeKey(mode)]: next },
                        })
                      }
                    />
                    <Flex gap={token.margin} align="center" style={{ marginTop: token.marginSM }}>
                      <Checkbox
                        checked={kitGamemodes.includes(mode)}
                        onChange={(e) =>
                          onChange({
                            kitGamemodes: e.target.checked
                              ? [...kitGamemodes, mode]
                              : kitGamemodes.filter((g) => g !== mode),
                          })
                        }
                      >
                        Has kits / GKits
                      </Checkbox>
                      {!isDefault && (
                        <Button
                          size="small"
                          type="link"
                          onClick={() => onChange({ defaultGamemode: mode })}
                        >
                          Make default
                        </Button>
                      )}
                    </Flex>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StepGamemodes;
