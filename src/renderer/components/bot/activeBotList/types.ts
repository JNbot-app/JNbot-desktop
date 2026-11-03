import { ActiveBotsType } from 'main/src/types';
import React from 'react';

export type ActiveBot = ActiveBotsType[number];

export interface ActiveBotsListProps {
  /** Optional ID of the currently selected bot */
  selectedBotId?: number | string | null;
  /** Callback when a bot card is clicked (enables card selection mode) */
  onSelectBot?: (bot: ActiveBot) => void;
  /** Render in compact layout for sidebars and narrower panels */
  compact?: boolean;
  /** Custom empty state text */
  emptyText?: string;
  /** Custom container style */
  style?: React.CSSProperties;
  /** Custom container class */
  className?: string;
}

export interface ActiveBotCardProps {
  bot: ActiveBot;
  selected?: boolean;
  onSelect?: (bot: ActiveBot) => void;
  compact?: boolean;
  now?: number;
}

export interface ActiveBotActionsProps {
  bot: ActiveBot;
  compact?: boolean;
}
