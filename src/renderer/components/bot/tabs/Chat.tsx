import { useState, useLayoutEffect, useEffect, useRef, Fragment } from 'react';
import { theme as antTheme } from 'antd';
import ChatBar, { ChatBarHandle } from '../ChatBar';
import ChatMessage, { useChatClickHandler } from '../ChatMessage';
import botActionHandler from '../botActionHandler';
import { BotInfo, ChatData, ChatLine } from '../types';
import botEvents from '../../../utils/botEvents';
import CircularBuffer from '../../../../common/CircularBuffer';

const MAX_MESSAGES = 80;
const BOTTOM_THRESHOLD = 16;

interface ChatEntry {
  id: number;
  line: ChatLine;
}

interface ChatProps {
  selectedBot: BotInfo;
  small?: boolean;
}

const Chat: React.FC<ChatProps> = ({ selectedBot, small }) => {
  const chat = useRef<CircularBuffer<ChatEntry>>(new CircularBuffer<ChatEntry>(MAX_MESSAGES));
  const nextId = useRef(0);
  const chatboxRef = useRef<HTMLDivElement>(null);
  const chatBarRef = useRef<ChatBarHandle>(null);
  // Whether the view follows new messages; only cleared when the user scrolls up.
  const stickToBottom = useRef(true);
  const lastScrollTop = useRef(0);
  const [messageUpdate, setRerender] = useState(0);
  const { token } = antTheme.useToken();
  const onChatClick = useChatClickHandler((text) => chatBarRef.current?.suggest(text));

  useEffect(() => {
    if (!selectedBot) return;
    const push = (line: ChatLine) => chat.current.push({ id: nextId.current++, line });
    const unsub = botEvents.subscribe(
      selectedBot.botId,
      'chat',
      (msg: ChatData) => {
        if ('messages' in msg && Array.isArray(msg.messages)) {
          chat.current.clear();
          msg.messages.forEach(push);
        } else if ('message' in msg) {
          push(msg.parts ? { message: msg.message, parts: msg.parts } : msg.message);
        }
        setRerender((r) => r + 1);
      },
      { throttle: 5 },
    );
    botActionHandler('chatPacket');
    return () => unsub();
  }, [selectedBot?.botId]);

  const scrollToBottom = () => {
    const el = chatboxRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    lastScrollTop.current = el.scrollTop;
  };

  const onScroll = () => {
    const el = chatboxRef.current;
    if (!el) return;
    if (isScrolledToBottom(el)) stickToBottom.current = true;
    else if (el.scrollTop < lastScrollTop.current) stickToBottom.current = false;
    lastScrollTop.current = el.scrollTop;
  };

  useLayoutEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messageUpdate]);

  useEffect(() => {
    stickToBottom.current = true;
    scrollToBottom();
  }, [small]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 10 }}>
      <div
        ref={chatboxRef}
        onScroll={onScroll}
        id={'chat-box' + (small ? '_small' : '')}
        style={{
          flex: 1,
          minHeight: small ? 240 : 320,
          maxHeight: 1000,
          overflow: 'auto',
          padding: small ? 10 : 16,
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 10,
          background: token.colorBgElevated,
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
          fontSize: small ? 12 : 13,
          lineHeight: 1.5,
        }}
      >
        {chat.current.map(({ id, line }) => (
          <Fragment key={id}>
            <ChatMessage line={line} onClick={onChatClick} />
            <br />
          </Fragment>
        ))}
      </div>
      <ChatBar ref={chatBarRef} small={small} />
    </div>
  );
};

function isScrolledToBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
}

export default Chat;
