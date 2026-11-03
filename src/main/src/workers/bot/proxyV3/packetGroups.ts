import type { ProxyPacketGroup } from '../../../../../common/types/proxyApi';

/** c2s packet names by purpose, across protocol versions. For `session.grant`. */
export const PacketGroups: Readonly<Record<ProxyPacketGroup, readonly string[]>> = {
  movement: ['position', 'position_look', 'look', 'flying', 'vehicle_move', 'steer_vehicle', 'entity_action'],
  inventory: ['window_click', 'close_window', 'held_item_slot', 'set_creative_slot', 'craft_recipe_request'],
  interaction: ['block_dig', 'block_place', 'use_item', 'use_entity', 'arm_animation', 'update_sign'],
  chat: ['chat', 'chat_message', 'chat_command', 'chat_command_signed', 'tab_complete'],
};
