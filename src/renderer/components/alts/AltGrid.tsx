import React, {
  useCallback,
  useContext,
  useMemo,
  useState,
  forwardRef,
} from 'react';
import {
  useSettingsStore,
  selectAlts,
  selectStats,
  deleteAlt,
  setAllAlts,
  selectAltTags,
  setTagAlts,
  removeAltsFromTag,
} from '../../redux/settings';
import {
  Table,
  Card,
  Dropdown,
  Skeleton,
  MenuProps,
  Typography,
  Tag,
  theme,
  Button,
} from 'antd';
import { ColumnsType } from 'antd/es/table';
import {
  EditOutlined,
  DeleteOutlined,
  UserOutlined,
  EyeOutlined,
  HolderOutlined,
} from '@ant-design/icons';
import Image from '../Image';
import NoAltsOverlay from './NoAltsOverlay';
import SearchNotFound from './SearchNotFound';
import { AppContext } from '../../redux/appContext';
import GridToolbar from './GridToolbar';
import TagManager from './tags/TagManager';
import {
  AdvancedFilters,
  EMPTY_FILTERS,
  buildAdvancedFilterPredicate,
} from './AltFilters';
import type {
  AltWithData,
  AltTag,
  ServerAltInfo,
} from '../../../../src/main/src/types.d.ts';
import { TableRowSelection } from 'antd/es/table/interface';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type ExtendedAlt = AltWithData & {
  rankCount: number;
  gkitCount: number;
  key: string;
  onlineTime: number;
  joinCount: number;
};

const countGkits = (record: ServerAltInfo) => {
  return record
    ? Object.values(record.gkits ?? {}).reduce(
        (a: number, b) => a + b.length,
        0,
      )
    : 0;
};

const countRanks = (record: ServerAltInfo) =>
  record
    ? Object.values(record.ranks ?? {}).reduce(
        (a: number, b) => a + (b ? 1 : 0),
        0,
      )
    : 0;

const RowContext = React.createContext<{ listeners: any } | null>(null);

// True while a search/advanced filter is active. When it is, the table only
// shows a subset of the alts, so reordering would corrupt the full order — we
// disable dragging entirely in that case.
const SortDisabledContext = React.createContext(false);

const SortHandle: React.FC = () => {
  const context = useContext(RowContext);
  const disabled = useContext(SortDisabledContext);
  return (
    <HolderOutlined
      {...(disabled ? {} : context?.listeners || {})}
      style={{
        cursor: disabled ? 'not-allowed' : 'grab',
        color: 'inherit',
        opacity: disabled ? 0.3 : 1,
      }}
      title={disabled ? 'Clear the filter to reorder alts' : undefined}
    />
  );
};

interface DraggableRowProps extends React.HTMLAttributes<HTMLDivElement> {
  'data-row-key': string;
}
const DraggableRow = forwardRef<HTMLDivElement, DraggableRowProps>(
  (props, ref) => {
    const disabled = useContext(SortDisabledContext);
    const {
      setNodeRef,
      transform,
      transition,
      isDragging,
      listeners,
      attributes,
    } = useSortable({
      id: props['data-row-key'],
      disabled,
    });

    const style: React.CSSProperties = {
      ...props.style,
      transform: CSS.Transform.toString(transform),
      transition,
      opacity: isDragging ? 0.5 : 1,
    };

    return (
      <RowContext.Provider value={{ listeners }}>
        <div
          {...props}
          ref={(node) => {
            setNodeRef(node);
            if (ref && typeof ref === 'function') ref(node);
            else if (ref)
              (ref as React.MutableRefObject<HTMLDivElement | null>).current =
                node;
          }}
          style={style}
          {...attributes}
        />
      </RowContext.Provider>
    );
  },
);

