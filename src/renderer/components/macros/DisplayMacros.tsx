import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Empty, Input, Segmented, Spin, theme } from 'antd';
import {
  AppstoreOutlined,
  BarsOutlined,
  LoadingOutlined,
  PlusOutlined,
  SearchOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import {
  useSettingsStore,
  selectMacros,
  selectPluginMetadata,
  selectPluginsUi,
} from '../../redux/settings';
import { useShares } from '../../redux/shares';
import { shareUpdateAvailable } from '../../../common/share';
import { usePluginActions } from './usePluginActions';
import { useMacrosBootstrap } from './useMacrosBootstrap';
import FolderSidebar from './FolderSidebar';
import ImportButton from '../share/ImportButton';
import PluginCard from './PluginCard';
import type { MacroInfo } from '../../../main/src/types';
import { useVirtualizer } from '@tanstack/react-virtual';

const Toolbar: React.FC<{ onCreate: () => void }> = ({ onCreate }) => {
  const ui = useSettingsStore(selectPluginsUi);
  const actions = usePluginActions();
  const navigate = useNavigate();
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 8,
        alignItems: 'center',
        padding: '12px 16px',
      }}
    >
      <Input
        prefix={<SearchOutlined />}
        allowClear
        value={ui.search}
        onChange={(e) => actions.setUi({ search: e.target.value })}
        placeholder="Search plugins…"
        style={{ width: 220 }}
      />
      <div style={{ flex: 1 }} />
      <Segmented
        size="small"
        value={ui.sortOrder}
        onChange={(v) => actions.setUi({ sortOrder: v as 'name' | 'date' })}
        options={[
          { value: 'name', label: 'Name' },
          { value: 'date', label: 'Modified' },
        ]}
      />
      <Segmented
        size="small"
        value={ui.viewMode}
        onChange={(v) => actions.setUi({ viewMode: v as 'grid' | 'list' })}
        options={[
          { value: 'grid', icon: <AppstoreOutlined /> },
          { value: 'list', icon: <BarsOutlined /> },
        ]}
      />
      <ImportButton onImportFile={actions.importPlugin} />
      <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>
        Create
      </Button>
    </div>
  );
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
};

const GRID_MIN_COLUMN_WIDTH = 260;
const GRID_GAP = 12;

const VirtualizedPluginCards: React.FC<{
  plugins: MacroInfo[];
  viewMode: 'grid' | 'list';
  updateAvailable: Set<string>;
}> = ({ plugins, viewMode, updateAvailable }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [columnCount, setColumnCount] = useState(1);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;

    const updateColumnCount = () => {
      const nextColumnCount =
        viewMode === 'list'
          ? 1
          : Math.max(
              1,
              Math.floor(
                (grid.clientWidth + GRID_GAP) /
                  (GRID_MIN_COLUMN_WIDTH + GRID_GAP),
              ),
            );
      setColumnCount((current) =>
        current === nextColumnCount ? current : nextColumnCount,
      );
    };

    updateColumnCount();
    const observer = new ResizeObserver(updateColumnCount);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [viewMode]);

  const rows = useMemo(() => {
    const nextRows: MacroInfo[][] = [];
    for (let index = 0; index < plugins.length; index += columnCount) {
      nextRows.push(plugins.slice(index, index + columnCount));
    }
    return nextRows;
  }, [columnCount, plugins]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (viewMode === 'list' ? 50 : 260),
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 2,
  });

  useEffect(() => {
    rowVirtualizer.measure();
  }, [columnCount, rowVirtualizer]);

  return (
    <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <div
        ref={gridRef}
        style={{
          height: rowVirtualizer.getTotalSize(),
          minHeight: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            data-index={virtualRow.index}
            ref={rowVirtualizer.measureElement}
            style={{
              left: 0,
              position: 'absolute',
              top: 0,
              transform: `translateY(${virtualRow.start}px)`,
              width: '100%',
            }}
          >
            <div
              style={
                viewMode === 'list'
                  ? {
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      paddingBottom: 2,
                    }
                  : {
                      ...gridStyle,
                      gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
                      paddingBottom: GRID_GAP,
                    }
              }
            >
              {rows[virtualRow.index].map((plugin) => (
                <PluginCard
                  key={plugin.pluginId}
                  plugin={plugin}
                  viewMode={viewMode}
                  updateAvailable={updateAvailable.has(plugin.pluginId)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const MinePlugins: React.FC = () => {
  const { token } = theme.useToken();
  const { list, loaded } = useSettingsStore(selectMacros);
  const installedShares = useShares((state) => state.installed);
  const appVersion = useShares((state) => state.appVersion);
  const pluginMetadata = useSettingsStore(selectPluginMetadata);
  const ui = useSettingsStore(selectPluginsUi);
  const actions = usePluginActions();

  const updateAvailable = new Set(
    Object.values(installedShares)
      .filter((share) => share.kind === 'plugin' && shareUpdateAvailable(share, appVersion))
      .map((share) => share.localRef),
  );

  const visible = useMemo(() => {
    let arr = list;
    if (ui.folder === '__none__')
      arr = arr.filter((p) => !pluginMetadata[p.pluginId]?.folder);
    else if (ui.folder !== '__all__')
      arr = arr.filter((p) => pluginMetadata[p.pluginId]?.folder === ui.folder);
    if (ui.search) {
      const q = ui.search.toLowerCase();
      arr = arr.filter((p) => p.name.toLowerCase().includes(q));
    }
    return [...arr].sort((a, b) =>
      ui.sortOrder === 'name'
        ? a.name.localeCompare(b.name)
        : (b.editedAt ?? 0) - (a.editedAt ?? 0),
    );
  }, [list, pluginMetadata, ui.folder, ui.search, ui.sortOrder]);

  if (!loaded) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 48,
        }}
      >
        <Spin indicator={<LoadingOutlined spin />} size="large" />
      </div>
    );
  }

  const headerLabel =
    ui.folder === '__all__'
      ? 'All Plugins'
      : ui.folder === '__none__'
        ? 'Unorganized'
        : ui.folder;

  const onDropMain = (e: React.DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (id) actions.movePlugin(id, null);
  };

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDropMain}
      style={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        padding: 16,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          {headerLabel}
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              color: token.colorTextTertiary,
              background: token.colorFillTertiary,
              padding: '2px 8px',
              borderRadius: 10,
            }}
          >
            {visible.length}
          </span>
        </div>
      </div>
      {visible.length === 0 ? (
        <Empty description="No plugins found" />
      ) : (
        <VirtualizedPluginCards
          plugins={visible}
          viewMode={ui.viewMode}
          updateAvailable={updateAvailable}
        />
      )}
    </div>
  );
};

const DisplayMacros: React.FC<{ openDrawer: () => void }> = ({
  openDrawer,
}) => {
  useMacrosBootstrap();
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 5rem)',
        background: token.colorBgContainer,
        borderRadius: token.borderRadiusLG,
        overflow: 'hidden',
        border: `1px solid ${token.colorBorderSecondary}`,
      }}
    >
      <Toolbar onCreate={openDrawer} />
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          borderTop: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <FolderSidebar />
        <MinePlugins />
      </div>
    </div>
  );
};

export default DisplayMacros;
