
// Color constants for Steve's 3D top-down avatar (Minecraft character art)
const COLOR_HEAD_BASE = '#4a321e';
const COLOR_HEAD_DARK = '#352011';
const COLOR_HEAD_LIGHT = '#5c3d25';
const COLOR_SKIN = '#b67d59';
const COLOR_SKIN_SHADOW = '#8d5b3c';
const COLOR_EYE_WHITE = '#f5f5f5';
const COLOR_EYE_PUPIL = '#385a8c';
const COLOR_BEARD = '#65402e';
const COLOR_SHIRT = '#15979b';
const COLOR_SHIRT_LIGHT = '#22b4ba';
const COLOR_SHIRT_SHADOW = '#0c6f73';
const COLOR_SHIRT_COLLAR = '#0e787d';
const COLOR_PANTS = '#27234b';
const COLOR_PANTS_SHADOW = '#1d1a38';
const COLOR_BOOT = '#39373c';
const COLOR_BOOT_SOLE = '#232225';
const COLOR_HIGHLIGHT = 'rgba(255, 255, 255, 0.22)';
const COLOR_DEPTH_SHADOW = 'rgba(0, 0, 0, 0.32)';

export interface DrawPlayerAvatarParams {
  x: number;
  y: number;
  rotation: number;
  stride: number;
  visualElevation: number;
  moving: boolean;
  sprinting: boolean;
  sneaking: boolean;
}

/**
 * High-performance 3D top-down render of the player avatar.
 * Renders Steve from a top-down view with directional shading,
 * dynamic drop shadow, face orientation, and limb swing animations.
 */
