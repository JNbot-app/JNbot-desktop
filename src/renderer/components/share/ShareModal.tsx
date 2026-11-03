import { useEffect, useState } from 'react';
import { Button, Flex, Input, Modal, Popconfirm, Segmented, Space, Typography, theme } from 'antd';
import { CopyOutlined, DeleteOutlined, LinkOutlined, ShopOutlined } from '@ant-design/icons';
import {
  SHARE_KIND_LABELS,
  shareUrl,
  type OwnedShare,
  type ShareKind,
  type ShareVisibility,
} from '../../../common/share';
import useAppApi from '../../hooks/useAppApi';
import { refreshShares, useOwnedShare, useShares } from '../../redux/shares';
import ServerTargetSelect from './ServerTargetSelect';
import ShareStatusTag from './ShareStatusTag';
import shareRequest from './shareRequest';
import { useShareTarget, type ShareTarget } from './useShareTarget';

const close = () => useShareTarget.setState({ target: undefined });

/** Profiles are whole servers, so only the other kinds target servers. */
const targetsServers = (kind: ShareKind) => kind !== 'profile';

const sameServers = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

const VisibilityHelp: React.FC<{ kind: ShareKind; visibility: ShareVisibility }> = ({ kind, visibility }) => {
  const appVersion = useShares((state) => state.appVersion);
  const label = SHARE_KIND_LABELS[kind].toLowerCase();
  return (
    <Typography.Text type="secondary">
      {visibility === 'link'
        ? `Only people you send the link to can see and install this ${label}.`
        : `Everyone can find this ${label} on the marketplace once the JNbot team has reviewed it. Updates are reviewed too; the approved version stays live in the meantime.`}{' '}
      It is signed with your publisher name and needs JNbot {appVersion} or newer.
    </Typography.Text>
  );
};

const CopyLink: React.FC<{ id: string }> = ({ id }) => {
  const api = useAppApi();
  const url = shareUrl(id);
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    api.message.success('Link copied');
  };
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input readOnly value={url} prefix={<LinkOutlined />} onFocus={(event) => event.target.select()} />
      <Button icon={<CopyOutlined />} onClick={copy}>
        Copy
      </Button>
    </Space.Compact>
  );
};

interface Draft {
  visibility: ShareVisibility;
  servers: string[];
}

const PublishedShare: React.FC<{ share: OwnedShare; draft: Draft }> = ({ share, draft }) => {
  const { token } = theme.useToken();
  const api = useAppApi();
  const [hasChanges, setHasChanges] = useState<boolean | 'deleted' | undefined>();
  const [busy, setBusy] = useState<'publish' | 'delete' | null>(null);
  const isPublic = share.visibility === 'public';
  const visibilityChanged =
    draft.visibility !== share.visibility || (draft.visibility === 'public' && !sameServers(draft.servers, share.servers));

  useEffect(() => {
    void shareRequest<boolean | 'deleted'>(api, 'SHARE_HAS_CHANGES', share.id).then((result) =>
      setHasChanges(result ?? false),
    );
  }, [share.id, share.revision]);

  const run = async (action: string, input: unknown, success: string) => {
    setBusy('publish');
    if (await shareRequest(api, action, input)) api.message.success(success);
    setBusy(null);
  };

  const remove = async () => {
    setBusy('delete');
    if (await shareRequest(api, 'SHARE_DELETE', share.id)) {
      api.message.success('Share deleted');
      close();
    }
    setBusy(null);
  };

  const action = visibilityChanged ? (
    draft.visibility === 'public' ? (
      <Button
        type="primary"
        icon={<ShopOutlined />}
        loading={busy === 'publish'}
        disabled={hasChanges === 'deleted'}
        onClick={() => run('SHARE_VISIBILITY', { id: share.id, ...draft }, 'Submitted for review')}
      >
        {isPublic ? 'Save and submit for review' : 'Submit for review'}
      </Button>
    ) : (
      <Popconfirm
        title="Remove from the marketplace?"
        description="It stays available as a private link."
        okText="Remove"
        onConfirm={() => run('SHARE_VISIBILITY', { id: share.id, visibility: 'link' }, 'Removed from the marketplace')}
      >
        <Button loading={busy === 'publish'}>Remove from marketplace</Button>
      </Popconfirm>
    )
  ) : (
    <Button
      type="primary"
      disabled={hasChanges !== true}
      loading={busy === 'publish'}
      onClick={() => run('SHARE_UPDATE', share.id, isPublic ? 'Update submitted for review' : 'Share updated')}
    >
      {isPublic ? 'Submit update' : 'Publish update'}
    </Button>
  );

  return (
    <Flex vertical gap={token.marginSM}>
      <Flex align="center" gap={token.marginXS} wrap>
        <ShareStatusTag share={share} />
        <Typography.Text type="secondary" style={{ fontSize: token.fontSizeSM }}>
          Last published {new Date(share.updatedAt).toLocaleString()}
        </Typography.Text>
      </Flex>
      {share.note && <Typography.Text type="danger">Review note: {share.note}</Typography.Text>}
      <CopyLink id={share.id} />
      <Flex align="center" justify="space-between" gap={token.marginSM}>
        <Typography.Text type="secondary">
          {visibilityChanged
            ? ''
            : hasChanges === undefined
              ? 'Checking for changes…'
              : hasChanges === 'deleted'
                ? 'You deleted the original, so this share can no longer be updated. You can still delete it.'
                : hasChanges
                  ? 'You changed this since the last publish.'
                  : 'The share has your latest version.'}
        </Typography.Text>
        {action}
      </Flex>
      <Popconfirm
        title="Delete this share?"
        description="People can no longer install it. Copies they installed stay."
        okText="Delete"
        okButtonProps={{ danger: true }}
        onConfirm={remove}
      >
        <Button danger type="text" icon={<DeleteOutlined />} loading={busy === 'delete'} style={{ alignSelf: 'start' }}>
          Delete share
        </Button>
      </Popconfirm>
    </Flex>
  );
};

