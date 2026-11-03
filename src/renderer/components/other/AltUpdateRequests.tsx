import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Empty,
  Modal,
  Space,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import {
  useSettingsStore,
  applyAltUpdates,
  selectAlts,
  selectJNDataByServer,
} from '../../redux/settings';
import type { AltWithData, ServerAltInfo } from '../../../main/src/types';

/**
 * Partial<ServerAltInfo> per alt. `ranks[gm] === null` means "clear that
 * gamemode's rank" — fields not present are left untouched on apply.
 */
export type AltUpdate = {
  password?: string;
  ranks?: { [gamemode: string]: string | null };
  gkits?: { [gamemode: string]: string[] };
};
export type AltUpdates = Record<string, AltUpdate | null>;

export interface AltUpdateRequest {
  id: string;
  scriptName: string;
  scriptId?: string;
  updates: AltUpdates;
}

type FieldKey =
  | { kind: 'remove' }
  | { kind: 'password' }
  | { kind: 'rank'; gamemode: string }
  | { kind: 'gkits'; gamemode: string };

interface ChangeRow {
  field: FieldKey;
  label: string;
  current: React.ReactNode;
  next: React.ReactNode;
  error?: string;
  /** Field is present in the request but matches current state — show greyed-out and skip. */
  noop?: boolean;
}

interface AltGroup {
  username: string;
  action: 'add' | 'update' | 'remove';
  rows: ChangeRow[];
}

const fieldId = (username: string, f: FieldKey): string => {
  if (f.kind === 'remove') return `${username}::remove`;
  if (f.kind === 'password') return `${username}::password`;
  return `${username}::${f.kind}::${f.gamemode}`;
};

const altServerInfo = (
  alt: AltWithData | undefined,
): ServerAltInfo | undefined => alt?.data;

const arraysEqual = (a: string[] = [], b: string[] = []) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const GkitList: React.FC<{ items: string[]; highlight?: boolean }> = ({
  items,
  highlight,
}) => {
  if (!items?.length) return <span>—</span>;
  return (
    <Space size={4} wrap>
      {items.map((g) => (
        <Tag key={g} color={highlight ? 'blue' : undefined}>
          {g}
        </Tag>
      ))}
    </Space>
  );
};

const buildRows = (
  update: AltUpdate,
  current: ServerAltInfo | undefined,
  gmData: Record<string, any>,
  adding = false,
): ChangeRow[] => {
  const rows: ChangeRow[] = [];
  const gmKnown = (gm: string) =>
    Object.prototype.hasOwnProperty.call(gmData, gm.toLowerCase());
  if (adding && !('password' in update)) {
    rows.push({
      field: { kind: 'password' },
      label: 'Password',
      current: <em>not set</em>,
      next: <Tag color="red">missing</Tag>,
      error: 'A password is required to add an alt',
    });
  } else if ('password' in update) {
    const pwd = update.password;
    if (typeof pwd !== 'string' || pwd.length === 0) {
      rows.push({
        field: { kind: 'password' },
        label: 'Password',
        current: '—',
        next: <Tag color="red">empty</Tag>,
        error: 'Password is empty',
      });
    } else if (current?.password === pwd) {
      rows.push({
        field: { kind: 'password' },
        label: 'Password',
        current: '••••••••',
        next: '••••••••',
        noop: true,
      });
    } else {
      rows.push({
        field: { kind: 'password' },
        label: 'Password',
        current: current?.password ? '••••••••' : <em>not set</em>,
        next: '•'.repeat(Math.min(pwd.length, 10)),
      });
    }
  }

  if (update.ranks) {
    for (const [gm, rank] of Object.entries(update.ranks)) {
      const field: FieldKey = { kind: 'rank', gamemode: gm };
      const label = `Rank · ${gm}`;
      if (!gmKnown(gm)) {
        rows.push({
          field,
          label,
          current: '—',
          next: <Tag color="red">{String(rank ?? 'clear')}</Tag>,
          error: `Unknown gamemode "${gm}"`,
        });
        continue;
      }
      const curr = current?.ranks?.[gm];
      if (rank == null) {
        if (curr == null) {
          rows.push({ field, label, current: '—', next: '—', noop: true });
          continue;
        }
        rows.push({
          field,
          label,
          current: <Tag>{curr}</Tag>,
          next: <Tag color="red">remove</Tag>,
        });
        continue;
      }
      const knownRank = Object.prototype.hasOwnProperty.call(
        gmData[gm.toLowerCase()]?.ranks ?? {},
        rank,
      );
      if (curr === rank) {
        rows.push({
          field,
          label,
          current: <Tag>{rank}</Tag>,
          next: <Tag>{rank}</Tag>,
          noop: true,
        });
        continue;
      }
      rows.push({
        field,
        label,
        current: curr ? <Tag>{curr}</Tag> : '—',
        next: <Tag color={knownRank ? 'blue' : 'orange'}>{rank}</Tag>,
        error: knownRank ? undefined : `Unknown rank "${rank}"`,
      });
    }
  }

  if (update.gkits) {
    for (const [gm, list] of Object.entries(update.gkits)) {
      const field: FieldKey = { kind: 'gkits', gamemode: gm };
      const label = `Gkits · ${gm}`;
      if (!Array.isArray(list)) continue;
      if (!gmKnown(gm)) {
        rows.push({
          field,
          label,
          current: '—',
          next: <Tag color="red">{list.length}</Tag>,
          error: `Unknown gamemode "${gm}"`,
        });
        continue;
      }
      const known = gmData[gm.toLowerCase()]?.gkits ?? {};
      const unknown = list.filter(
        (g) => !Object.prototype.hasOwnProperty.call(known, g),
      );
      const curr = current?.gkits?.[gm] ?? [];
      if (arraysEqual(curr, list)) {
        rows.push({
          field,
          label,
          current: <Tag>{curr.length}</Tag>,
          next: <Tag>{list.length}</Tag>,
          noop: true,
        });
        continue;
      }
      rows.push({
        field,
        label,
        current: <GkitList items={curr} />,
        next: <GkitList items={list} highlight />,
        error: unknown.length
          ? `Unknown gkits: ${unknown.join(', ')}`
          : undefined,
      });
    }
  }

  return rows;
};

