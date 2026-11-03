import { mapAvatarPose, type MapMovement } from './WorldMapClass';

const idle: MapMovement = {
  yaw: 0, jump: false, sneak: false, sprint: false,
  forward: false, back: false, left: false, right: false, isPathfinding: false,
};

test('faces south at zero yaw and rotates with the player', () => {
  expect(mapAvatarPose(idle, false, false, 0).rotation).toBe(0);
  expect(mapAvatarPose({ ...idle, yaw: Math.PI / 2 }, false, false, 0).rotation).toBe(-Math.PI / 2);
});

test('changes limbs, height, and elevation for movement poses', () => {
  expect(mapAvatarPose(idle, false, false, 100).stride).toBe(0);
  expect(mapAvatarPose(idle, true, false, 100).stride).not.toBe(0);
  expect(mapAvatarPose({ ...idle, sneak: true }, false, false, 100).bodyHeight).toBe(7);
  expect(mapAvatarPose(idle, false, true, 100).elevation).toBe(4);
  expect(mapAvatarPose({ ...idle, sprint: true }, true, false, 100).stride).not.toBe(mapAvatarPose(idle, true, false, 100).stride);
});