const NewShare: React.FC<{ target: ShareTarget; draft: Draft }> = ({ target, draft }) => {
  const api = useAppApi();
  const [creating, setCreating] = useState(false);
  const { title: _title, ...input } = target;

  const create = async () => {
    setCreating(true);
    await shareRequest(api, 'SHARE_CREATE', { ...input, ...draft });
    setCreating(false);
  };

  return (
    <Button
      type="primary"
      icon={draft.visibility === 'public' ? <ShopOutlined /> : <LinkOutlined />}
      loading={creating}
      onClick={create}
      style={{ alignSelf: 'end' }}
    >
      {draft.visibility === 'public' ? 'Submit for review' : 'Create link'}
    </Button>
  );
};

/** Share one item as a private link or on the marketplace, and manage it. */
const ShareModal: React.FC = () => {
  const { token } = theme.useToken();
  const target = useShareTarget((state) => state.target);
  const owned = useOwnedShare(target?.kind ?? 'plugin', target?.ref ?? '', target?.profileKey);
  const [draft, setDraft] = useState<Draft>({ visibility: 'link', servers: [] });

  useEffect(() => {
    if (target) refreshShares();
  }, [target]);
  useEffect(() => {
    setDraft({ visibility: owned?.visibility ?? 'link', servers: owned?.servers ?? [] });
  }, [owned?.id, owned?.visibility, owned?.servers]);

  return (
    <Modal
      open={!!target}
      title={target ? `Share ${target.title}` : undefined}
      onCancel={close}
      footer={null}
      destroyOnHidden
    >
      {target && (
        <Flex vertical gap={token.marginMD}>
          <Segmented<ShareVisibility>
            block
            value={draft.visibility}
            onChange={(visibility) => setDraft({ ...draft, visibility })}
            options={[
              { value: 'link', label: 'Private link', icon: <LinkOutlined /> },
              { value: 'public', label: 'Marketplace', icon: <ShopOutlined /> },
            ]}
          />
          <VisibilityHelp kind={target.kind} visibility={draft.visibility} />
          {draft.visibility === 'public' && targetsServers(target.kind) && (
            <Flex vertical gap={token.marginXXS}>
              <Typography.Text strong>Show it on</Typography.Text>
              <ServerTargetSelect value={draft.servers} onChange={(servers) => setDraft({ ...draft, servers })} />
            </Flex>
          )}
          {owned ? <PublishedShare share={owned} draft={draft} /> : <NewShare target={target} draft={draft} />}
        </Flex>
      )}
    </Modal>
  );
};

export default ShareModal;
