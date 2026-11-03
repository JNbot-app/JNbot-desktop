import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from 'react';
import { Chunks } from './BotMap';
import WorldMap, { MapEntity, MapMovement, MapPalette, MapPointer } from './WorldMapClass';

import botActionHandler from '../../botActionHandler';

export type BotMapCanvasRef = {
  yLevel: number;
  chunks: Chunks;
  setMap: (chunks: Chunks) => void;
  unloadChunk: (pos: { x: number; z: number }) => void;
  setPlayerPos: (pos: { x: number; y: number; z: number }) => void;
  setMovement: (movement: MapMovement) => void;
  setEntities: (entities: MapEntity[]) => void;
  updateChunk: (chunk: number[], pos: { x: number; z: number }) => void;
  hasChunks: () => boolean;
  requestChunks: () => Promise<any>;
  onReady: (cb: () => void) => () => void;
  onClick: (cb: (pos: { x: number; y?: number; z: number }, p: MapPointer) => void) => () => void;
  onEntityClick: (cb: (entity: MapEntity) => void) => () => void;
  focusPlayer: () => void;
  rerender: () => Promise<any>;
};

const BotMapCanvas = forwardRef<BotMapCanvasRef, { version: string; palette: MapPalette }>(
  ({ version, palette }, ref) => {
    const chunks = useRef<Chunks>({});
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const mapRef = useRef<WorldMap | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        yLevel: 1,
        chunks: {},

        setMap: (c: Chunks) => {
          chunks.current = c;
          mapRef.current?.loadChunks(c);
        },
        updateChunk: (chunk: number[], pos: { x: number; z: number }) => {
          mapRef.current?.loadChunk(chunk, pos);
        },
        unloadChunk: (pos: { x: number; z: number }) => {
          mapRef.current?.unloadChunk(pos);
        },
        setPlayerPos: (pos: { x: number; y: number; z: number }) => {
          mapRef.current?.setPlayerPos(pos);
        },
        setMovement: (movement: MapMovement) => mapRef.current?.setMovement(movement),
        setEntities: (entities: MapEntity[]) => mapRef.current?.setEntities(entities),
        hasChunks: () => {
          const m = mapRef.current;
          return !!m && Object.keys(m.chunks).length > 0;
        },
        requestChunks: () => {
          return botActionHandler('getChunkDump', {}, true);
        },
        onReady: (cb: () => void) => {
          const m = mapRef.current;
          if (m?.ready) {
            cb();
            return () => {};
          }
          m?.on('ready', cb);
          return () => m?.off('ready', cb);
        },
        onClick: (cb: (pos: { x: number; z: number }, p: MapPointer) => void) => {
          const m = mapRef.current;
          m?.on('blockClick', cb);
          return () => {
            m?.off('blockClick', cb);
          };
        },
        onEntityClick: (cb: (entity: MapEntity) => void) => {
          const m = mapRef.current;
          m?.on('entityClick', cb);
          return () => m?.off('entityClick', cb);
        },
        focusPlayer: () => {
          mapRef.current?.focusPlayer();
        },
        rerender: () => {
          console.time('getChunks');
          return botActionHandler('getChunkDump', {}, true)
            .then((res) => {
              if (!res) return;
              let map: Chunks = {};
              const [chunksArray, positions, playerPos] = res as [
                Uint8Array[],
                [number, number][],
                [number, number, number],
              ];
              positions?.forEach(([x, z], i) => {
                map[`${x},${z}`] = Array.from(chunksArray[i]);
              });

              chunks.current = map;
              mapRef.current?.loadChunks(map);
              if (playerPos) {
                mapRef.current?.setPlayerPos({
                  x: playerPos[0],
                  y: playerPos[1],
                  z: playerPos[2],
                });
              }
              mapRef.current?.focusPlayer();

              console.timeEnd('getChunks');
              return res;
            })
            .catch((err) => {
              console.error('Failed to rerender map:', err);
            });
        },
      }),
      [],
    );

    useLayoutEffect(() => {
      if (!canvasRef.current) return;
      const map = new WorldMap(canvasRef.current, version, palette);
      mapRef.current = map;
      map.init();

      return () => {
        map.destroy();
        mapRef.current = null;
      };
    }, []);

    useLayoutEffect(() => {
      mapRef.current?.setPalette(palette);
    }, [palette.player, palette.mob, palette.outline]);

    const handleContextMenu = (event: React.MouseEvent) => {
      event.preventDefault();
    };

    return (
      <div
        id="game-container"
        onContextMenu={handleContextMenu}
        style={{ width: '100%', height: 600 }}
      >
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    );
  },
);

export default BotMapCanvas;
