import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { AutoComplete, Button, Input, InputRef, Space } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import botActionHandler from './botActionHandler';

interface ChatBarProps {
  small?: boolean;
  defaultMessage?: string;
}

export interface ChatBarHandle {
  /** Replaces the input with the given text and focuses it (Minecraft's suggest_command). */
  suggest: (text: string) => void;
}

interface Completion {
  query: string;
  matches: string[];
  index: number;
}

const TOKEN_RE = /[A-Za-z0-9:,._*\-/]*$/;
const HISTORY_LIMIT = 50;

function applyMatch(query: string, match: string): string {
  const parts = query.split(' ');
  parts[parts.length - 1] = parts[parts.length - 1].replace(TOKEN_RE, '') + match;
  return parts.join(' ');
}

const ChatBar = forwardRef<ChatBarHandle, ChatBarProps>(({ defaultMessage, small }, ref) => {
  const [message, setMessage] = useState<string>(defaultMessage ?? '');
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const draftRef = useRef<string>('');
  const [completion, setCompletion] = useState<Completion | null>(null);
  const inputRef = useRef<InputRef>(null);

  const focusEnd = () => {
    requestAnimationFrame(() => {
      const el = inputRef.current?.input;
      if (!el) return;
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  };

  useImperativeHandle(ref, () => ({
    suggest: (text) => {
      setMessage(text);
      setCompletion(null);
      setHistoryIndex(-1);
      inputRef.current?.focus();
      focusEnd();
    },
  }));

  const cycleCompletion = async () => {
    if (completion && completion.matches.length) {
      const next = (completion.index + 1) % completion.matches.length;
      setCompletion({ ...completion, index: next });
      setMessage(applyMatch(completion.query, completion.matches[next]));
      focusEnd();
      return;
    }
    if (!message.trim()) return;
    const result = await botActionHandler('tabComplete', message, true);
    if (!Array.isArray(result) || result.length === 0) return;
    const matches: string[] =
      typeof result[0] === 'string'
        ? (result as string[])
        : (result as Array<{ match: string }>).map((c) => c.match);
    setCompletion({ query: message, matches, index: 0 });
    setMessage(applyMatch(message, matches[0]));
    focusEnd();
  };

  const navigateHistory = (direction: 1 | -1) => {
    if (history.length === 0) return;
    if (historyIndex === -1 && direction === 1) {
      draftRef.current = message;
    }
    const next = historyIndex + direction;
    if (next < -1 || next >= history.length) return;
    setHistoryIndex(next);
    setMessage(next === -1 ? draftRef.current : history[next]);
    focusEnd();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      cycleCompletion();
    } else if (e.key === 'Escape' && completion) {
      e.preventDefault();
      setMessage(completion.query);
      setCompletion(null);
    } else if (e.key === 'ArrowUp' && !completion) {
      e.preventDefault();
      navigateHistory(1);
    } else if (e.key === 'ArrowDown' && !completion) {
      e.preventDefault();
      navigateHistory(-1);
    }
  };

  const onChange = (val: string) => {
    setMessage(val);
    if (historyIndex !== -1) setHistoryIndex(-1);
    if (completion) setCompletion(null);
  };

  const onSelect = (value: string, option: { label: string }) => {
    if (!completion) return;
    const idx = completion.matches.indexOf(option.label);
    setCompletion({ ...completion, index: idx >= 0 ? idx : 0 });
    setMessage(value);
    focusEnd();
  };

  const sendMessage = () => {
    const msg = message.trim();
    if (!msg) return;
    botActionHandler('chatMessage', msg);
    setHistory((prev) => {
      const next = prev[0] === msg ? prev : [msg, ...prev];
      return next.slice(0, HISTORY_LIMIT);
    });
    setHistoryIndex(-1);
    draftRef.current = '';
    setMessage(defaultMessage ?? '');
    setCompletion(null);
  };

  const options =
    completion?.matches.map((m) => ({
      value: applyMatch(completion.query, m),
      label: m,
    })) ?? [];

  const size = small ? 'middle' : 'large';

  return (
    <Space.Compact style={{ width: '100%' }}>
      <AutoComplete
        value={message}
        options={options}
        open={!!completion && options.length > 0}
        onSelect={onSelect}
        onChange={onChange}
        size={size}
        style={{ width: '100%' }}
      >
        <Input
          ref={inputRef}
          placeholder="Type a message..."
          onPressEnter={sendMessage}
          onKeyDown={onKeyDown}
          size={size}
        />
      </AutoComplete>
      <Button size={size} icon={<SendOutlined />} onClick={sendMessage} />
    </Space.Compact>
  );
});

export default ChatBar;
