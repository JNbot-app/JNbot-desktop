const mapEntities = require('../../src/main/src/workers/bot/mapEntities');

describe('map entity snapshot', () => {
  const entity = (id: number, type: string, x: number, z: number) => ({
    id, type, position: { x, z }, name: `entity-${id}`,
  });

  test('includes nearby players and mobs only', () => {
    const bot = {
      entity: entity(1, 'player', 0, 0),
      entities: {
        1: entity(1, 'player', 0, 0),
        2: entity(2, 'player', 2.24, 3.26),
        3: entity(3, 'mob', 64, 0),
        4: entity(4, 'other', 1, 1),
        5: entity(5, 'mob', 65, 0),
      },
    };

    expect(mapEntities(bot)).toEqual([
      { id: 2, kind: 'player', name: 'entity-2', x: 2.2, y: null, z: 3.3 },
      { id: 3, kind: 'mob', name: 'entity-3', x: 64, y: null, z: 0 },
    ]);
  });

  test('keeps the closest 128 in a crowded area', () => {
    const entities = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [index + 2, entity(index + 2, 'mob', index / 5, 0)]),
    );
    const snapshot = mapEntities({ entity: entity(1, 'player', 0, 0), entities });

    expect(snapshot).toHaveLength(128);
    expect(snapshot[0].id).toBe(2);
    expect(snapshot[127].id).toBe(129);
  });

  test('includes compact display names and vertical position', () => {
    const mob = { ...entity(2, 'mob', 1, 2), displayName: 'Zombie', position: { x: 1, y: 63.47, z: 2 } };
    const player = { ...entity(3, 'player', 2, 3), username: 'Alex', position: { x: 2, y: 64, z: 3 } };
    const snapshot = mapEntities({ entity: entity(1, 'player', 0, 0), entities: { 2: mob, 3: player } });
    expect(snapshot).toEqual([
      { id: 2, kind: 'mob', name: 'Zombie', x: 1, y: 63.5, z: 2 },
      { id: 3, kind: 'player', name: 'Alex', x: 2, y: 64, z: 3 },
    ]);
  });
});