export function drawTopDownPlayer(ctx: CanvasRenderingContext2D, params: DrawPlayerAvatarParams): void {
  const { x, y, rotation, stride, visualElevation, moving, sprinting, sneaking } = params;

  // --- 1. Ground Drop Shadow ---
  // Shadow stays on the terrain surface and diffuses as the player jumps
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);

  const shadowScale = 1 + visualElevation * 0.08;
  const shadowAlpha = Math.max(0.12, 0.42 - visualElevation * 0.038);
  ctx.beginPath();
  ctx.ellipse(0, 0, 7.5 * shadowScale, 5 * shadowScale, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha.toFixed(3)})`;
  ctx.fill();
  ctx.restore();

  // --- 2. 3D Elevated Avatar ---
  ctx.save();
  ctx.translate(x, y - visualElevation);
  ctx.rotate(rotation);

  // Sneak forward lean and slight sprint lean
  const forwardShift = sneaking ? -1.5 : (sprinting && moving ? -1.0 : 0);
  if (forwardShift !== 0) {
    ctx.translate(0, forwardShift);
  }

  // Jumping arm flair
  const armFlair = visualElevation > 1 ? Math.min(1.2, visualElevation * 0.2) : 0;

  // --- Layer 1: Legs & Boots (swinging under torso) ---
  // Left Leg (moves +stride)
  const leftLegY = -2 + stride;
  ctx.fillStyle = COLOR_BOOT;
  ctx.fillRect(-4.5, leftLegY, 4, 2);
  ctx.fillStyle = COLOR_BOOT_SOLE;
  ctx.fillRect(-4.5, leftLegY, 4, 0.7);
  ctx.fillStyle = COLOR_PANTS;
  ctx.fillRect(-4.5, leftLegY + 2, 4, 2);
  ctx.fillStyle = COLOR_PANTS_SHADOW;
  ctx.fillRect(-2.5, leftLegY + 2, 2, 2);

  // Right Leg (moves -stride)
  const rightLegY = -2 - stride;
  ctx.fillStyle = COLOR_BOOT;
  ctx.fillRect(0.5, rightLegY, 4, 2);
  ctx.fillStyle = COLOR_BOOT_SOLE;
  ctx.fillRect(0.5, rightLegY, 4, 0.7);
  ctx.fillStyle = COLOR_PANTS;
  ctx.fillRect(0.5, rightLegY + 2, 4, 2);
  ctx.fillStyle = COLOR_PANTS_SHADOW;
  ctx.fillRect(2.5, rightLegY + 2, 2, 2);

  // Torso cast shadow onto legs
  ctx.fillStyle = COLOR_DEPTH_SHADOW;
  ctx.fillRect(-4.5, -2, 9, 4);

  // --- Layer 2: Torso & Collar ---
  ctx.fillStyle = COLOR_SHIRT;
  ctx.fillRect(-4, -2, 8, 4);

  // 3D Bevel / Light rim on torso (NW light source)
  ctx.fillStyle = COLOR_SHIRT_LIGHT;
  ctx.fillRect(-4, -2, 8, 0.75);
  ctx.fillRect(-4, -2, 0.75, 4);
  ctx.fillStyle = COLOR_SHIRT_SHADOW;
  ctx.fillRect(-4, 1.25, 8, 0.75);
  ctx.fillRect(3.25, -2, 0.75, 4);

  // V-Neck collar with skin
  ctx.fillStyle = COLOR_SHIRT_COLLAR;
  ctx.fillRect(-2, -2, 4, 1.5);
  ctx.fillStyle = COLOR_SKIN;
  ctx.fillRect(-1.5, -2, 3, 1.2);
  ctx.fillStyle = COLOR_SKIN_SHADOW;
  ctx.fillRect(-0.75, -1.2, 1.5, 0.5);

  // --- Layer 3: Arms (swinging at sides, opposite to legs) ---
  // Left arm
  const armLeftX = -8.5 - armFlair;
  const armLeftY = -2 - stride * 1.15;
  ctx.fillStyle = COLOR_SHIRT;
  ctx.fillRect(armLeftX, armLeftY, 4, 2.5);
  ctx.fillStyle = COLOR_SHIRT_LIGHT;
  ctx.fillRect(armLeftX, armLeftY, 4, 0.6);
  ctx.fillRect(armLeftX, armLeftY, 0.6, 2.5);
  ctx.fillStyle = COLOR_SHIRT_SHADOW;
  ctx.fillRect(armLeftX, armLeftY + 1.9, 4, 0.6);
  ctx.fillStyle = COLOR_SKIN;
  ctx.fillRect(armLeftX, armLeftY + 2.5, 4, 1.5);
  ctx.fillStyle = COLOR_SKIN_SHADOW;
  ctx.fillRect(armLeftX, armLeftY + 3.4, 4, 0.6);

  // Right arm
  const armRightX = 4.5 + armFlair;
  const armRightY = -2 + stride * 1.15;
  ctx.fillStyle = COLOR_SHIRT;
  ctx.fillRect(armRightX, armRightY, 4, 2.5);
  ctx.fillStyle = COLOR_SHIRT_LIGHT;
  ctx.fillRect(armRightX, armRightY, 4, 0.6);
  ctx.fillStyle = COLOR_SHIRT_SHADOW;
  ctx.fillRect(armRightX + 3.4, armRightY, 0.6, 2.5);
  ctx.fillRect(armRightX, armRightY + 1.9, 4, 0.6);
  ctx.fillStyle = COLOR_SKIN;
  ctx.fillRect(armRightX, armRightY + 2.5, 4, 1.5);
  ctx.fillStyle = COLOR_SKIN_SHADOW;
  ctx.fillRect(armRightX, armRightY + 3.4, 4, 0.6);

  // --- Layer 4: Cast Shadow from Head onto Body ---
  ctx.fillStyle = COLOR_DEPTH_SHADOW;
  ctx.fillRect(-3.5, 0.5, 7, 2.5);

  // --- Layer 5: Head & 3D Face Front ---
  // Base hair on top of head (8 x 7.5 units)
  ctx.fillStyle = COLOR_HEAD_BASE;
  ctx.fillRect(-4, -4.5, 8, 7.5);

  // Minecraft pixelated hair texture strands
  ctx.fillStyle = COLOR_HEAD_DARK;
  ctx.fillRect(-4, -4.5, 2, 1);
  ctx.fillRect(1, -4.5, 2, 1);
  ctx.fillRect(-2, -3.5, 2, 1);
  ctx.fillRect(2, -3.5, 2, 1);
  ctx.fillRect(-4, -2.5, 1, 2);
  ctx.fillRect(0, -2.5, 2, 1);
  ctx.fillRect(-3, -0.5, 2, 1);
  ctx.fillRect(2, -0.5, 2, 1);
  ctx.fillRect(-1, 0.5, 2, 1);
  ctx.fillRect(-4, 1.5, 2, 1.5);
  ctx.fillRect(2, 1.5, 2, 1.5);

  ctx.fillStyle = COLOR_HEAD_LIGHT;
  ctx.fillRect(-1, -3.5, 1, 1);
  ctx.fillRect(3, -2.5, 1, 1);
  ctx.fillRect(-2, -1.5, 2, 1);
  ctx.fillRect(1, 0.5, 1, 1);
  ctx.fillRect(-2, 1.5, 2, 1.5);

  // 3D Face Front (peeking forward in -Y direction)
  ctx.fillStyle = COLOR_SKIN;
  ctx.fillRect(-2.5, -5.5, 5, 1.2);
  ctx.fillStyle = COLOR_HEAD_DARK;
  ctx.fillRect(-4, -5.5, 1.5, 1.2);
  ctx.fillRect(2.5, -5.5, 1.5, 1.2);

  // Eyes (white sclera + blue pupils)
  ctx.fillStyle = COLOR_EYE_WHITE;
  ctx.fillRect(-3.0, -6.0, 1.6, 0.8);
  ctx.fillStyle = COLOR_EYE_PUPIL;
  ctx.fillRect(-2.2, -6.0, 0.8, 0.8);

  ctx.fillStyle = COLOR_EYE_WHITE;
  ctx.fillRect(1.4, -6.0, 1.6, 0.8);
  ctx.fillStyle = COLOR_EYE_PUPIL;
  ctx.fillRect(1.4, -6.0, 0.8, 0.8);

  // Nose / mustache center
  ctx.fillStyle = COLOR_BEARD;
  ctx.fillRect(-0.75, -5.7, 1.5, 0.6);

  // 3D Rim Highlights & Shadows on Head
  ctx.fillStyle = COLOR_HIGHLIGHT;
  ctx.fillRect(-4, -5.5, 0.75, 8.5);
  ctx.fillRect(-4, -5.5, 8, 0.6);
  ctx.fillStyle = COLOR_DEPTH_SHADOW;
  ctx.fillRect(3.25, -5.5, 0.75, 8.5);
  ctx.fillRect(-4, 2.4, 8, 0.6);

  ctx.restore();
}