const AltGrid: React.FC = () => {
  const {
    token: { colorBgContainer, colorBorderSecondary },
  } = theme.useToken();
  const { openAccountProfile, openAltEditor } = useContext(AppContext);
  const alts = useSettingsStore(selectAlts);
  const stats = useSettingsStore(selectStats);
  const [contextMenu, setContextMenu] = useState<{
    mouseX: number;
    mouseY: number;
  } | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [advancedFilters, setAdvancedFilters] =
    useState<AdvancedFilters>(EMPTY_FILTERS);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [dataSource, setDataSource] = useState<ExtendedAlt[]>([]);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const [tagManager, setTagManager] = useState<{
    open: boolean;
    initialId: string | null;
  }>({ open: false, initialId: null });
  const tags = useSettingsStore(selectAltTags);
  const activeTag: AltTag | null =
    tags.find((t) => t.id === activeTagId) ?? null;

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 1,
      },
    }),
  );

  // If the active tag is deleted elsewhere, drop the filter.
  React.useEffect(() => {
    if (activeTagId && !tags.some((t) => t.id === activeTagId)) {
      setActiveTagId(null);
    }
  }, [tags, activeTagId]);

  const handleContextMenu = (
    event: React.MouseEvent<HTMLDivElement>,
    _username: string,
  ) => {
    event.preventDefault();
    setContextMenu(
      contextMenu
        ? null
        : { mouseX: event.clientX - 2, mouseY: event.clientY - 4 },
    );
  };

  const sortJoinTimeComparator = useCallback(
    (a: AltWithData, b: AltWithData) =>
      (stats.alts[a.username]?.playTime ?? 0) -
      (stats.alts[b.username]?.playTime ?? 0),
    [stats],
  );

  const sortUsernames = useCallback(
    (a: AltWithData, b: AltWithData) => a.username.localeCompare(b.username),
    [],
  );

  const onlineTime = useCallback(
    (time: number) => {
      let result: string[] = [];
      [
        ['day', 86400000],
        ['hour', 3600000],
        ['minute', 60000],
        ['second', 1000],
      ].forEach(([name, val]) => {
        const num = Math.floor(time / (val as number));
        if (num > 0) {
          result.push(`${num} ${name}${num > 1 ? 's' : ''}`);
          time -= num * (val as number);
        }
      });
      if (result.length === 0) result.push('0 seconds');
      return result.slice(0, 2).join(', ');
    },
    [stats],
  );

  const deleteBulkAlts = () => {
    selectedRowKeys.forEach((key) => {
      deleteAlt(key as string);
    });
    setSelectedRowKeys([]);
  };

  const onSelectChange = (newSelectedRowKeys: React.Key[]) => {
    setSelectedRowKeys(newSelectedRowKeys);
  };

  const rowSelection: TableRowSelection<ExtendedAlt> = {
    selectedRowKeys,
    onChange: onSelectChange,
    columnWidth: 50,
  };

  // Map: username -> tags it belongs to (in the current server).
  const tagsByUsername = useMemo(() => {
    const map = new Map<string, AltTag[]>();
    for (const tag of tags) {
      for (const u of tag.alts) {
        const arr = map.get(u);
        if (arr) arr.push(tag);
        else map.set(u, [tag]);
      }
    }
    return map;
  }, [tags]);

  const columns: ColumnsType<any> = useMemo(
    () => [
      {
        title: '',
        key: 'sort',
        width: 40,
        render: () => <SortHandle />,
      },
      {
        title: 'Head',
        dataIndex: 'head',
        key: 'head',
        width: 80,
        render: (_, record) => (
          <div style={{ height: 45, width: 45 }}>
            <Image
              width={45}
              heigth={45}
              loadingElement={
                <Skeleton.Avatar active shape="square" size={45} />
              }
              src={`https://crafthead.net/avatar/${record.username}`}
              alt={record.username}
            />
          </div>
        ),
      },
      {
        title: 'Username',
        dataIndex: 'username',
        key: 'username',
        width: 150,
        sorter: sortUsernames,
        render: (username: string) => (
          <Typography.Text
            onClick={() => openAccountProfile(username)}
            style={{
              cursor: 'pointer',
              fontWeight: 700,
              color: 'inherit',
            }}
          >
            {username}
          </Typography.Text>
        ),
      },
      {
        title: 'Tags',
        key: 'tags',
        width: 220,
        render: (_, record) => {
          const altTags = tagsByUsername.get(record.username) ?? [];
          if (altTags.length === 0) {
            return (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                —
              </Typography.Text>
            );
          }
          return (
            <div
              style={{
                display: 'flex',
                gap: 4,
                flexWrap: 'wrap',
                alignItems: 'center',
              }}
            >
              {altTags.map((tag) => (
                <Tag
                  key={tag.id}
                  color={tag.color}
                  variant="solid"
                  closable={activeTagId === tag.id}
                  onClose={(e) => {
                    e.preventDefault();

                    removeAltsFromTag({
                      tagId: tag.id,
                      usernames: [record.username],
                    });
                  }}
                  onClick={() => {
                    if (activeTagId !== tag.id) setActiveTagId(tag.id);
                  }}
                  style={{
                    cursor: 'pointer',
                    borderRadius: 4,
                    margin: 0,
                  }}
                >
                  {tag.name}
                </Tag>
              ))}
            </div>
          );
        },
      },
      {
        title: 'Online time',
        dataIndex: 'onlineTime',
        key: 'onlineTime',
        width: 200,
        sorter: sortJoinTimeComparator,
        render: onlineTime,
      },
      {
        title: 'Last joined',
        dataIndex: 'lastJoined',
        key: 'lastJoined',
        width: 200,
        render: (_, record) => {
          const lastOnline = stats.alts[record.username]?.lastJoined;
          return lastOnline ? new Date(lastOnline).toLocaleString() : null;
        },
        sorter: sortJoinTimeComparator,
      },
      {
        title: 'Created on',
        dataIndex: 'createdOn',
        key: 'createdOn',
        width: 120,
        render: (_, record) => {
          const createdOn = stats.alts[record.username]?.createdOn;
          return createdOn ? new Date(createdOn).toLocaleDateString() : null;
        },
        sorter: sortJoinTimeComparator,
      },
      {
        title: 'Gkit count',
        dataIndex: 'gkitCount',
        key: 'gkitCount',
        width: 120,
        sorter: (a, b) => a.gkitCount - b.gkitCount,
      },
      {
        title: 'Rank count',
        dataIndex: 'rankCount',
        key: 'rankCount',
        width: 120,
        sorter: (a, b) => a.rankCount - b.rankCount,
      },
      {
        title: 'Join count',
        dataIndex: 'joinCount',
        key: 'joinCount',
        width: 120,
        sorter: (a, b) => a.joinCount - b.joinCount,
      },
      {
        title: 'Details',
        key: 'details',
        width: 80,
        render: (_, record) => (
          <Button
            type="text"
            icon={<EyeOutlined />}
            onClick={() => openAccountProfile(record.username)}
            title="View alt details"
            size="small"
          />
        ),
      },
    ],
    [
      stats,
      sortJoinTimeComparator,
      onlineTime,
      tagsByUsername,
      activeTagId,
      openAccountProfile,
    ],
  );

  const rows: ExtendedAlt[] = useMemo(() => {
    return alts.map((alt) => ({
      key: alt.username,
      ...alt,
      onlineTime: stats.alts[alt.username]?.playTime ?? 0,
      gkitCount: countGkits(alt.data ?? { ranks: {}, gkits: {} }),
      rankCount: countRanks(alt.data ?? { ranks: {}, gkits: {} }),
      joinCount: stats.alts[alt.username]?.joinCount ?? 0,
    }));
  }, [alts, stats]);

  const items: MenuProps['items'] = [
    { key: 'show', icon: <UserOutlined />, title: 'Show' },
    { key: 'edit', icon: <EditOutlined />, title: 'Edit' },
    { key: 'delete', icon: <DeleteOutlined />, title: 'Delete' },
  ];

  const filtered = useMemo(() => {
    let filteredRows = rows;

    if (filter.length > 0) {
      const f = filter.toLowerCase();
      filteredRows = filteredRows.filter((row) =>
        row.username.toLowerCase().includes(f),
      );
    }

    // Advanced filters — gamemode-scoped gkit/rank constraints.
    const advancedPredicate = buildAdvancedFilterPredicate(advancedFilters);
    if (advancedPredicate) {
      filteredRows = filteredRows.filter(advancedPredicate);
    }

    // Tag filter — when a tag is active, restrict and order by the tag's list.
    const tag = tags.find((t) => t.id === activeTagId);
    if (tag) {
      const byUser = new Map(filteredRows.map((r) => [r.username, r]));
      const ordered: ExtendedAlt[] = [];
      for (const username of tag.alts) {
        const r = byUser.get(username);
        if (r) ordered.push(r);
      }
      filteredRows = ordered;
    }

    return filteredRows;
  }, [filter, rows, tags, activeTagId, advancedFilters]);

  React.useEffect(() => {
    setDataSource(filtered);
  }, [filtered]);

  // Any active filter (search, advanced, or tag) shows only a subset of the
  // alts, so reordering it would corrupt the full list — detect that simply by
  // checking whether the visible rows are fewer than the full alt set.
  const dragDisabled = dataSource.length !== alts.length;

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (dragDisabled || !over || active.id === over.id) return;

    if (activeTag) {
      // Reorder within the active tag.
      const from = activeTag.alts.indexOf(active.id as string);
      const to = activeTag.alts.indexOf(over.id as string);
      if (from === -1 || to === -1) return;
      const nextAlts = arrayMove(activeTag.alts, from, to);
      setTagAlts({ tagId: activeTag.id, alts: nextAlts });
      setDataSource((prev) => {
        const a = prev.findIndex((i) => i.key === active.id);
        const b = prev.findIndex((i) => i.key === over.id);
        return arrayMove(prev, a, b);
      });
      return;
    }

    setDataSource((prev) => {
      const activeIndex = prev.findIndex((i) => i.key === active.id);
      const overIndex = prev.findIndex((i) => i.key === over.id);
      const newDataSource = arrayMove(prev, activeIndex, overIndex);
      const newAlts = newDataSource
        .map((item) => alts.find((alt) => alt.username === item.key))
        .filter(Boolean) as AltWithData[];
      setAllAlts(newAlts);
      return newDataSource;
    });
  };

  const openTagManager = (tagId: string | null = null) => {
    setTagManager({
      open: true,
      initialId: tagId ?? activeTagId,
    });
  };

  return (
    <Card
      style={{
        width: '100%',
        backgroundColor: colorBgContainer,
        borderColor: colorBorderSecondary,
      }}
    >
      <GridToolbar
        onAddAlt={() => openAltEditor()}
        onFilterChange={setFilter}
        selectedRowKeys={selectedRowKeys}
        onBulkDelete={deleteBulkAlts}
        onClearSelection={() => setSelectedRowKeys([])}
        activeTagId={activeTagId}
        onTagSelect={setActiveTagId}
        onManageTags={openTagManager}
        advancedFilters={advancedFilters}
        onAdvancedFiltersChange={setAdvancedFilters}
      />
      <SortDisabledContext.Provider value={dragDisabled}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onDragEnd}
        >
          <SortableContext
            items={dataSource.map((i) => i.key)}
            strategy={verticalListSortingStrategy}
          >
            <Table
              columns={columns}
              dataSource={dataSource}
              rowSelection={rowSelection}
              virtual
              pagination={{
                pageSizeOptions: ['10', '20', '50', '100', '500'],
                showSizeChanger: true,
              }}
              scroll={{ y: 650 }}
              size="small"
              components={{
                body: {
                  row: DraggableRow,
                },
              }}
              onRow={(record) =>
                ({
                  'data-row-key': record.key,
                  onContextMenu: (e: any) =>
                    handleContextMenu(e, record.username),
                }) as any
              }
              locale={{
                emptyText:
                  alts.length === 0 ? <NoAltsOverlay /> : <SearchNotFound />,
              }}
            />
          </SortableContext>
        </DndContext>
      </SortDisabledContext.Provider>
      <Dropdown menu={{ items }} trigger={['contextMenu']}>
        <div />
      </Dropdown>
      <TagManager
        open={tagManager.open}
        initialTagId={tagManager.initialId}
        onClose={() => setTagManager({ open: false, initialId: null })}
      />
    </Card>
  );
};

export default AltGrid;
