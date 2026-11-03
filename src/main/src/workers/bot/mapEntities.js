const MAX_DISTANCE_SQUARED = 64 * 64;
const MAX_ENTITIES = 128;

function mapEntities(bot) {
  const player = bot.entity?.position;
  if (!player) return [];
  const nearby = [];
  Object.values(bot.entities ?? {}).forEach((entity) => {
    if (
      entity.id === bot.entity.id ||
      (entity.type !== 'player' && entity.type !== 'mob')
    ) return;
    const { position } = entity;
    if (
      !position ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.z)
    ) return;
    const dx = position.x - player.x;
    const dz = position.z - player.z;
    const distance = dx * dx + dz * dz;
    if (distance <= MAX_DISTANCE_SQUARED) nearby.push({ entity, distance });
  });

  return nearby
    .sort((a, b) => a.distance - b.distance || a.entity.id - b.entity.id)
    .slice(0, MAX_ENTITIES)
    .map(({ entity }) => ({
      id: entity.id,
      kind: entity.type,
      name: String(entity.username ?? entity.displayName ?? entity.name ?? entity.mobType ?? entity.type).slice(0, 64),
      x: Math.round(entity.position.x * 10) / 10,
      y: Number.isFinite(entity.position.y) ? Math.round(entity.position.y * 10) / 10 : null,
      z: Math.round(entity.position.z * 10) / 10,
    }));
}

module.exports = mapEntities;
