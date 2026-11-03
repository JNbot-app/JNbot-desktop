import { useState } from 'react';
import { Button, Dropdown, Input, Modal } from 'antd';
import {
  DownOutlined,
  FileOutlined,
  ImportOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { parseShareId } from '../../../common/share';
import useAppApi from '../../hooks/useAppApi';
import { useOpenShareLink } from './useShareTarget';

/** One Import button: pick a file, or paste a share link to review and install it. */
const ImportButton: React.FC<{ onImportFile: () => void }> = ({
  onImportFile,
}) => {
  const { message } = useAppApi();
  const openShareLink = useOpenShareLink();
  const [linkOpen, setLinkOpen] = useState(false);

  const submit = (value: string) => {
    const id = parseShareId(value);
    if (!id) {
      message.error('This is not a valid JNbot share link.');
      return;
    }
    setLinkOpen(false);
    openShareLink(id);
  };

  return (
    <>
      <Dropdown
        trigger={['click']}
        menu={{
          items: [
            { key: 'file', icon: <FileOutlined />, label: 'From file' },
            { key: 'link', icon: <LinkOutlined />, label: 'From link' },
          ],
          onClick: ({ key }) =>
            key === 'file' ? onImportFile() : setLinkOpen(true),
        }}
      >
        <Button icon={<ImportOutlined />}>
          Import <DownOutlined />
        </Button>
      </Dropdown>
      <Modal
        open={linkOpen}
        onCancel={() => setLinkOpen(false)}
        title="Import from link"
        footer={null}
        destroyOnHidden
      >
        <Input.Search
          autoFocus
          placeholder="Paste a share link"
          enterButton="Open"
          onSearch={submit}
        />
      </Modal>
    </>
  );
};

export default ImportButton;
