import { Tooltip } from 'antd';
import AnsiText from '../common/AnsiText';
import botActionHandler from './botActionHandler';
import useAppApi from '../../hooks/useAppApi';
import { isSafeExternalUrl } from '../announcements/announcement';
import type { ChatClick, ChatLine, ChatPart } from './types';

type ClickHandler = (click: ChatClick) => void;

const CLICKABLE: React.CSSProperties = { cursor: 'pointer' };

/** Performs a Minecraft chat click event, mirroring the vanilla client. */
export function useChatClickHandler(suggest: (text: string) => void): ClickHandler {
  const { modal, message } = useAppApi();

  return ({ action, value }) => {
    switch (action) {
      case 'run_command':
        botActionHandler('chatMessage', value);
        break;
      case 'suggest_command':
        suggest(value);
        break;
      case 'copy_to_clipboard':
        navigator.clipboard.writeText(value).then(() => message.success('Copied to clipboard'));
        break;
      case 'open_url':
        if (!isSafeExternalUrl(value)) return;
        modal.confirm({
          title: 'Open link?',
          content: value,
          okText: 'Open',
          onOk: () => {
            if (window.web) window.open(value, '_blank', 'noopener,noreferrer');
            else window.ipcRenderer.action('OPEN_URL', value);
          },
        });
        break;
    }
  };
}

const ChatPartText: React.FC<{ part: ChatPart; onClick: ClickHandler }> = ({ part, onClick }) => {
  const { click, hover } = part;
  const text = (
    <span style={click && CLICKABLE} onClick={click && (() => onClick(click))}>
      <AnsiText>{part.text}</AnsiText>
    </span>
  );
  if (!hover) return text;
  return (
    <Tooltip title={<AnsiText>{hover}</AnsiText>} mouseEnterDelay={0.15}>
      {text}
    </Tooltip>
  );
};

const ChatMessage: React.FC<{ line: ChatLine; onClick: ClickHandler }> = ({ line, onClick }) => {
  if (typeof line === 'string') return <AnsiText className="mcText">{line}</AnsiText>;
  return (
    <span className="mcText">
      {line.parts.map((part, i) => (
        <ChatPartText key={i} part={part} onClick={onClick} />
      ))}
    </span>
  );
};

export default ChatMessage;
