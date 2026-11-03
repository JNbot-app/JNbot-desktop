import { Chunks } from './BotMap';
import mapTextures from './Textures';
import { drawTopDownPlayer } from './MapPlayerAvatar';

const TILE_SIZE = 16;
const CHUNK_TILES = 16;
const CHUNK_PX = CHUNK_TILES * TILE_SIZE; // 256

// Pre-allocated styles for high-performance hillshading and cliff cues
const HIGHLIGHT_STYLES = [
  'rgba(255, 255, 255, 0.09)', // 1-block step up
  'rgba(255, 255, 255, 0.18)', // 2-block step up
  'rgba(255, 255, 255, 0.26)', // 3+ block step up
];
const SHADOW_STYLES = [
  'rgba(0, 0, 0, 0.11)', // 1-block step down
  'rgba(0, 0, 0, 0.22)', // 2-block step down
  'rgba(0, 0, 0, 0.32)', // 3+ block step down
];
const CLIFF_EDGE_COLOR = 'rgba(0, 0, 0, 0.45)';

export type MapPointer = { x: number; y: number; button: number };
export type MapEntity = { id: number; kind: 'player' | 'mob'; name: string; x: number; y: number | null; z: number };
export type MapMovement = { yaw: number; jump: boolean; sneak: boolean; sprint: boolean; forward: boolean; back: boolean; left: boolean; right: boolean; isPathfinding: boolean };
export type MapPalette = { player: string; mob: string; outline: string };
export function mapAvatarPose(movement: MapMovement, moving: boolean, jumping: boolean, time: number) {
  const isMoving = moving || movement.forward || movement.back || movement.left || movement.right || movement.isPathfinding;
  const isJumping = jumping || movement.jump;
  return {
    rotation: -movement.yaw || 0,
    stride: isMoving ? Math.sin(time * (movement.sprint ? 0.025 : 0.017)) * 3 : 0,
    elevation: isJumping ? 4 : 0,
    bodyHeight: movement.sneak ? 7 : 9,
  };
}
type Listener = (...args: any[]) => void;

/**
 * Lightweight canvas-based replacement for the previous Phaser scene.
 * Renders the 2D Minecraft world map using a single tileset image and
 * cached per-chunk offscreen canvases.
 */
class WorldMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  version: string;

  mapWidth = 512;
  mapHeight = 512;
  chunkWidth = 32;
  chunkHeight = 32;

  chunks: Chunks = {};
  actualPlayerPos = { x: 0, y: 0, z: 0 };

  textureMap!: Record<string, number>;
  tileset!: HTMLImageElement;
  tilesPerRow = 48;

  playerPx = { x: 0, y: 0 };
  private hasPlayerPosition = false;
  private movement: MapMovement = { yaw: 0, jump: false, sneak: false, sprint: false, forward: false, back: false, left: false, right: false, isPathfinding: false };
  private entities: MapEntity[] = [];
  private movedUntil = 0;
  private jumpUntil = 0;
  private jumpStartedAt = 0;
  private palette: MapPalette;

  // Offscreen rendered chunks keyed by "mappedX,mappedZ".
  private chunkCanvases = new Map<string, HTMLCanvasElement>();
  private chunkHeights = new Map<string, number[][]>();
  private hoverBlock: { x: number; y?: number; z: number } | null = null;

  // Camera state (center is in world pixels).
  camX = (512 * TILE_SIZE) / 2;
  camY = (512 * TILE_SIZE) / 2;
  zoom = 3;

  private dpr = window.devicePixelRatio || 1;
  private dragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private keys = new Set<string>();
  private listeners: Record<string, Listener[]> = {};

  private rafId = 0;
  private lastTime = 0;
  private needsRender = true;
  ready = false;

  private resizeObserver?: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, version: string, palette: MapPalette) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.version = version;
    this.palette = palette;
  }

  // --- tiny event emitter -------------------------------------------------
  on(event: string, cb: Listener) {
    (this.listeners[event] ??= []).push(cb);
  }
  off(event: string, cb: Listener) {
    this.listeners[event] = (this.listeners[event] ?? []).filter(
      (l) => l !== cb,
    );
  }
  private emit(event: string, ...args: any[]) {
    (this.listeners[event] ?? []).forEach((l) => l(...args));
  }

  private requestRender() {
    this.needsRender = true;
  }

  // --- lifecycle ----------------------------------------------------------
  async init() {
    await this.loadTextures();
    this.tileset = await this.loadImage(this.tileTextures);
    this.tilesPerRow = Math.max(1, Math.floor(this.tileset.width / TILE_SIZE));

    this.resize();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);

    this.attachInput();
    this.ready = true;
    this.emit('ready');

    this.lastTime = performance.now();
    this.loop(this.lastTime);
  }

  destroy() {
    cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.detachInput();
    this.chunkCanvases.clear();
    this.chunkHeights.clear();
    this.listeners = {};
  }

  private tileTextures = '';

  async loadTextures() {
    let version = this.version;
    // Year-based releases (26.1+) reuse the newest texture atlas.
    if (Number(version.split('.')[0]) >= 26) version = '1.21.11';
    if (version.split('.').length < 3) version = version + '.0';
    if (!version) throw new Error('No minecraft version specified');
    version = version.replace(/\.[^.]*$/, '');
    if (!mapTextures[version]) {
      for (let v = Number(version.split('.')[1]) - 1; v >= 8; v--) {
        const vStr = `1.${v}`;
        if (mapTextures[vStr]) {
          version = vStr;
          break;
        }
      }
      if (!mapTextures[version]) {
        throw new Error(`No textures available for version ${version}`);
      }
    }

    const t = await Promise.all(mapTextures[version]());
    this.textureMap = t[1].textures;
    this.tileTextures = t[0].default;
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // --- coordinate helpers (kept identical to the previous implementation) -
  static mapPos(p: number, size = 32): number {
    const halfSize = Math.floor(size / 2);
    const mapped = (p + halfSize) % size;
    return mapped >= 0 ? mapped : mapped + size;
  }

  private createMap(chunk: number[]): number[][] {
    const mapData: number[][] = new Array(16);
    const t = this.textureMap;
    for (let z = 0; z < 16; z++) {
      const row: number[] = new Array(16);
      for (let x = 0; x < 8; x++) {
        const b = chunk[z * 8 + x];
        const l = b >> 16;
        const r = b & 65535;
        row[x * 2] = t[l] ?? 0;
        row[x * 2 + 1] = t[r] ?? 0;
      }
      mapData[z] = row;
    }
    return mapData;
  }

  private extractHeights(chunk: number[]): number[][] | null {
    if (!chunk || chunk.length < 256) return null;
    const heights: number[][] = new Array(16);
    let hasData = false;
    for (let z = 0; z < 16; z++) {
      const row: number[] = new Array(16);
      for (let x = 0; x < 8; x++) {
        const b = chunk[128 + z * 8 + x] ?? 0;
        const l = b >> 16;
        const r = ((b & 0xffff) << 16) >> 16;
        row[x * 2] = l;
        row[x * 2 + 1] = r;
        if (b !== 0) hasData = true;
      }
      heights[z] = row;
    }
    return hasData ? heights : null;
  }

  // --- chunk management ---------------------------------------------------
  private renderChunkCanvas(
    tiles: number[][],
    heights?: number[][] | null,
    pos?: { x: number; z: number },
  ): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = CHUNK_PX;
    c.height = CHUNK_PX;
    const cx = c.getContext('2d')!;
    cx.imageSmoothingEnabled = false;

    const northChunk = pos ? this.chunkHeights.get(`${pos.x},${pos.z - 1}`) : null;
    const westChunk = pos ? this.chunkHeights.get(`${pos.x - 1},${pos.z}`) : null;
    const southChunk = pos ? this.chunkHeights.get(`${pos.x},${pos.z + 1}`) : null;
    const eastChunk = pos ? this.chunkHeights.get(`${pos.x + 1},${pos.z}`) : null;

    for (let z = 0; z < 16; z++) {
      const zPx = z * TILE_SIZE;
      for (let x = 0; x < 16; x++) {
        const idx = tiles[z][x];
        const xPx = x * TILE_SIZE;

        if (idx > 0) {
          const sx = (idx % this.tilesPerRow) * TILE_SIZE;
          const sy = Math.floor(idx / this.tilesPerRow) * TILE_SIZE;
          cx.drawImage(
            this.tileset,
            sx,
            sy,
            TILE_SIZE,
            TILE_SIZE,
            xPx,
            zPx,
            TILE_SIZE,
            TILE_SIZE,
          );
        }

        if (heights) {
          const curY = heights[z][x];
          const northY = z > 0 ? heights[z - 1][x] : (northChunk ? northChunk[15][x] : curY);
          const westY = x > 0 ? heights[z][x - 1] : (westChunk ? westChunk[z][15] : curY);

          // Directional hillshading (sunlight from North-West)
          const slope = 0.6 * (curY - northY) + 0.4 * (curY - westY);
          let step = 0;
          if (slope >= 2.5) step = 3;
          else if (slope >= 1.4) step = 2;
          else if (slope >= 0.25) step = 1;
          else if (slope <= -2.5) step = -3;
          else if (slope <= -1.4) step = -2;
          else if (slope <= -0.25) step = -1;

          if (step > 0) {
            const level = Math.min(step, HIGHLIGHT_STYLES.length) - 1;
            cx.fillStyle = HIGHLIGHT_STYLES[level];
            cx.fillRect(xPx, zPx, TILE_SIZE, TILE_SIZE);
          } else if (step < 0) {
            const level = Math.min(-step, SHADOW_STYLES.length) - 1;
            cx.fillStyle = SHADOW_STYLES[level];
            cx.fillRect(xPx, zPx, TILE_SIZE, TILE_SIZE);
          }

          // Distinct cliff/drop cues for steps >= 2 blocks
          const southY = z < 15 ? heights[z + 1][x] : (southChunk ? southChunk[0][x] : curY);
          const eastY = x < 15 ? heights[z][x + 1] : (eastChunk ? eastChunk[z][0] : curY);

          let cliffColorSet = false;
          if (curY - southY >= 2) {
            if (!cliffColorSet) {
              cx.fillStyle = CLIFF_EDGE_COLOR;
              cliffColorSet = true;
            }
            cx.fillRect(xPx, zPx + TILE_SIZE - 1, TILE_SIZE, 1);
          }
          if (curY - eastY >= 2) {
            if (!cliffColorSet) {
              cx.fillStyle = CLIFF_EDGE_COLOR;
              cliffColorSet = true;
            }
            cx.fillRect(xPx + TILE_SIZE - 1, zPx, 1, TILE_SIZE);
          }
          if (northY - curY >= 2) {
            if (!cliffColorSet) {
              cx.fillStyle = CLIFF_EDGE_COLOR;
              cliffColorSet = true;
            }
            cx.fillRect(xPx, zPx, TILE_SIZE, 1);
          }
          if (westY - curY >= 2) {
            if (!cliffColorSet) {
              cx.fillStyle = CLIFF_EDGE_COLOR;
            }
            cx.fillRect(xPx, zPx, 1, TILE_SIZE);
          }
        }
      }
    }
    return c;
  }

  loadChunk(chunk: number[], pos: { x: number; z: number }) {
    if (!this.tileset) return;
    this.chunks[`${pos.x},${pos.z}`] = chunk;
    const heights = this.extractHeights(chunk);
    if (heights) {
      this.chunkHeights.set(`${pos.x},${pos.z}`, heights);
    }
    const tiles = this.createMap(chunk);
    const mappedX = WorldMap.mapPos(pos.x, this.chunkWidth);
    const mappedZ = WorldMap.mapPos(pos.z, this.chunkHeight);
    this.chunkCanvases.set(
      `${mappedX},${mappedZ}`,
      this.renderChunkCanvas(tiles, heights, pos),
    );
    this.requestRender();
  }

  loadChunks(chunks: Chunks) {
    this.chunks = chunks;
    for (const pos in chunks) {
      const heights = this.extractHeights(chunks[pos]);
      if (heights) this.chunkHeights.set(pos, heights);
    }
    for (const pos in chunks) {
      const [x, z] = pos.split(',').map(Number);
      this.loadChunk(chunks[pos], { x, z });
    }
  }

  unloadChunk(pos: { x: number; z: number }) {
    delete this.chunks[`${pos.x},${pos.z}`];
    this.chunkHeights.delete(`${pos.x},${pos.z}`);
    const mappedX = WorldMap.mapPos(pos.x, this.chunkWidth);
    const mappedZ = WorldMap.mapPos(pos.z, this.chunkHeight);
    this.chunkCanvases.delete(`${mappedX},${mappedZ}`);
    this.requestRender();
  }

  // --- player -------------------------------------------------------------
  setPlayerPos(pos: { x: number; y?: number; z: number }) {
    const now = performance.now();
    if (this.hasPlayerPosition && (pos.x !== this.actualPlayerPos.x || pos.z !== this.actualPlayerPos.z)) {
      this.movedUntil = now + 500;
    }
    if (this.hasPlayerPosition && pos.y !== undefined && pos.y > this.actualPlayerPos.y) {
      this.jumpStartedAt = now;
      this.jumpUntil = now + 450;
    }
    this.hasPlayerPosition = true;
    this.actualPlayerPos = {
      x: pos.x,
      y: pos.y ?? this.actualPlayerPos.y,
      z: pos.z,
    };

    const chunkX = Math.floor(pos.x / 16);
    const chunkZ = Math.floor(pos.z / 16);
    const mappedChunkX = WorldMap.mapPos(chunkX, this.chunkWidth);
    const mappedChunkZ = WorldMap.mapPos(chunkZ, this.chunkHeight);
    const inChunkX = ((pos.x % 16) + 16) % 16;
    const inChunkZ = ((pos.z % 16) + 16) % 16;

    const x = (mappedChunkX * 16 + inChunkX + 0.5) * TILE_SIZE;
    const z = (mappedChunkZ * 16 + inChunkZ + 0.5) * TILE_SIZE;

    this.playerPx = { x, y: z };
    this.requestRender();
  }

  private isMovementActive(): boolean {
    const m = this.movement;
    return !!(m && (m.forward || m.back || m.left || m.right || m.jump || m.isPathfinding));
  }

  setMovement(movement: MapMovement) {
    if (movement.jump && !this.movement.jump) {
      this.jumpStartedAt = performance.now();
      this.jumpUntil = this.jumpStartedAt + 450;
    }
    this.movement = movement;
    this.requestRender();
  }

  setEntities(entities: MapEntity[]) {
    this.entities = entities;
    this.requestRender();
  }

  setPalette(palette: MapPalette) {
    this.palette = palette;
    this.requestRender();
  }

  focusPlayer() {
    this.camX = this.playerPx.x;
    this.camY = this.playerPx.y;
    this.requestRender();
  }

  // --- rendering ----------------------------------------------------------
  private resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.requestRender();
  }

  private loop = (time: number) => {
    const delta = time - this.lastTime;
    this.lastTime = time;

    if (this.keys.size > 0) {
      const speed = 0.4 * delta;
      if (this.keys.has('ArrowLeft')) this.camX -= speed;
      if (this.keys.has('ArrowRight')) this.camX += speed;
      if (this.keys.has('ArrowUp')) this.camY -= speed;
      if (this.keys.has('ArrowDown')) this.camY += speed;
      this.requestRender();
    }

    const animating = time < this.jumpUntil || time < this.movedUntil || this.isMovementActive();
    if (this.needsRender || animating) {
      this.render(time);
      this.needsRender = false;
    }
    this.rafId = requestAnimationFrame(this.loop);
  };

  private render(time: number) {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const s = this.zoom * this.dpr;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#04060A';
    ctx.fillRect(0, 0, W, H);

    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(s, 0, 0, s, W / 2 - this.camX * s, H / 2 - this.camY * s);

    this.chunkCanvases.forEach((canvas, key) => {
      const [mx, mz] = key.split(',').map(Number);
      ctx.drawImage(canvas, mx * CHUNK_PX, mz * CHUNK_PX);
    });

    for (const entity of this.entities) {
      const chunkX = WorldMap.mapPos(Math.floor(entity.x / 16), this.chunkWidth);
      const chunkZ = WorldMap.mapPos(Math.floor(entity.z / 16), this.chunkHeight);
      const x = (chunkX * 16 + ((entity.x % 16) + 16) % 16) * TILE_SIZE;
      const y = (chunkZ * 16 + ((entity.z % 16) + 16) % 16) * TILE_SIZE;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = entity.kind === 'player' ? this.palette.player : this.palette.mob;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = this.palette.outline;
      ctx.stroke();
    }

    this.drawPlayer(time);

    if (this.hoverBlock) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const text = this.hoverBlock.y !== undefined
        ? `X: ${this.hoverBlock.x}  Y: ${this.hoverBlock.y}  Z: ${this.hoverBlock.z}`
        : `X: ${this.hoverBlock.x}  Z: ${this.hoverBlock.z}`;

      ctx.font = '12px system-ui, -apple-system, sans-serif';
      const textWidth = ctx.measureText(text).width;
      const padX = 8;
      const padY = 5;
      const boxW = textWidth + padX * 2;
      const boxH = 22;
      const boxX = 12;
      const boxY = H - boxH - 12;

      ctx.fillStyle = 'rgba(10, 15, 25, 0.75)';
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(boxX, boxY, boxW, boxH, 4);
      } else {
        ctx.rect(boxX, boxY, boxW, boxH);
      }
      ctx.fill();

      ctx.fillStyle = '#CBD5E1';
      ctx.fillText(text, boxX + padX, boxY + boxH - padY - 2);
    }
  }

  private drawPlayer(time: number) {
    if (!this.hasPlayerPosition) return;
    const moving = time < this.movedUntil || this.isMovementActive();
    const jumping = time < this.jumpUntil || this.movement.jump;
    const { rotation, stride, elevation } = mapAvatarPose(this.movement, moving, jumping, time);

    let visualElevation = elevation;
    if (time < this.jumpUntil) {
      const progress = Math.max(0, Math.min(1, (time - this.jumpStartedAt) / 450));
      const jumpArc = Math.sin(progress * Math.PI) * 6.5;
      visualElevation = Math.max(elevation, jumpArc);
    }

    drawTopDownPlayer(this.ctx, {
      x: this.playerPx.x,
      y: this.playerPx.y,
      rotation,
      stride,
      visualElevation,
      moving,
      sprinting: this.movement.sprint,
      sneaking: this.movement.sneak,
    });
  }

  // --- input --------------------------------------------------------------
  private screenToWorld(clientX: number, clientY: number) {
    const rect = this.canvas.getBoundingClientRect();
    const dx = (clientX - rect.left) * this.dpr;
    const dy = (clientY - rect.top) * this.dpr;
    const s = this.zoom * this.dpr;
    return {
      x: (dx - this.canvas.width / 2) / s + this.camX,
      y: (dy - this.canvas.height / 2) / s + this.camY,
    };
  }

  private getWorldBlockPos(clientX: number, clientY: number) {
    const world = this.screenToWorld(clientX, clientY);
    const clickedTileX = Math.floor(world.x / TILE_SIZE);
    const clickedTileZ = Math.floor(world.y / TILE_SIZE);

    const playerChunkX = Math.floor(this.actualPlayerPos.x / 16);
    const playerChunkZ = Math.floor(this.actualPlayerPos.z / 16);
    const playerMappedChunkX = WorldMap.mapPos(playerChunkX, this.chunkWidth);
    const playerMappedChunkZ = WorldMap.mapPos(playerChunkZ, this.chunkHeight);
    const playerInChunkX = ((this.actualPlayerPos.x % 16) + 16) % 16;
    const playerInChunkZ = ((this.actualPlayerPos.z % 16) + 16) % 16;
    const playerTileX = playerMappedChunkX * 16 + Math.floor(playerInChunkX);
    const playerTileZ = playerMappedChunkZ * 16 + Math.floor(playerInChunkZ);

    let offsetX = clickedTileX - playerTileX;
    let offsetZ = clickedTileZ - playerTileZ;

    if (offsetX > this.mapWidth / 2) offsetX -= this.mapWidth;
    else if (offsetX < -this.mapWidth / 2) offsetX += this.mapWidth;
    if (offsetZ > this.mapHeight / 2) offsetZ -= this.mapHeight;
    else if (offsetZ < -this.mapHeight / 2) offsetZ += this.mapHeight;

    const worldX = Math.floor(this.actualPlayerPos.x) + offsetX;
    const worldZ = Math.floor(this.actualPlayerPos.z) + offsetZ;

    const chunkX = Math.floor(worldX / 16);
    const chunkZ = Math.floor(worldZ / 16);
    const inChunkX = ((worldX % 16) + 16) % 16;
    const inChunkZ = ((worldZ % 16) + 16) % 16;
    const heights = this.chunkHeights.get(`${chunkX},${chunkZ}`);
    const worldY = heights ? heights[inChunkZ][inChunkX] : undefined;

    return { x: worldX, y: worldY, z: worldZ };
  }

  private onPointerDown = (e: MouseEvent) => {
    this.dragging = true;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;

    if (e.button === 0) {
      const world = this.screenToWorld(e.clientX, e.clientY);
      const entity = this.entities.find((candidate) => {
        const chunkX = WorldMap.mapPos(Math.floor(candidate.x / 16), this.chunkWidth);
        const chunkZ = WorldMap.mapPos(Math.floor(candidate.z / 16), this.chunkHeight);
        const x = (chunkX * 16 + ((candidate.x % 16) + 16) % 16) * TILE_SIZE;
        const y = (chunkZ * 16 + ((candidate.z % 16) + 16) % 16) * TILE_SIZE;
        return Math.hypot(world.x - x, world.y - y) <= Math.max(5, 10 / this.zoom);
      });
      if (entity) {
        this.dragging = false;
        this.emit('entityClick', entity);
        return;
      }
    }
    const block = this.getWorldBlockPos(e.clientX, e.clientY);
    const pointer: MapPointer = { x: e.clientX, y: e.clientY, button: e.button };
    this.emit('blockClick', block, pointer);
  };

  private onPointerMove = (e: MouseEvent) => {
    if (this.dragging) {
      const deltaX = this.dragStartX - e.clientX;
      const deltaY = this.dragStartY - e.clientY;
      this.camX += deltaX / this.zoom;
      this.camY += deltaY / this.zoom;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.requestRender();
    } else {
      const block = this.getWorldBlockPos(e.clientX, e.clientY);
      if (
        !this.hoverBlock ||
        this.hoverBlock.x !== block.x ||
        this.hoverBlock.z !== block.z ||
        this.hoverBlock.y !== block.y
      ) {
        this.hoverBlock = block;
        this.requestRender();
      }
    }
  };

  private onMouseLeave = () => {
    if (this.hoverBlock) {
      this.hoverBlock = null;
      this.requestRender();
    }
  };

  private onPointerUp = () => {
    this.dragging = false;
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const base = this.zoom;
    const zoomFactor = 0.08 * Math.max(1, base);
    if (e.deltaY > 0 && base < 10) {
      this.zoom = Math.min(10, base + zoomFactor);
    } else if (e.deltaY < 0 && base > 0.3) {
      this.zoom = Math.max(0.3, base - zoomFactor);
    }
    this.requestRender();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key.startsWith('Arrow')) this.keys.add(e.key);
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key);
  };

  private attachInput() {
    this.canvas.addEventListener('mousedown', this.onPointerDown);
    this.canvas.addEventListener('mouseleave', this.onMouseLeave);
    window.addEventListener('mousemove', this.onPointerMove);
    window.addEventListener('mouseup', this.onPointerUp);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  private detachInput() {
    this.canvas.removeEventListener('mousedown', this.onPointerDown);
    this.canvas.removeEventListener('mouseleave', this.onMouseLeave);
    window.removeEventListener('mousemove', this.onPointerMove);
    window.removeEventListener('mouseup', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}

export default WorldMap;
