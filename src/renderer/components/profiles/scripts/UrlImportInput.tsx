import { FC, useState } from 'react';
import { Button, Input, Space, message as antdMessage } from 'antd';
import { LinkOutlined } from '@ant-design/icons';
import { importFromUrl, type ImportedSource } from './scriptImport';

interface Props {
  /** Called with the staged source once a valid plugin is downloaded. */
  onImported: (result: ImportedSource) => void;
  /** pluginIds already present — used to reject duplicates after fetch. */
  existingPluginIds?: Set<string>;
}

/**
 * Shared "add from URL" field: a single input that downloads, validates and
 * stages a remote plugin (via [[importFromUrl]]) and emits the resulting
 * source. Used by the Add-script modal and the profile-action picker so the
 * fetch/validation/duplicate handling lives in exactly one place.
 */
const UrlImportInput: FC<Props> = ({ onImported, existingPluginIds }) => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);

  const add = async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    const res = await importFromUrl(trimmed);
    setLoading(false);
    if (!res.ok) {
      antdMessage.error(res.error ?? 'Could not import from that URL');
      return;
    }
    if (existingPluginIds?.has(res.result.pluginId)) {
      antdMessage.info('This plugin is already on the profile');
      return;
    }
    setUrl('');
    onImported(res.result);
  };

  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        prefix={<LinkOutlined />}
        placeholder="https://example.com/plugin.jnp"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onPressEnter={add}
        allowClear
        disabled={loading}
      />
      <Button type="primary" loading={loading} onClick={add} disabled={!url.trim()}>
        Add
      </Button>
    </Space.Compact>
  );
};

export default UrlImportInput;
