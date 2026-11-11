import React, {
  useState,
  useEffect,
  useLayoutEffect,
  forwardRef,
  useImperativeHandle,
  useRef,
} from 'react';
import { Inspector, chromeDark } from 'react-inspector';
import { nanoid } from 'nanoid';
import VirtualList from 'rc-virtual-list';
import { Typography } from 'antd';
import { LogStatus } from '../../../common/CommonEnums';
import { FullLogMessage } from '../../../main/src/types';
import AnsiText from '../../components/common/AnsiText';
import { logText } from '../../../common/logText';
import ExplainErrorButton from '../../components/llm/ExplainErrorButton';

export interface ConsoleLogRef {
  clearConsole: () => void;
  set: (msgs: FullLogMessage[]) => void;
  addString: (msg: string) => void;
  addLogs: (data: FullLogMessage[]) => void;
  copy: () => Promise<void>;
}

/**
 * A single console row, kept as raw data rather than a pre-rendered element.
 * Formatting (notably the heavy `<Inspector>`) happens lazily inside the
 * virtual list's render callback, so only visible rows are ever built.
 */
type LogItem =
  | { id: string; kind: 'log'; data: FullLogMessage }
  | { id: string; kind: 'str'; data: string };

const MAX_MESSAGES = 250;

const MESSAGE_TYPES = {
  [LogStatus.INFO]: '#bbb',
  [LogStatus.ERROR]: '#ED4145',
  [LogStatus.SUCCESS]: '#39DA8A',
  [LogStatus.WARN]: '#FDAC41',
};
const scrollThreshold = 16;

const pad2 = (value: number) => String(value).padStart(2, '0');

const formatTime = (date: Date) =>
  `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

/** Keep only the last `MAX_MESSAGES` rows. */
const capItems = (items: LogItem[]) =>
  items.length > MAX_MESSAGES
    ? items.slice(items.length - MAX_MESSAGES)
    : items;

export const formatMessageString = (messageData: FullLogMessage | string) => {
  if (typeof messageData === 'string') {
    return messageData;
  }

  return logText(messageData[0]);
};

const ConsoleLog = forwardRef<
  ConsoleLogRef,
  { textStyles?: React.CSSProperties; searchQuery?: string }
>(({ textStyles, searchQuery = '' }, ref) => {
  const [items, setItems] = useState<LogItem[]>([]);
  const query = searchQuery.trim().toLowerCase();
  const visibleItems = query
    ? items.filter((item) => {
        const text =
          item.kind === 'str'
            ? item.data
            : `${formatMessageString(item.data)} ${item.data[2]}`;
        return text.toLowerCase().includes(query);
      })
    : items;
  const [listHeight, setListHeight] = useState(500);
  const consoleBoxRef = useRef<HTMLDivElement>(null);
  const autoScrollEnabledRef = useRef(true);

  useEffect(() => {
    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        setListHeight(entry.contentRect.height);
      }
    });
    if (consoleBoxRef.current) {
      resizeObserver.observe(consoleBoxRef.current);
    }

    return () => resizeObserver.disconnect();
  }, []);

  const messageFormatter = (messageData: FullLogMessage, key: string) => {
    const [message, type] = messageData;

    const timeStr = formatTime(new Date(messageData[4]));

    return (
      <div
        key={key}
        style={{
          padding: 0,
          background: 'transparent',
          color: MESSAGE_TYPES[type],
          width: '100%',
          maxWidth: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 8,
            minWidth: 0,
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box',
            overflowX: 'visible',
          }}
        >
          <span style={{ whiteSpace: 'nowrap' }}>
            [{timeStr}] [{messageData[2]}]:{' '}
            {type === LogStatus.ERROR && <ExplainErrorButton error={logText(message)} scriptName={messageData[2]} />}
          </span>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              width: 0,
              boxSizing: 'border-box',
              whiteSpace: 'pre',
              overflowWrap: 'normal',
            }}
          >
            <Inspector
              table={false}
              theme={
                {
                  ...chromeDark,
                  OBJECT_VALUE_STRING_COLOR: MESSAGE_TYPES[type] ?? '#eee',
                  BASE_BACKGROUND_COLOR: 'transparent',
                  BASE_FONT_SIZE: '14px',
                  TREENODE_FONT_SIZE: '14px',
                } as any
              }
              data={message}
            />
          </div>
        </div>
      </div>
    );
  };

  const messageStrFormatter = (msg: string, key: string) => {
    return (
      <div key={key} style={{ padding: 0, background: 'transparent' }}>
        <AnsiText style={textStyles}>{msg}</AnsiText>
      </div>
    );
  };

  const renderItem = (item: LogItem) =>
    item.kind === 'str'
      ? messageStrFormatter(item.data, item.id)
      : messageFormatter(item.data, item.id);

  useImperativeHandle(ref, () => ({
    clearConsole: () => {
      setItems([]);
      window.ipcRenderer.action('CLEAR_CONSOLE');
    },
    set: (msgs: FullLogMessage[]) => {
      setItems(
        msgs.slice(-MAX_MESSAGES).map((data) => ({
          id: nanoid(),
          kind: 'log',
          data,
        })),
      );
    },
    addString: (msg: string) => {
      setItems((curr) =>
        capItems([...curr, { id: nanoid(), kind: 'str', data: msg }]),
      );
    },
    addLogs(data: FullLogMessage[]) {
      setItems((curr) =>
        capItems([
          ...curr,
          ...data
            .slice(-MAX_MESSAGES)
            .map((d) => ({ id: nanoid(), kind: 'log', data: d }) as LogItem),
        ]),
      );
    },
    copy: async () => {
      const textToCopy = visibleItems
        .map((item) => {
          if (item.kind === 'str') {
            return item.data;
          }
          const timeStr = formatTime(new Date(item.data[4]));
          const scriptName = item.data[2];
          const content = formatMessageString(item.data);
          return `[${timeStr}] [${scriptName}]: ${content}`;
        })
        .join('\n');

      if (!textToCopy) {
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      }
    },
  }));

  useLayoutEffect(() => {
    setTimeout(() => {
      const scrollBox = consoleBoxRef.current?.querySelector(
        '.rc-virtual-list-holder',
      ) as HTMLElement | null;
      if (scrollBox && autoScrollEnabledRef.current) {
        scrollBox.scrollTop = scrollBox.scrollHeight;
      }
    }, 300);
  }, []);

  useLayoutEffect(() => {
    const scrollBox = consoleBoxRef.current?.querySelector(
      '.rc-virtual-list-holder',
    ) as HTMLElement | null;
    if (!scrollBox) return;

    if (autoScrollEnabledRef.current) {
      scrollBox.scrollTop = scrollBox.scrollHeight;
    }
  }, [items, searchQuery]);

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const isAtBottom =
      target.scrollHeight - target.scrollTop - target.clientHeight <=
      scrollThreshold;

    if (isAtBottom) {
      autoScrollEnabledRef.current = true;
      return;
    }

    if (
      target.scrollTop <
      target.scrollHeight - target.clientHeight - scrollThreshold
    ) {
      autoScrollEnabledRef.current = false;
    }
  };

  return (
    <div ref={consoleBoxRef} style={{ height: '100%' }} id="console-box">
      {query && visibleItems.length === 0 && (
        <Typography.Text type="secondary" role="status">
          No matching logs
        </Typography.Text>
      )}
      <VirtualList
        itemKey="id"
        height={listHeight}
        data={visibleItems}
        onScroll={handleScroll}
      >
        {(item) => renderItem(item)}
      </VirtualList>
    </div>
  );
});

export default ConsoleLog;
