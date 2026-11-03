import React, { useState } from 'react';
import { Flex, Tooltip } from 'antd';
import type {
  DialogInput,
  DialogValue,
  ScreenPrompt,
} from '../../../../../../main/src/workers/workerTypes';
import ChatMessage from '../../../../bot/ChatMessage';
import AnsiText from '../../../../common/AnsiText';
import type { ChatLine } from '../../../../bot/types';
import botEvents from '../../../../../utils/botEvents';
import DialogInputField from './DialogInputField';
import { McAnsiText } from './Mc';
import usePromptClick from './usePromptClick';
import textures from './textures.json';

type Dialog = Extract<ScreenPrompt, { kind: 'dialog' }>;

interface DialogViewProps {
  dialog: Dialog;
  botId: number;
}

const initialValues = (inputs: DialogInput[]) =>
  Object.fromEntries(
    inputs.map((input) => [
      input.key,
      input.type === 'single_option'
        ? input.options[input.initial]?.id ?? ''
        : input.initial,
    ]),
  ) as Record<string, DialogValue>;

/** Server dialog (1.21.6+): notice, confirmation, multi action, dialog list. */
const DialogView: React.FC<DialogViewProps> = ({ dialog, botId }) => {
  const [values, setValues] = useState(() => initialValues(dialog.inputs));
  const onClick = usePromptClick(botId);

  const press = (button: number) => {
    const click = dialog.buttons[button].click;
    if (click) onClick(click as Parameters<typeof onClick>[0]);
    botEvents.action(botId, 'dialogAction', { button, values });
  };

  return (
    <div className="mc-dialog">
      <McAnsiText text={dialog.title} fontSize={16} />
      {dialog.body.map((body, i) => (
        <Flex key={i} align="center" gap={8} className="mc-dialog-body">
          {body.item && (
            <span className="mc-dialog-item">
              <img
                width={32}
                height={32}
                alt={body.item.name}
                src={(textures as Record<string, string>)[body.item.name]}
              />
              {body.item.count > 1 && <span>{body.item.count}</span>}
            </span>
          )}
          {body.text && (
            <ChatMessage line={body.text as ChatLine} onClick={onClick} />
          )}
        </Flex>
      ))}
      {dialog.inputs.length > 0 && (
        <div className="mc-dialog-controls">
          {dialog.inputs.map((input) => (
            <DialogInputField
              key={input.key}
              input={input}
              value={values[input.key]}
              onChange={(value) =>
                setValues((prev) => ({ ...prev, [input.key]: value }))
              }
            />
          ))}
        </div>
      )}
      <div
        className="mc-dialog-buttons"
        style={{
          gridTemplateColumns: `repeat(${Math.max(1, Math.min(dialog.columns, dialog.buttons.length))}, 1fr)`,
        }}
      >
        {dialog.buttons.map((button, i) => (
          <Tooltip
            key={i}
            title={button.tooltip && <AnsiText>{button.tooltip}</AnsiText>}
          >
            <button
              type="button"
              className="mc-button"
              onClick={() => press(i)}
            >
              <McAnsiText text={button.label} />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
};

export default DialogView;
