import React from 'react';
import type { ScreenPrompt } from '../../../../../../main/src/workers/workerTypes';
import SignEditor from './SignEditor';
import BookView from './BookView';
import DialogView from './DialogView';

/** Input screen the server opened; replaces the window like it does in vanilla. */
const PromptScreen: React.FC<{ prompt: ScreenPrompt; botId: number }> = ({
  prompt,
  botId,
}) => {
  switch (prompt.kind) {
    case 'sign': {
      const { x, y, z } = prompt.position;
      return (
        <SignEditor
          key={`${botId}-${x}-${y}-${z}`}
          sign={prompt}
          botId={botId}
        />
      );
    }
    case 'book':
      return (
        <BookView
          key={`${botId}-${prompt.title}`}
          book={prompt}
          botId={botId}
        />
      );
    case 'dialog':
      // Content key: a new dialog resets its input values
      return (
        <DialogView
          key={`${botId}-${prompt.title}-${JSON.stringify(prompt.inputs)}`}
          dialog={prompt}
          botId={botId}
        />
      );
  }
};

export default PromptScreen;
