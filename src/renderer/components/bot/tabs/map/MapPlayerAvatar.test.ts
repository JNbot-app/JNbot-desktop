import { drawTopDownPlayer, DrawPlayerAvatarParams } from './MapPlayerAvatar';

describe('drawTopDownPlayer', () => {
  let mockCtx: any;
  let filledRects: Array<{ x: number; y: number; w: number; h: number; fillStyle: string }>;
  let ellipses: Array<{ x: number; y: number; rx: number; ry: number; fillStyle: string }>;

  beforeEach(() => {
    filledRects = [];
    ellipses = [];
    mockCtx = {
      save: jest.fn(),
      restore: jest.fn(),
      translate: jest.fn(),
      rotate: jest.fn(),
      beginPath: jest.fn(),
      fill: jest.fn(),
      ellipse: jest.fn((x: number, y: number, rx: number, ry: number) => {
        ellipses.push({ x, y, rx, ry, fillStyle: mockCtx.fillStyle });
      }),
      fillRect: jest.fn((x: number, y: number, w: number, h: number) => {
        filledRects.push({ x, y, w, h, fillStyle: mockCtx.fillStyle });
      }),
      fillStyle: '#000000',
    };
  });

  const defaultParams: DrawPlayerAvatarParams = {
    x: 100,
    y: 200,
    rotation: Math.PI,
    stride: 0,
    visualElevation: 0,
    moving: false,
    sprinting: false,
    sneaking: false,
  };

  it('draws ground drop shadow at ground position without elevation offset', () => {
    drawTopDownPlayer(mockCtx, { ...defaultParams, visualElevation: 5 });

    expect(mockCtx.save).toHaveBeenCalledTimes(2);
    expect(mockCtx.restore).toHaveBeenCalledTimes(2);

    // First translation is the ground shadow at (100, 200)
    expect(mockCtx.translate).toHaveBeenNthCalledWith(1, 100, 200);
    expect(mockCtx.rotate).toHaveBeenNthCalledWith(1, Math.PI);
    expect(ellipses.length).toBe(1);

    // Second translation is the elevated player at (100, 195)
    expect(mockCtx.translate).toHaveBeenNthCalledWith(2, 100, 195);
  });

  it('draws 3D player body parts including boots, pants, shirt, collar, arms, hair and face', () => {
    drawTopDownPlayer(mockCtx, defaultParams);

    expect(filledRects.length).toBeGreaterThan(20);

    // Check presence of cyan shirt
    expect(filledRects.some((r) => r.fillStyle === '#15979b')).toBe(true);
    // Check presence of blue pants
    expect(filledRects.some((r) => r.fillStyle === '#27234b')).toBe(true);
    // Check presence of boots
    expect(filledRects.some((r) => r.fillStyle === '#39373c')).toBe(true);
    // Check presence of Steve eyes
    expect(filledRects.some((r) => r.fillStyle === '#385a8c')).toBe(true);
    // Check presence of skin
    expect(filledRects.some((r) => r.fillStyle === '#b67d59')).toBe(true);
    // Check presence of hair
    expect(filledRects.some((r) => r.fillStyle === '#4a321e')).toBe(true);
  });

  it('offsets limbs when walking stride is non-zero', () => {
    drawTopDownPlayer(mockCtx, { ...defaultParams, stride: 3, moving: true });

    // Left and right boots should have different Y coordinates
    const boots = filledRects.filter((r) => r.fillStyle === '#39373c');
    expect(boots.length).toBe(2);
    expect(boots[0].y).not.toBe(boots[1].y);
  });

  it('shifts body forward when sneaking', () => {
    drawTopDownPlayer(mockCtx, { ...defaultParams, sneaking: true });

    // Expect a forward shift translation
    expect(mockCtx.translate).toHaveBeenCalledWith(0, -1.5);
  });
});
