import type { ReactNode } from 'react';
import { Button, Checkbox, Flex, Tag, Typography, theme } from 'antd';
import {
  BRAIN_INPUT_GROUPS,
  type BrainControl,
  type BrainInfo,
  type BrainInputGroup,
  type BrainInteraction,
  type BrainLearnSettings,
  type BrainSpec,
  interactionEffect,
  interactionLabel,
  stateRule,
} from '../../../../common/brainSpec';

const { Text } = Typography;

const CONTROLS: { value: BrainControl; label: string }[] = [
  { value: 'walk', label: 'Walk around' },
  { value: 'jump', label: 'Jump' },
  { value: 'sprint', label: 'Sprint' },
  { value: 'sneak', label: 'Sneak' },
  { value: 'useItem', label: 'Use the item in hand (eat, shield)' },
  { value: 'hold', label: 'Switch items' },
];

const INPUTS: Record<BrainInputGroup, string> = {
  health: 'Its health and hunger',
  held: 'What it holds and how many it has',
  motion: 'How it moves: falling, sneaking, looking up or down',
  hostile: 'Hostile mobs around it',
  players: 'Players around it',
  projectiles: 'Arrows and other projectiles',
  rays: 'Walls, drops and hazards',
  thing: 'What the thing is like: crop age, mob health, wool',
  around: 'Blocks around the thing',
  memory: 'What it did last',
};

/** one-line summary of what it learns, for the rail */
export function actionsSummary(spec: BrainSpec) {
  const [first, ...rest] = spec.interactions;
  if (!first) return 'Move around';
  return `${interactionLabel(first)}${rest.length ? ` +${rest.length} more` : ''}`;
}

interface SectionProps {
  title: string;
  /** shown while the choice follows the examples */
  auto: boolean;
  onReset: () => void;
  children: ReactNode;
}

function Section({ title, auto, onReset, children }: SectionProps) {
  const { token } = theme.useToken();
  return (
    <Flex vertical gap={token.marginXS}>
      <Flex align="center" justify="space-between">
        <Text strong>{title}</Text>
        {auto ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            From your examples
          </Text>
        ) : (
          <Button type="link" size="small" onClick={onReset}>
            Use what my examples show
          </Button>
        )}
      </Flex>
      {children}
    </Flex>
  );
}

interface InteractionRulesProps {
  interaction: BrainInteraction;
  anyState: string[];
  onChange: (anyState: string[]) => void;
}

/** the block states it's limited to (seen in the examples); unticking one lets it do it whatever that property is */
function InteractionRules({
  interaction: { id, states = {} },
  anyState,
  onChange,
}: InteractionRulesProps) {
  const { token } = theme.useToken();
  const rules = Object.entries(states);
  if (!rules.length) return null;
  return (
    <Flex
      wrap
      align="center"
      gap={token.marginXXS}
      style={{ paddingLeft: token.paddingLG }}
    >
      <Text type="secondary" style={{ fontSize: 12 }}>
        Only when
      </Text>
      {rules.map(([key, values]) => {
        const rule = `${id}|${key}`;
        return (
          <Tag.CheckableTag
            key={key}
            checked={!anyState.includes(rule)}
            onChange={(checked) =>
              onChange(
                checked
                  ? anyState.filter((r) => r !== rule)
                  : [...anyState, rule],
              )
            }
          >
            {stateRule(key, values)}
          </Tag.CheckableTag>
        );
      })}
    </Flex>
  );
}

interface TeachActionsProps {
  info: BrainInfo;
  learn?: BrainLearnSettings;
  onChange: (learn: BrainLearnSettings) => void;
}

/** What the AI does (interactions found in the examples), how it moves and what it pays attention to. */
export default function TeachActions({
  info,
  learn = {},
  onChange,
}: TeachActionsProps) {
  const { token } = theme.useToken();
  const { noticed } = info;
  const set = (patch: BrainLearnSettings) => onChange({ ...learn, ...patch });
  // from the settings, not info.spec: that only follows once reloaded
  const anyState = learn.anyState ?? [];

  return (
    <Flex vertical gap={token.marginLG}>
      <Section
        title="What it does"
        auto={!learn.interactions && !learn.anyState}
        onReset={() => set({ interactions: undefined, anyState: undefined })}
      >
        {noticed.interactions.length ? (
          <Checkbox.Group
            value={learn.interactions ?? noticed.interactions.map((i) => i.id)}
            onChange={(ids) => set({ interactions: ids as string[] })}
          >
            <Flex vertical gap={token.marginXS}>
              {noticed.interactions.map((i) => {
                const effect = interactionEffect(i);
                return (
                  <Flex key={i.id} vertical gap={token.marginXXS}>
                    <Checkbox value={i.id}>
                      {interactionLabel(i)}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {effect && ` · ${effect}`} · {i.count}×
                      </Text>
                    </Checkbox>
                    <InteractionRules
                      interaction={i}
                      anyState={anyState}
                      onChange={(next) => set({ anyState: next })}
                    />
                  </Flex>
                );
              })}
            </Flex>
          </Checkbox.Group>
        ) : (
          <Text type="secondary">
            Record a take: everything you break, hit or right-click shows up
            here, and you pick what it should do.
          </Text>
        )}
      </Section>

      <Section
        title="How it moves"
        auto={!learn.controls}
        onReset={() => set({ controls: undefined })}
      >
        <Text type="secondary" style={{ fontSize: 12 }}>
          Pick what it copies from you. It always walks to the things it works
          on.
        </Text>
        <Checkbox.Group
          options={CONTROLS}
          value={learn.controls ?? noticed.controls}
          onChange={(controls) => set({ controls })}
        />
      </Section>

      <Section
        title="What it pays attention to"
        auto={!learn.inputs}
        onReset={() => set({ inputs: undefined })}
      >
        <Checkbox.Group
          options={BRAIN_INPUT_GROUPS.map((value) => ({
            value,
            label: INPUTS[value],
          }))}
          value={learn.inputs ?? BRAIN_INPUT_GROUPS}
          onChange={(inputs) => set({ inputs })}
        />
      </Section>
    </Flex>
  );
}
