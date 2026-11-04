import React, { forwardRef, useImperativeHandle, useState } from 'react';
import { Modal } from 'antd';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface TutorialProps {
  title: string;
  markdown?: string;
  children?: React.ReactNode;
}

const Tutorial = forwardRef(({ title, markdown, children }: TutorialProps, ref) => {
  const [open, setOpen] = useState(false);

  const toggle = () => setOpen(!open);

  useImperativeHandle(ref, () => ({
    open: toggle,
  }));

  return (
    <Modal
      title={title}
      open={open}
      onCancel={toggle}
      footer={null}
      width="100%"
      styles={{body: {padding: '0 15%' }}}
    >
      {markdown && open ? (
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      ) : null}
      {open && children}
    </Modal>
  );
});

export default Tutorial;
