import { Input, type InputProps,  } from 'antd';
import { TextAreaProps } from 'antd/lib/input';
import React, { useEffect, useRef, useState } from 'react';

/** Keeps keystrokes local and commits after a pause or when focus leaves. */
export function useDeferredRecipeValue(
  externalValue: string,
  onCommit: (value: string) => void,
) {
  const [draft, setDraft] = useState(externalValue);
  const editing = useRef(false);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;

  useEffect(() => {
    if (!editing.current) setDraft(externalValue);
  }, [externalValue]);
  useEffect(() => {
    if (!editing.current || draft === externalValue) return;
    const timeout = window.setTimeout(() => commitRef.current(draft), 300);
    return () => window.clearTimeout(timeout);
  }, [draft, externalValue]);

  return {
    draft,
    setDraft,
    onFocus: () => {
      editing.current = true;
    },
    onBlur: () => {
      editing.current = false;
      if (draft !== externalValue) commitRef.current(draft);
    },
  };
}

const DeferredRecipeInput: React.FC<
  Omit<InputProps, 'value' | 'onChange'> & {
    value: string;
    onCommit: (value: string) => void;
  }
> = ({ value, onCommit, ...props }) => {
  const deferred = useDeferredRecipeValue(value, onCommit);
  return (
    <Input
      {...props}
      value={deferred.draft}
      onFocus={deferred.onFocus}
      onBlur={deferred.onBlur}
      onChange={(event) => deferred.setDraft(event.target.value)}
    />
  );
};

export default DeferredRecipeInput;

export const DeferredRecipeTextArea: React.FC<
  Omit<TextAreaProps, 'value' | 'onChange'> & {
    value: string;
    onCommit: (value: string) => void;
  }
> = ({ value, onCommit, ...props }) => {
  const deferred = useDeferredRecipeValue(value, onCommit);
  return (
    <Input.TextArea
      {...props}
      value={deferred.draft}
      onFocus={deferred.onFocus}
      onBlur={deferred.onBlur}
      onChange={(event) => deferred.setDraft(event.target.value)}
    />
  );
};
