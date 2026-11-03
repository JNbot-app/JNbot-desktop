import React, { useState } from 'react';
import { Flex } from 'antd';
import { MdArrowBack, MdArrowForward } from 'react-icons/md';
import type { ScreenPrompt } from '../../../../../../main/src/workers/workerTypes';
import ChatMessage from '../../../../bot/ChatMessage';
import type { ChatClick, ChatLine } from '../../../../bot/types';
import botEvents from '../../../../../utils/botEvents';
import usePromptClick from './usePromptClick';

interface BookViewProps {
  book: Extract<ScreenPrompt, { kind: 'book' }>;
  botId: number;
}

/** Written book the server opened (vanilla book screen). */
const BookView: React.FC<BookViewProps> = ({ book, botId }) => {
  const [page, setPage] = useState(0);
  const promptClick = usePromptClick(botId);
  const last = book.pages.length - 1;

  const onClick = (click: ChatClick) => {
    if (click.action === 'change_page')
      setPage(Math.min(last, Math.max(0, Number(click.value) - 1)));
    else promptClick(click);
  };

  return (
    <Flex vertical align="center" gap={16} style={{ padding: '1rem 0' }}>
      <div className="mc-book">
        <div className="mc-book-number">
          Page {page + 1} of {last + 1}
        </div>
        <div className="mc-book-text">
          <ChatMessage line={book.pages[page] as ChatLine} onClick={onClick} />
        </div>
        <Flex justify="space-between">
          <button
            type="button"
            className="mc-book-arrow"
            aria-label="Previous page"
            style={{ visibility: page > 0 ? 'visible' : 'hidden' }}
            onClick={() => setPage(page - 1)}
          >
            <MdArrowBack size={22} />
          </button>
          <button
            type="button"
            className="mc-book-arrow"
            aria-label="Next page"
            style={{ visibility: page < last ? 'visible' : 'hidden' }}
            onClick={() => setPage(page + 1)}
          >
            <MdArrowForward size={22} />
          </button>
        </Flex>
      </div>
      <button
        type="button"
        className="mc-button"
        onClick={() => botEvents.action(botId, 'closePrompt')}
      >
        Done
      </button>
    </Flex>
  );
};

export default BookView;
