import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  useSettingsStore,
  selectActiveServerId,
  selectAlts,
  selectJNdata,
  selectSharedAlts,
  saveAlt,
} from '../../redux/settings';
import {
  Alert,
  Button,
  Modal,
  Typography,
  Upload,
  Checkbox,
  Table,
  Tabs,
  Input,
  Select,
  Space,
  Divider,
  Tag,
  Transfer,
  theme,
} from 'antd';
import {
  DeleteOutlined,
  ImportOutlined,
  EditOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { RcFile } from 'antd/lib/upload/interface';
import useAppApi from '../../hooks/useAppApi';
import type { AltWithData, ServerAltInfo } from '../../../main/src/types';
import { getAllServerMeta, getServerMeta } from '../../../common/serverInfo';
import { accountAuthenticationError } from '../../../common/serverAuthentication';
import SharedAltImportTable from './SharedAltImportTable';

export type ImportEntry = {
  username: string;
  premium: boolean;
  UID: string | null;
  email?: string;
  password: string;
  ranks: Record<string, string>;
  gkits: Record<string, string[]>;
};

// Cells are memoized on primitive props so that typing into one row's password
// doesn't re-render the other 200+ rows. The handlers passed in must be stable
// (see the useCallback wrappers below) for the memo to actually hold.
const UsernameCell = memo(function UsernameCell({
  username,
}: {
  username: string;
}) {
  return <Typography.Text strong>{username}</Typography.Text>;
});

const DeleteCell = memo(function DeleteCell({
  username,
  onDelete,
}: {
  username: string;
  onDelete: (username: string) => void;
}) {
  return (
    <Button
      danger
      type="text"
      icon={<DeleteOutlined />}
      onClick={() => onDelete(username)}
    />
  );
});

const ImportAlts: React.FC = () => {
  const { token } = theme.useToken();
  const { message } = useAppApi();

  const JNdata = useSettingsStore(selectJNdata);
  const existingAlts = useSettingsStore(selectAlts);
  const sharedAlts = useSettingsStore(selectSharedAlts);

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'file' | 'profile' | 'shared'>('file');

  const [importRanksGkits, setImportRanksGkits] = useState(true);
  const [importedEntries, setImportedEntries] = useState<ImportEntry[]>([]);
  const [sourceProfileId, setSourceProfileId] = useState<string | null>(null);
  const [transferTargetKeys, setTransferTargetKeys] = useState<string[]>([]);
  const [transferSelectedKeys, setTransferSelectedKeys] = useState<string[]>(
    [],
  );
  const [profileAltsCache, setProfileAltsCache] = useState<
    Record<string, AltWithData[]>
  >({});
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [sharedSelectedUsernames, setSharedSelectedUsernames] = useState<string[]>(
    [],
  );

  const destinationProfileId = useSettingsStore(selectActiveServerId) ?? '';
  const destinationMeta = getServerMeta(JNdata, destinationProfileId);
  const onlineMode = destinationMeta.onlineMode;
  const allProfiles = useMemo(() => getAllServerMeta(JNdata), [JNdata]);
  const profileMatches =
    sourceProfileId !== null && sourceProfileId === destinationProfileId;
  const canImportRanksGkits = profileMatches && importRanksGkits;

  const isImportable = (entry: ImportEntry) =>
    accountAuthenticationError(
      {
        premium: entry.premium,
        password: entry.password,
      },
      onlineMode,
    ) === null;

  // Shared identities that exist across servers but aren't part of the active
  // profile yet — these can't be reached through the "From another profile"
  // tab when they don't belong to any other profile either.
  const importableSharedAlts = useMemo(() => {
    const inProfile = new Set(existingAlts.map((a) => a.username));
    return sharedAlts.filter(
      (alt) =>
        !inProfile.has(alt.username) &&
        (!onlineMode ||
          accountAuthenticationError(
            { premium: true},
            true,
          ) === null),
    );
  }, [sharedAlts, existingAlts, onlineMode]);

  const sharedSelection = new Set(sharedSelectedUsernames);
  const selectedSharedEntries =
    mode === 'shared'
      ? importedEntries.filter(
          (entry) => sharedSelection.has(entry.username) && isImportable(entry),
        )
      : [];

  const pendingCount =
    mode === 'profile'
      ? transferTargetKeys.length
      : mode === 'shared'
        ? selectedSharedEntries.length
        : importedEntries.length;

  const getGamemodes = (profile: string): string[] =>
    Object.keys(JNdata.servers[profile] || {});

  const getRanksForGamemode = (profile: string, gamemode: string): string[] => {
    const gd = JNdata.servers[profile]?.[gamemode];
    if (!gd || typeof gd !== 'object' || !('ranks' in gd)) return [];
    return Object.keys(gd.ranks || {});
  };

  const getGkitsForGamemode = (profile: string, gamemode: string): string[] => {
    const gd = JNdata.servers[profile]?.[gamemode];
    if (!gd || typeof gd !== 'object' || !('gkits' in gd)) return [];
    return Object.keys(gd.gkits || {});
  };

  const resetImport = () => {
    setImportedEntries([]);
    setProfileAltsCache({});
    setSharedSelectedUsernames([]);
    setSourceProfileId(null);
    setTransferTargetKeys([]);
    setTransferSelectedKeys([]);
  };

  const closeModal = () => {
    resetImport();
    setMode('file');
    setOpen(false);
  };

  const extractEntriesFromJson = (
    raw: any,
  ): { entries: ImportEntry[]; srcProfile: string | null } => {
    let altsArray: any;
    let srcProfile: string | null;

    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      Array.isArray(raw.alts)
    ) {
      altsArray = raw.alts;
      srcProfile = typeof raw.profileId === 'string' ? raw.profileId : null;
    } else {
      altsArray = raw;
      if (!Array.isArray(altsArray)) {
        altsArray =
          raw?.accounts ||
          raw?.users ||
          raw?.players ||
          raw?.profiles ||
          raw?.data ||
          (raw && typeof raw === 'object' ? Object.values(raw) : null);
      }
      // Legacy bare-array exports had no profile id — we cannot safely assume
      // ranks/gkits belong to the active server, so treat as unknown.
      srcProfile = null;
    }

    if (!Array.isArray(altsArray) || altsArray.length === 0) {
      throw new Error('Could not find any alts.');
    }

    const lookupKey = srcProfile ?? destinationProfileId;

    const entries: ImportEntry[] = altsArray
      .map((a: any) => {
        const username: string = (a.username || a.name || '').toString();
        // Resolve the server-specific data: new exports carry `data` on the
        // alt; legacy ones nested it under the profile id (or any sibling
        // server id when no profileId was set).
        let serverData: Partial<ServerAltInfo> & { password?: string } =
          (a.data && typeof a.data === 'object' ? a.data : a[lookupKey]) || {};
        if (!serverData.password) {
          const legacy = allProfiles
            .map((p) => a[p.id])
            .find((d) => d?.password);
          if (legacy) serverData = legacy;
        }
        const password = serverData.password || a.password || '';
        const ranks = serverData.ranks || {};
        const gkits = serverData.gkits || {};
        return {
          username,
          premium: serverData.premium ?? a.premium ?? false,
          UID: a.UID ?? null,
          email: a.email,
          password,
          ranks: ranks && typeof ranks === 'object' ? ranks : {},
          gkits: gkits && typeof gkits === 'object' ? gkits : {},
        } as ImportEntry;
      })
      .filter((e) =>
        e.username.length >= 3 &&
        e.username.length <= 24 &&
        isImportable(e),
      );

    return { entries, srcProfile };
  };

  const fileHandler = (file: RcFile) => {
    const reader = new FileReader();
    reader.onerror = (e) => console.error(e);
    reader.onload = (e) => {
      const text = ((e.target?.result ?? '') as string).trim();

      try {
        const parsed = JSON.parse(text);
        const { entries, srcProfile } = extractEntriesFromJson(parsed);
        setSourceProfileId(srcProfile);
        setImportedEntries(entries);
        message.success(`${entries.length} alts loaded.`);
        return;
      } catch (err) {
        // Fall through to text parsing.
        console.debug('JSON parse failed, trying text format:', err);
      }

      try {
        const entries: ImportEntry[] = text
          .split('\n')
          .map((line) => {
            const [username, ...passwordParts] = line.trim().split(/\s+/);
            if (!username) return null;
            const password = passwordParts.join(' ');
            return {
              username: username.trim(),
              premium: false,
              UID: null,
              email: undefined,
              password: password.trim(),
              ranks: {},
              gkits: {},
            } as ImportEntry;
          })
          .filter(Boolean)
          .filter(
            (e) =>
              e!.username.length >= 3 &&
              e!.username.length <= 24 &&
              isImportable(e!),
          ) as ImportEntry[];

        // Plain-text exports have no ranks/gkits and no profile id — line them
        // up with the destination so the password lands under the active server.
        setSourceProfileId(destinationProfileId);
        setImportedEntries(entries);
        message.success(`${entries.length} alts loaded.`);
      } catch (err) {
        console.error(err);
        message.error('Failed to import alts.');
      }
    };
    reader.readAsText(file);
    return false;
  };

  /**
   * Alts the renderer has on hand for `profileId`. The active profile lives
   * in redux; other profiles' per-server data isn't kept client-side after
   * the alt-data split, so we cache anything fetched from the main process
   * here. Returns `undefined` when we haven't fetched yet — the caller can
   * decide whether to request it.
   */
  const altsAvailableUnderProfile = (
    profileId: string,
  ): AltWithData[] | undefined => {
    if (profileId === destinationProfileId) {
      return existingAlts;
    }
    return profileAltsCache[profileId];
  };

  const buildEntriesFromAlts = (alts: AltWithData[]): ImportEntry[] =>
    alts.map((a) => {
      const sd = a.data ?? { password: '', ranks: {}, gkits: {} };
      return {
        username: a.username,
        premium: a.data?.premium === true,
        UID: a.UID ?? null,
        password: sd.password || '',
        ranks: sd.ranks || {},
        gkits: sd.gkits || {},
      };
    });

  const loadFromProfile = async (profileId: string) => {
    setSourceProfileId(profileId);
    setTransferTargetKeys([]);
    setTransferSelectedKeys([]);

    const cached = altsAvailableUnderProfile(profileId);
    if (cached !== undefined) {
      setImportedEntries(buildEntriesFromAlts(cached));
      return;
    }

    setLoadingProfile(true);
    setImportedEntries([]);
    try {
      const alts = await window.ipcRenderer.get(
        'ALTS_OF_PROFILE',
        { profileKey: profileId },
      );
      setProfileAltsCache((c) => ({ ...c, [profileId]: alts || [] }));
      setImportedEntries(buildEntriesFromAlts(alts || []));
    } catch (err) {
      console.error(err);
      message.error('Failed to load alts from profile.');
    } finally {
      setLoadingProfile(false);
    }
  };

  /** Entries that actually get persisted on save, depending on the mode. */
  const entriesToPersist = (): ImportEntry[] => {
    if (mode === 'profile') {
      const set = new Set(transferTargetKeys);
      return importedEntries.filter((e) => set.has(e.username));
    }
    // Shared accounts use the same authentication rules as other imports.
    if (mode === 'shared') {
      return selectedSharedEntries;
    }
    return importedEntries;
  };

  const save = () => {
    let added = 0;
    let updated = 0;
    entriesToPersist().forEach((entry) => {
      const { username, password } = entry;
      if (!username || username.length < 3 || username.length > 24) {
        message.error(`Invalid username: ${username}`);
        return;
      }
      const authenticationError = accountAuthenticationError(
        { premium: entry.premium, password },
        onlineMode,
      );
      if (authenticationError) {
        message.error(`${username}: ${authenticationError}`);
        return;
      }

      const serverData: ServerAltInfo = {
        premium: entry.premium,
        password,
        ranks: canImportRanksGkits ? entry.ranks : {},
        gkits: canImportRanksGkits ? entry.gkits : {},
      };

      const existing = existingAlts.find((a) => a.username === username);

      if (existing) {
        const merged: AltWithData = {
          username: existing.username,
          UID: existing.UID ?? entry.UID,
          data: serverData,
        };
        saveAlt({ alt: merged, originalUsername: username });
        updated++;
      } else {
        const newAlt: AltWithData = {
          username,
          UID: entry.UID,
          data: serverData,
        };
        saveAlt({ alt: newAlt });
        added++;
      }
    });

    if (added + updated > 0) {
      message.success(
        `Imported ${added + updated} alt${added + updated !== 1 ? 's' : ''} into ${destinationMeta.shortName || destinationProfileId} (${added} new, ${updated} updated).`,
      );
    }
    closeModal();
  };

  const updateEntryRank = (
    username: string,
    gamemode: string,
    rank: string | null,
  ) => {
    setImportedEntries((curr) =>
      curr.map((e) => {
        if (e.username !== username) return e;
        const ranks = { ...e.ranks };
        if (rank) ranks[gamemode] = rank;
        else delete ranks[gamemode];
        return { ...e, ranks };
      }),
    );
  };

  const updateEntryGkits = (
    username: string,
    gamemode: string,
    gkits: string[],
  ) => {
    setImportedEntries((curr) =>
      curr.map((e) =>
        e.username === username
          ? { ...e, gkits: { ...e.gkits, [gamemode]: gkits } }
          : e,
      ),
    );
  };

  const updatePassword = useCallback((username: string, password: string) => {
    setImportedEntries((curr) =>
      curr.map((e) => (e.username === username ? { ...e, password } : e)),
    );
  }, []);

  const delEntry = useCallback((username: string) => {
    setImportedEntries((curr) => curr.filter((e) => e.username !== username));
  }, []);

  const renderExpand = (entry: ImportEntry) => {
    const gamemodes = getGamemodes(destinationProfileId);
    return (
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Typography.Text strong>
            Password (for {destinationMeta.shortName || destinationProfileId}):
          </Typography.Text>
          <Input.Password
            placeholder="Password"
            value={entry.password}
            onChange={(e) => updatePassword(entry.username, e.target.value)}
            style={{ marginTop: 8 }}
          />
        </div>

        {canImportRanksGkits && gamemodes.length > 0 && (
          <>
            <Divider style={{ margin: '12px 0' }} />
            <Typography.Text strong>Ranks & GKits:</Typography.Text>
            <Space
              orientation="vertical"
              style={{ width: '100%' }}
              size="small"
            >
              {gamemodes.map((gm) => {
                const ranks = getRanksForGamemode(destinationProfileId, gm);
                const gkits = getGkitsForGamemode(destinationProfileId, gm);
                if (ranks.length === 0 && gkits.length === 0) return null;
                return (
                  <div key={gm} style={{ padding: '8px 0' }}>
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: '0.9em' }}
                    >
                      {gm}
                    </Typography.Text>
                    <Space
                      orientation="vertical"
                      style={{ width: '100%', marginTop: 4 }}
                      size="small"
                    >
                      {ranks.length > 0 && (
                        <Select
                          placeholder="Select rank"
                          value={entry.ranks?.[gm] || undefined}
                          onChange={(v) =>
                            updateEntryRank(
                              entry.username,
                              gm,
                              (v as string) || null,
                            )
                          }
                          style={{ width: '100%' }}
                          allowClear
                          size="small"
                        >
                          {ranks.map((r) => (
                            <Select.Option key={r} value={r}>
                              {r}
                            </Select.Option>
                          ))}
                        </Select>
                      )}
                      {gkits.length > 0 && (
                        <Select
                          mode="multiple"
                          placeholder="Select gkits"
                          value={entry.gkits?.[gm] || []}
                          onChange={(v) =>
                            updateEntryGkits(entry.username, gm, v as string[])
                          }
                          style={{ width: '100%' }}
                          size="small"
                          maxTagCount="responsive"
                        >
                          {gkits.map((g) => (
                            <Select.Option key={g} value={g}>
                              {g}
                            </Select.Option>
                          ))}
                        </Select>
                      )}
                    </Space>
                  </div>
                );
              })}
            </Space>
          </>
        )}
      </Space>
    );
  };

  const columns = useMemo(
    () => [
      {
        title: 'Username',
        dataIndex: 'username',
        key: 'username',
        width: 200,
        render: (text: string) => <UsernameCell username={text} />,
      },
      {
        title: 'Actions',
        key: 'actions',
        width: 100,
        align: 'right' as const,
        render: (_: unknown, record: ImportEntry) => (
          <DeleteCell username={record.username} onDelete={delEntry} />
        ),
      },
    ],
    [delEntry],
  );

  const profileBanner = importedEntries.length > 0 &&
    sourceProfileId !== null && (
      <Alert
        type={profileMatches ? 'success' : 'warning'}
        showIcon
        title={
          profileMatches ? (
            <>
              Source profile{' '}
              <Tag color="green">
                {getServerMeta(JNdata, sourceProfileId).shortName ||
                  sourceProfileId}
              </Tag>{' '}
              matches the active profile — ranks & gkits will be imported.
            </>
          ) : (
            <>
              Source profile{' '}
              <Tag>
                {getServerMeta(JNdata, sourceProfileId).shortName ||
                  sourceProfileId}
              </Tag>{' '}
              differs from the active profile{' '}
              <Tag color="blue">
                {destinationMeta.shortName || destinationProfileId}
              </Tag>
              . Only usernames and passwords will be imported; ranks & gkits are
              dropped because they don't transfer between profiles.
            </>
          )
        }
      />
    );

  const unknownProfileBanner = mode === 'file' &&
    importedEntries.length > 0 &&
    sourceProfileId === null && (
      <Alert
        type="warning"
        showIcon
        title="This file doesn't include a profile id — ranks & gkits will not be imported."
      />
    );

  const previewTable = (
    <>
      {profileBanner}
      {unknownProfileBanner}
      <Typography.Title level={5} style={{ marginTop: 16, marginBottom: 8 }}>
        Preview ({importedEntries.length})
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        <EditOutlined /> Click a row to expand and edit password
        {canImportRanksGkits ? ', ranks, and gkits' : ''}.
      </Typography.Paragraph>
      <Table
        columns={columns}
        dataSource={importedEntries}
        rowKey="username"
        expandable={{
          expandedRowRender: renderExpand,
          expandRowByClick: true,
        }}
        pagination={false}
        size="small"
        scroll={{ y: 400 }}
      />
      <Button
        type="link"
        onClick={resetImport}
        style={{ marginTop: 8, paddingLeft: 0 }}
      >
        Clear and start over
      </Button>
    </>
  );

  const fileTab = (
    <Space orientation="vertical" style={{ width: '100%' }} size="large">
      <div>
        <Typography.Paragraph type="secondary">
          Upload a .txt or .json file containing alts. JSON exports include a
          <Tag style={{ margin: '0 4px' }}>profileId</Tag>— when it matches the
          active profile ({destinationMeta.shortName || destinationProfileId}),
          ranks and gkits are imported as well.
        </Typography.Paragraph>
        <Typography.Paragraph>
          <strong>Text format:</strong>
          <pre
            style={{
              padding: 12,
              borderRadius: 4,
              backgroundColor: token.colorBgContainer,
              border: `1px solid ${token.colorBorder}`,
              marginTop: 8,
            }}
          >
            username1 password1{'\n'}username2 password2
          </pre>
        </Typography.Paragraph>
        <Typography.Paragraph>
          <strong>JSON format:</strong>
          <pre
            style={{
              padding: 12,
              borderRadius: 4,
              backgroundColor: token.colorBgContainer,
              border: `1px solid ${token.colorBorder}`,
              marginTop: 8,
            }}
          >
            {`{
  "version": 1,
  "profileId": "${destinationProfileId}",
  "alts": [
    { "username": "player1", "${destinationProfileId}": { "password": "..." } }
  ]
}`}
          </pre>
        </Typography.Paragraph>

        {profileMatches && (
          <Checkbox
            checked={importRanksGkits}
            onChange={(e) => setImportRanksGkits(e.target.checked)}
            style={{ marginBottom: 16 }}
          >
            Import ranks and gkits data (if present)
          </Checkbox>
        )}

        {importedEntries.length === 0 && (
          <Upload
            beforeUpload={fileHandler}
            accept=".txt,.json"
            showUploadList={false}
          >
            <Button type="primary" icon={<ImportOutlined />} block>
              Choose file to import
            </Button>
          </Upload>
        )}
      </div>

      {importedEntries.length > 0 && (
        <>
          <Divider style={{ margin: 0 }} />
          {previewTable}
        </>
      )}
    </Space>
  );

  const profileOptions = allProfiles
    .filter((p) => p.id !== destinationProfileId)
    .map((p) => {
      const cached = altsAvailableUnderProfile(p.id);
      const suffix = cached === undefined ? '' : ` (${cached.length} alts)`;
      return {
        value: p.id,
        label: `${p.name || p.id}${suffix}`,
        disabled: cached !== undefined && cached.length === 0,
      };
    });

  const transferDataSource = useMemo(
    () =>
      importedEntries.map((e) => ({
        key: e.username,
        title: e.username,
      })),
    [importedEntries],
  );

  const handleTransferChange = (nextTargetKeys: React.Key[]) => {
    setTransferTargetKeys(nextTargetKeys.map(String));
  };

  const handleTransferSelectChange = (
    sourceSelectedKeys: React.Key[],
    targetSelectedKeys: React.Key[],
  ) => {
    setTransferSelectedKeys(
      [...sourceSelectedKeys, ...targetSelectedKeys].map(String),
    );
  };

  const sourceMeta = sourceProfileId
    ? getServerMeta(JNdata, sourceProfileId)
    : null;

  const renderTransferItem = (item: { key: string; title: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <img
        src={`https://crafthead.net/avatar/${item.title}`}
        alt={item.title}
        width={20}
        height={20}
        style={{ borderRadius: 3, flexShrink: 0 }}
      />
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.title}
      </span>
    </div>
  );

  const profileTab = (
    <Space orientation="vertical" style={{ width: '100%' }} size="large">
      <div>
        <Typography.Paragraph type="secondary">
          Copy alts from another profile into the active profile (
          <Tag color="blue">
            {destinationMeta.shortName || destinationProfileId}
          </Tag>
          ). Usernames and passwords are copied; ranks and gkits stay behind
          because they belong to a different server.
        </Typography.Paragraph>

        <Typography.Text strong>Source profile:</Typography.Text>
        <Select
          placeholder="Pick a profile to transfer alts from"
          options={profileOptions}
          value={sourceProfileId ?? undefined}
          onChange={(v) => loadFromProfile(v as string)}
          style={{ width: '100%', marginTop: 8 }}
          disabled={profileOptions.length === 0 || loadingProfile}
          loading={loadingProfile}
        />
        {profileOptions.length === 0 && (
          <Typography.Text
            type="secondary"
            style={{ display: 'block', marginTop: 8 }}
          >
            No other profiles with alts are available.
          </Typography.Text>
        )}
      </div>

      {sourceProfileId && (
        <>
          <Divider style={{ margin: 0 }} />
          <div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              Move alts from the left (
              <strong>{sourceMeta?.shortName || sourceProfileId}</strong>) to
              the right to mark them for transfer into{' '}
              <strong>
                {destinationMeta.shortName || destinationProfileId}
              </strong>
              .
            </Typography.Paragraph>
            <Transfer
              dataSource={transferDataSource}
              targetKeys={transferTargetKeys}
              selectedKeys={transferSelectedKeys}
              onChange={handleTransferChange}
              onSelectChange={handleTransferSelectChange}
              render={renderTransferItem as any}
              showSearch
              filterOption={(input, item) =>
                (item.title ?? '').toLowerCase().includes(input.toLowerCase())
              }
              titles={[
                `Available in ${sourceMeta?.shortName || sourceProfileId}`,
                `To transfer`,
              ]}
              locale={{
                itemUnit: 'alt',
                itemsUnit: 'alts',
                searchPlaceholder: 'Search alts…',
              }}
              styles={{
                section: {
                   width: 360, height: 360
                }
              }}
              oneWay={false}
            />
            {transferDataSource.length === 0 && !loadingProfile && (
              <Typography.Text type="secondary">
                The selected profile has no alts to transfer.
              </Typography.Text>
            )}
          </div>
        </>
      )}
    </Space>
  );

  // Seed the preview list from the shared identities, leaving the password
  // blank for the user to fill in. Ranks/gkits don't carry over.
  const loadSharedAlts = () => {
    setSourceProfileId(null);
    setImportedEntries(
      importableSharedAlts.map((a) => ({
        username: a.username,
        premium: onlineMode,
        UID: a.UID ?? null,
        password: '',
        ranks: {},
        gkits: {},
      })),
    );
  };

  const sharedTab = (
    <Space orientation="vertical" style={{ width: '100%' }} size="large">
      <Typography.Paragraph type="secondary">
        Add accounts that already exist but aren't part of{' '}
        <Tag color="blue">
          {destinationMeta.shortName || destinationProfileId}
        </Tag>{' '}
        yet. Select the alts to import, then enter any server passwords you need.
        Passwords are optional. Ranks and gkits aren't copied.
      </Typography.Paragraph>

      <SharedAltImportTable
        entries={importedEntries}
        selectedUsernames={sharedSelectedUsernames}
        onlineMode={onlineMode}
        onSelectionChange={setSharedSelectedUsernames}
        onPasswordChange={updatePassword}
      />
    </Space>
  );

  return (
    <>
      <Button type="default" onClick={() => setOpen(true)}>
        <ImportOutlined style={{ marginRight: 8 }} /> Import
      </Button>
      <Modal
        title={`Import alts into ${destinationMeta.shortName || destinationProfileId}`}
        open={open}
        onCancel={closeModal}
        width={mode === 'profile' ? 960 : 900}
        footer={[
          <Button key="cancel" onClick={closeModal}>
            Cancel
          </Button>,
          <Button
            key="submit"
            type="primary"
            disabled={pendingCount === 0}
            onClick={save}
          >
            Add {pendingCount} Alt{pendingCount !== 1 ? 's' : ''}
          </Button>,
        ]}
      >
        <Tabs
          activeKey={mode}
          onChange={(k) => {
            const next = k as 'file' | 'profile' | 'shared';
            setMode(next);
            resetImport();
            if (next === 'shared') loadSharedAlts();
          }}
          items={[
            {
              key: 'file',
              label: (
                <span>
                  <ImportOutlined /> From file
                </span>
              ),
              children: fileTab,
            },
            {
              key: 'profile',
              label: (
                <span>
                  <SwapOutlined /> From another profile
                </span>
              ),
              children: profileTab,
            },
            {
              key: 'shared',
              label: (
                <span>
                  <SwapOutlined /> Existing accounts
                </span>
              ),
              children: sharedTab,
            },
          ]}
        />
      </Modal>
    </>
  );
};

export default ImportAlts;
