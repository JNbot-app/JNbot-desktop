import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useState,
  useCallback,
} from 'react';

import BotMapCanvas, { BotMapCanvasRef } from './BotMapCanvas';
import { BotInfo, ChunkUpdate, MapData, MovementData, TabRef } from '../../types';
import type { MapEntity } from './WorldMapClass';
import botActionHandler from '../../botActionHandler';
import botEvents from '../../../../utils/botEvents';
import { Button, Space, Spin, Switch, Typography, theme } from 'antd';

export type Chunks = Record<string, number[]>;

interface BotMapProps {
  bot: BotInfo;
  data?: MapData;
  small?: boolean;
}

const BotMap = forwardRef<TabRef, BotMapProps>(({ bot, data, small }, ref) => {
  const mapRef = useRef<BotMapCanvasRef>(null);
  const [loading, setLoading] = useState(true);
  const [showEntities, setShowEntities] = useState(false);
  const [selectedEntity, setSelectedEntity] = useState<MapEntity | null>(null);
  const { token } = theme.useToken();

  useImperativeHandle(ref, () => ({
    update: (data: MapData) => {
    },
  }));

  const handleRerender = useCallback(() => {
    setLoading(true);
    mapRef.current
      ?.rerender()
      ?.finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!bot) return;

    setLoading(true);
    let isCancelled = false;
    let removeClickHandler: (() => void) | undefined;
    let removeEntityClickHandler: (() => void) | undefined;
    let unsubscribeChunks: (() => void) | undefined;
    let unsubscribeMovement: (() => void) | undefined;
    let unsubscribeForceMove: (() => void) | undefined;
    let unsubscribeMovementState: (() => void) | undefined;
    let removeReady: (() => void) | undefined;

    const timeoutId = setTimeout(() => {
      if (!isCancelled) {
        setLoading(false);
      }
    }, 10000);

    // Setup map when ready
    removeReady = mapRef.current?.onReady(() => {
      if (isCancelled) return;

      mapRef.current
        ?.rerender()
        ?.finally(() => {
          if (!isCancelled) {
            setLoading(false);
          }
        });

      unsubscribeChunks = botEvents.subscribe(
        bot.botId,
        'chunks',
        (chunkData: ChunkUpdate) => {
          if (chunkData.type === 'load') {
            if (!isCancelled) {
              setLoading(false);
            }
            const chunk = Array.from(chunkData.chunk);
            mapRef.current?.updateChunk(chunk, {
              x: chunkData.x,
              z: chunkData.z,
            });
          } else if (chunkData.type === 'unload') {
            mapRef.current?.unloadChunk({ x: chunkData.x, z: chunkData.z });
          }
        },
        {
          throttle: 250,
        },
      );

      unsubscribeMovement = botEvents.subscribe(
        bot.botId,
        'movement',
        ([x, y, z]) => {
          mapRef.current?.setPlayerPos({ x, y, z });
          mapRef.current?.focusPlayer();
        },
        {
          throttle: 250,
          ignorePrevious: true,
        },
      );

      unsubscribeForceMove = botEvents.subscribe(
        bot.botId,
        'force-move',
        ([x, y, z]) => {
          mapRef.current?.setPlayerPos({ x, y, z });
          mapRef.current?.focusPlayer();
        },
      );

      unsubscribeMovementState = botEvents.subscribe(
        bot.botId,
        'movement-state',
        (movement: MovementData) => {
          if (Number.isFinite(movement?.yaw)) mapRef.current?.setMovement(movement);
        },
        { throttle: 100, ignorePrevious: true },
      );
      botEvents.action(bot.botId, 'movementPacket');

      // Setup click handler for pathfinding
      removeClickHandler = mapRef.current?.onClick((pos, pointer) => {
        if (pointer.button === 2) {
          // Right click
          botActionHandler('startPathFinder', { x: pos.x, z: pos.z });
        }
      });
      removeEntityClickHandler = mapRef.current?.onEntityClick(setSelectedEntity);
    });

    return () => {
      isCancelled = true;
      clearTimeout(timeoutId);
      removeClickHandler?.();
      removeEntityClickHandler?.();
      unsubscribeChunks?.();
      unsubscribeMovement?.();
      unsubscribeForceMove?.();
      unsubscribeMovementState?.();
      removeReady?.();
    };
  }, [bot.botId]);

  useEffect(() => {
    if (!showEntities) {
      setSelectedEntity(null);
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const removeReady = mapRef.current?.onReady(() => {
      if (cancelled) return;
      unsubscribe = botEvents.subscribe(bot.botId, 'map-entities', (value: unknown) => {
        if (!Array.isArray(value)) return;
        const entities = value.filter((entity): entity is MapEntity =>
          entity !== null && typeof entity === 'object' &&
          typeof entity.id === 'number' &&
          (entity.kind === 'player' || entity.kind === 'mob') &&
          typeof entity.name === 'string' &&
          Number.isFinite(entity.x) && Number.isFinite(entity.z),
        );
        mapRef.current?.setEntities(entities);
        setSelectedEntity((current) => entities.find((entity) => entity.id === current?.id) ?? null);
      });
    });
    return () => {
      cancelled = true;
      removeReady?.();
      unsubscribe?.();
      mapRef.current?.setEntities([]);
      setSelectedEntity(null);
    };
  }, [bot.botId, showEntities]);

  if (!bot) {
    return <div>No bot selected</div>;
  }

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: small ? undefined : 600,
          aspectRatio: small ? '1' : undefined,
          borderRadius: token.borderRadiusLG,
          overflow: 'hidden',
          border: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgContainer,
        }}
      >
        <BotMapCanvas
          version={bot.version}
          palette={{ player: token.colorPrimary, mob: token.colorWarning, outline: token.colorTextLightSolid }}
          ref={mapRef}
        />

        {loading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 16,
              background: token.colorBgContainer,
              zIndex: 10,
            }}
          >
            <Spin size="large" />
            <Typography.Text type="secondary" style={{ fontSize: 14 }}>
              Loading map...
            </Typography.Text>
          </div>
        )}
        {selectedEntity && showEntities && (
          <div style={{ position: 'absolute', left: 12, top: 12, padding: 10, borderRadius: token.borderRadius, background: token.colorBgElevated, border: `1px solid ${token.colorBorder}`, boxShadow: token.boxShadowSecondary }}>
            <Space direction="vertical" size={2}>
              <Typography.Text strong>{selectedEntity.name}</Typography.Text>
              <Typography.Text type="secondary">{selectedEntity.kind === 'player' ? 'Player' : 'Mob'} · X {selectedEntity.x} · {selectedEntity.y === null ? '' : `Y ${selectedEntity.y} · `}Z {selectedEntity.z}</Typography.Text>
              <Button type="link" size="small" onClick={() => setSelectedEntity(null)} style={{ padding: 0, alignSelf: 'flex-start' }}>Close</Button>
            </Space>
          </div>
        )}
      </div>

      <Space wrap style={{ marginTop: 12 }}>
        <Button onClick={() => mapRef.current?.focusPlayer()} disabled={loading}>
          Focus player
        </Button>

        <Button loading={loading} onClick={handleRerender}>
          Rerender map
        </Button>
        <Switch checked={showEntities} onChange={setShowEntities} aria-label="Show entities" />
        <Typography.Text>Entities</Typography.Text>
      </Space>
    </div>
  );
});

export default BotMap;
