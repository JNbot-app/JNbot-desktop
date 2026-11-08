import { lazy, Suspense, useState } from 'react';
import { Button, Modal } from 'antd';
import { RobotOutlined } from '@ant-design/icons';
import useLlm from '../../hooks/useLlm';

// Loaded on demand: the console stays free of the markdown renderer.
const ExplainError = lazy(() => import('./ExplainError'));

/** "Explain" on an error log line. Hidden until an AI provider is set up. */
const ExplainErrorButton = ({ error, scriptName }: { error: string; scriptName?: string }) => {
  const { configured } = useLlm();
  const [open, setOpen] = useState(false);
  if (!configured) return null;

  return (
    <>
      <Button size="small" type="link" icon={<RobotOutlined />} onClick={() => setOpen(true)}>
        Explain
      </Button>
      <Modal open={open} onCancel={() => setOpen(false)} footer={null} title="What went wrong" width={640} destroyOnHidden>
        <Suspense fallback={null}>
          <ExplainError error={error} scriptName={scriptName} />
        </Suspense>
      </Modal>
    </>
  );
};

export default ExplainErrorButton;