const AltUpdateRequests: React.FC = () => {
  const alts = useSettingsStore(selectAlts);
  const { gamemodes: gmData } = useSettingsStore(selectJNDataByServer);
  const [requests, setRequests] = useState<AltUpdateRequest[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Record<string, true>>({});

  useEffect(() => {
    const off = window.ipcRenderer.on(
      'altUpdateRequest',
      (req: AltUpdateRequest) => {
        if (!req?.updates || Object.keys(req.updates).length === 0) return;
        const id = req.id || `req-${Date.now()}-${Math.random()}`;
        setRequests((prev) => [...prev, { ...req, id }]);
        setActiveId((curr) => curr ?? id);
      },
    );
    return () => off();
  }, []);

  const altByName = useMemo(() => {
    const m: Record<string, AltWithData> = {};
    for (const a of alts) m[a.username] = a;
    return m;
  }, [alts]);

  const activeRequest = useMemo(
    () => requests.find((r) => r.id === activeId) ?? requests[0] ?? null,
    [requests, activeId],
  );

  const groups: AltGroup[] = useMemo(() => {
    if (!activeRequest) return [];
    const out: AltGroup[] = [];
    for (const [username, update] of Object.entries(activeRequest.updates)) {
      const alt = altByName[username];
      if (update === null) {
        if (alt) {
          out.push({
            username,
            action: 'remove',
            rows: [
              {
                field: { kind: 'remove' },
                label: 'Remove alt',
                current: <Tag color="blue">in your alt list</Tag>,
                next: <Tag color="red">removed</Tag>,
              },
            ],
          });
        }
        continue;
      }
      const action = alt ? 'update' : 'add';
      const rows = buildRows(
        update,
        altServerInfo(alt),
        gmData,
        action === 'add',
      );
      if (rows.length > 0) out.push({ username, action, rows });
    }
    return out;
  }, [activeRequest, altByName, gmData]);

  if (!activeRequest) return null;

  const pendingFields = (group: AltGroup) =>
    group.rows
      .filter(
        (r) =>
          !r.noop && !r.error && !excluded[fieldId(group.username, r.field)],
      )
      .filter(
        () =>
          group.action !== 'add' ||
          group.rows.some(
            (r) =>
              r.field.kind === 'password' &&
              !r.error &&
              !excluded[fieldId(group.username, r.field)],
          ),
      );

  const pendingCount = groups.reduce((n, g) => n + pendingFields(g).length, 0);

  const closeActive = () => {
    setRequests((prev) => prev.filter((r) => r.id !== activeRequest.id));
    setActiveId(null);
    setExcluded({});
  };

  const apply = () => {
    const payload: AltUpdates = {};
    for (const group of groups) {
      const update = activeRequest.updates[group.username];
      if (group.action === 'remove') {
        if (pendingFields(group).length > 0) payload[group.username] = null;
        continue;
      }
      if (!update) continue;
      const built: AltUpdate = {};
      for (const row of pendingFields(group)) {
        if (row.field.kind === 'password') {
          if (typeof update.password === 'string')
            built.password = update.password;
        } else if (row.field.kind === 'rank') {
          (built.ranks ??= {})[row.field.gamemode] =
            update.ranks?.[row.field.gamemode] ?? null;
        } else {
          (built.gkits ??= {})[row.field.gamemode] =
            update.gkits?.[row.field.gamemode] ?? [];
        }
      }
      if (
        Object.keys(built).length > 0 &&
        (group.action !== 'add' ||
          (typeof built.password === 'string' && built.password.length > 0))
      ) {
        payload[group.username] = built;
      }
    }
    if (Object.keys(payload).length > 0) applyAltUpdates(payload);
    closeActive();
  };

  return (
    <Modal
      title={
        <Space>
          <span>Alt Update Request</span>
          <Tag color="blue">{activeRequest.scriptName}</Tag>
        </Space>
      }
      open={true}
      onCancel={closeActive}
      width={720}
      footer={[
        <Button key="discard" danger onClick={closeActive}>
          Discard
        </Button>,
        <Button
          key="apply"
          type="primary"
          disabled={pendingCount === 0}
          onClick={apply}
        >
          Apply Changes{pendingCount > 0 ? ` (${pendingCount})` : ''}
        </Button>,
      ]}
    >
      {requests.length > 1 && (
        <Tabs
          size="small"
          activeKey={activeRequest.id}
          onChange={(k) => {
            setActiveId(k);
            setExcluded({});
          }}
          items={requests.map((r) => ({
            key: r.id,
            label: `${r.scriptName} · ${Object.keys(r.updates).length}`,
          }))}
        />
      )}
      {groups.length === 0 ? (
        <Empty description="No changes to apply" />
      ) : (
        <Collapse
          defaultActiveKey={groups.map((g) => g.username)}
          items={groups.map((group) => ({
            key: group.username,
            label: (
              <Space>
                <Typography.Text strong>{group.username}</Typography.Text>
                {group.action === 'add' && <Tag color="green">add alt</Tag>}
                {group.action === 'remove' && <Tag color="red">remove alt</Tag>}
                {group.action === 'update' && (
                  <Tag color="blue">update alt</Tag>
                )}
                <Tag>
                  {pendingFields(group).length} /{' '}
                  {group.rows.filter((r) => !r.noop).length}
                </Tag>
              </Space>
            ),
            children: (
              <Space orientation="vertical" style={{ width: '100%' }} size={6}>
                {group.rows.map((row) => {
                  const id = fieldId(group.username, row.field);
                  const disabled = !!row.error || row.noop;
                  const checked =
                    !disabled && pendingFields(group).includes(row);
                  return (
                    <div
                      key={id}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        opacity: row.noop ? 0.5 : 1,
                      }}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        onChange={(e) => {
                          setExcluded((prev) => {
                            const next = { ...prev };
                            if (e.target.checked) delete next[id];
                            else next[id] = true;
                            return next;
                          });
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div>
                          <Typography.Text strong>{row.label}</Typography.Text>
                          {row.noop && (
                            <Tag style={{ marginLeft: 8 }}>no change</Tag>
                          )}
                        </div>
                        <Space size={8} wrap>
                          <span>{row.current}</span>
                          <Typography.Text type="secondary">→</Typography.Text>
                          <span>{row.next}</span>
                        </Space>
                        {row.error && (
                          <Alert
                            type="error"
                            showIcon
                            title={row.error}
                            style={{ marginTop: 6 }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </Space>
            ),
          }))}
        />
      )}
    </Modal>
  );
};

export default AltUpdateRequests;
