import { FC, memo, useMemo } from 'react';
import { Form, Select, Avatar, Tag, Badge, Typography, Space, theme } from 'antd';
import { useSettingsStore, selectActiveBots } from '../../../../redux/settings';
import {
  ScriptSettingProps,
  ScriptSettingsProps_ActiveBotSelect,
} from '../ScriptSettingsProps.d';
import type { ActiveBotsType } from '../../../../../main/src/types';

interface BotOptionMeta {
  bot: ActiveBotsType[number] | null;
  isMinecraft: boolean;
}

interface SelectOptionItem {
  value: string;
  label: string;
  meta: BotOptionMeta;
}

const statusBadge = (status?: ActiveBotsType[number]['status']) => {
  switch (status) {
    case 'connected':
      return 'success';
    case 'joining':
    case 'queued':
      return 'processing';
    case 'failed':
      return 'error';
    default:
      return 'default';
  }
};

const ActiveBotSelectOption: FC<{
  option: ScriptSettingsProps_ActiveBotSelect;
  onChange?: (
    e: string[],
    option: ScriptSettingProps,
  ) => void;
  value?: string[] | string | (string | number)[];
}> = ({ option, onChange, value }) => {
  const { token } = theme.useToken();
  const activeBots = useSettingsStore(selectActiveBots);

  const botFilter = option.botFilter || option.filter || 'all';

  const filteredBots = useMemo(() => {
    return activeBots.filter((bot) => {
      if (botFilter === 'bots' || (botFilter as string) === 'worker') {
        return bot.origin !== 'minecraft';
      }
      if (botFilter === 'minecraft' || (botFilter as string) === 'mc') {
        return bot.origin === 'minecraft';
      }
      return true;
    });
  }, [activeBots, botFilter]);

  const normalizedArrayValue: string[] = useMemo(() => {
    if (Array.isArray(value)) return value.map(String);
    if (value !== undefined && value !== null && value !== '') return [String(value)];
    return [];
  }, [value]);

  const selectOptions = useMemo(() => {
    const list: SelectOptionItem[] = filteredBots.map((bot) => ({
      value: bot.username,
      label: bot.username,
      meta: {
        bot,
        isMinecraft: bot.origin === 'minecraft',
      },
    }));

    // Ensure selected/saved values remain selectable and visible even if offline
    const existing = new Set(list.map((item) => item.value));
    for (const val of normalizedArrayValue) {
      if (val && !existing.has(val)) {
        list.push({
          value: val,
          label: val,
          meta: {
            bot: null,
            isMinecraft: false,
          },
        });
      }
    }

    return list;
  }, [filteredBots, normalizedArrayValue]);

  const isMultiple = option.multiple !== false;

  const placeholder =
    option.placeholder ||
    (isMultiple ? 'Select active bots...' : 'Select an active bot...');

  const handleChange = (nextVal: string | string[] | undefined) => {
    if (Array.isArray(nextVal)) {
      onChange?.(nextVal.map(String), option);
    } else if (nextVal !== undefined && nextVal !== null && nextVal !== '') {
      onChange?.([String(nextVal)], option);
    } else {
      onChange?.([], option);
    }
  };

  return (
    <Form.Item
      label={option.label}
      name={option.id}
      tooltip={option.tooltip}
      style={{ width: '100%', maxWidth: isMultiple ? 420 : 360 }}
    >
      <Select
        id={option.id}
        mode={isMultiple ? (option.freeSolo ? 'tags' : 'multiple') : undefined}
        allowClear={option.clearable !== false}
        showSearch={{
          filterOption: (input, opt) =>
          String(opt?.value ?? '')
            .toLowerCase()
            .includes(input.toLowerCase())
        }}
        placeholder={placeholder}
        value={isMultiple ? normalizedArrayValue : normalizedArrayValue[0]}
        className={option.className}
        style={{ width: '100%' }}
        maxTagCount="responsive"
        onChange={handleChange}
        options={selectOptions}
        optionRender={(item) => {
          const meta = (item.data as SelectOptionItem).meta;
          const bot = meta?.bot;
          const isMinecraft = meta?.isMinecraft;
          const username = item.data.value;

          return (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                gap: 8,
              }}
            >
              <Space orientation="horizontal" size={8} style={{ minWidth: 0, flex: 1 }}>
                <Avatar
                  size={20}
                  shape="square"
                  src={`https://crafthead.net/avatar/${username || 'steve'}?size=32&default=MHF_Steve`}
                  style={{ flexShrink: 0 }}
                />
                <Typography.Text ellipsis style={{ maxWidth: 160 }}>
                  {username}
                </Typography.Text>
                {bot && (
                  <Badge status={statusBadge(bot.status)} />
                )}
              </Space>
              {bot ? (
                <Tag
                  variant="solid"
                  color={isMinecraft ? 'blue' : 'cyan'}
                  style={{ marginInlineEnd: 0, fontSize: 11 }}
                >
                  {isMinecraft ? 'MC Client' : 'Bot'}
                </Tag>
              ) : (
                <Tag
                  variant="solid"
                  color={token.colorFillQuaternary}
                  style={{
                    marginInlineEnd: 0,
                    fontSize: 11,
                    color: token.colorTextQuaternary,
                  }}
                >
                  Offline
                </Tag>
              )}
            </div>
          );
        }}
      />
    </Form.Item>
  );
};

export default memo(ActiveBotSelectOption);
