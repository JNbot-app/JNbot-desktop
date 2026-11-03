import { AimOutlined } from '@ant-design/icons';
import { Button, Dropdown, Tooltip, type MenuProps } from 'antd';
import { useRef, useState, type FC, type MutableRefObject } from 'react';

import botEvents from '../../utils/botEvents';
import useSettingsStore from '../../redux/store';
import type { EditorBotContext } from '../../../main/src/workers/workerTypes';
import type { EditorInstance } from './CodeEditor';

type MenuItems = NonNullable<MenuProps['items']>;
type Vec = { x: number; y: number; z: number };

const vec = ({ x, y, z }: Vec) => `{ x: ${x}, y: ${y}, z: ${z} }`;
const str = (value: string) => JSON.stringify(value);
const round = (value: number) => Number(value.toFixed(3));
const notice = (label: string): MenuItems => [{ key: 'notice', label, disabled: true }];

/** Builds the menu and fills `inserts` with the code each item inserts. */
function buildItems(
  ctx: EditorBotContext,
  inserts: Map<string, string>,
): MenuItems {
  const item = (key: string, label: string, text: string) => {
    inserts.set(key, text);
    return { key, label };
  };

  if (!ctx.position) return notice('Bot is not in game');
  const items: MenuItems = [
    {
      type: 'group',
      label: 'Bot',
      children: [
        item('position', `Position (${ctx.position.x}, ${ctx.position.y}, ${ctx.position.z})`, vec(ctx.position)),
        item('look', 'Look direction', `await bot.look(${round(ctx.yaw ?? 0)}, ${round(ctx.pitch ?? 0)});`),
        ...(ctx.heldItem ? [item('held', `Held item (${ctx.heldItem})`, str(ctx.heldItem))] : []),
      ],
    },
  ];

  if (ctx.lookingAt) {
    items.push({
      type: 'group',
      label: `Looking at ${ctx.lookingAt.displayName}`,
      children: [
        item('block-pos', 'Block position', vec(ctx.lookingAt.position)),
        item('block-name', 'Block name', str(ctx.lookingAt.name)),
      ],
    });
  }

  if (ctx.window) {
    items.push({
      type: 'group',
      label: 'Open window',
      children: [
        ...(ctx.window.title ? [item('window-title', `Title (${ctx.window.title})`, str(ctx.window.title))] : []),
        {
          key: 'slots',
          label: 'Slot number',
          disabled: !ctx.window.items.length,
          children: ctx.window.items.map(({ slot, displayName, count }) =>
            item(`slot-${slot}`, `${slot} · ${displayName} ×${count}`, String(slot)),
          ),
        },
      ],
    });
  }
  return items;
}

/** Inserts live values (position, looked-at block, window slots) from a bot. */
const BotContextMenu: FC<{
  editorRef: MutableRefObject<EditorInstance | null>;
}> = ({ editorRef }) => {
  const [items, setItems] = useState<MenuItems>([]);
  const inserts = useRef(new Map<string, string>());

  const load = async (open: boolean) => {
    if (!open) return;
    const { selectedBot, activeBots } = useSettingsStore.getState();
    const bot = selectedBot?.MESSAGE_ADDRESS
      ? selectedBot
      : activeBots.find((activeBot) => activeBot.MESSAGE_ADDRESS);
    if (!bot) return setItems(notice('Start a bot to insert values from it'));

    setItems(notice(`Reading ${bot.username}…`));
    try {
      const ctx = await botEvents.actionAsync(bot.botId, 'editorContext');
      inserts.current.clear();
      setItems(buildItems(ctx, inserts.current));
    } catch {
      setItems(notice(`Could not read ${bot.username}`));
    }
  };

  const insert: MenuProps['onClick'] = ({ key }) => {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const text = inserts.current.get(key);
    if (!editor || !selection || text === undefined) return;
    editor.executeEdits('bot-context', [
      { range: selection, text, forceMoveMarkers: true },
    ]);
    editor.focus();
  };

  return (
    <Dropdown
      trigger={['click']}
      menu={{ items, onClick: insert }}
      onOpenChange={load}
    >
      <Tooltip title="Insert from bot">
        <Button type="text" icon={<AimOutlined />} aria-label="Insert from bot" />
      </Tooltip>
    </Dropdown>
  );
};

export default BotContextMenu;
