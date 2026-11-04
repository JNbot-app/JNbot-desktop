import React, { useEffect, useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { Section } from '../components/Section';
import { clipText } from '../components/Header';
import type { CliRuntime, BotDetails, BotChatMessage, BotInventorySlot } from '../types';
import {
  getBotState,
  getBotChat,
  sendBotChat,
  getBotInventory,
  clickBotInventory,
  botJoinGamemode,
  botToggleMovement,
  botTossItem,
  botCloseWindow,
  runBotControl,
} from '../actions';

interface BotViewProps {
  runtime: CliRuntime;
  width: number;
  height: number;
  onNotice: (msg: string) => void;
  onOpenJoin: () => void;
  onExitView: () => void;
}


export const BotView: React.FC<BotViewProps> = ({
  runtime,
  width,
  height,
  onNotice,
  onOpenJoin,
  onExitView,
}) => {
  const activeBots = Object.values(runtime.handler.getBootstrapRuntime().activeBots.bots);
  const [selectedBotIndex, setSelectedBotIndex] = useState(0);
  const [tab, setTab] = useState<'chat' | 'inventory' | 'controls'>('chat');
  const [botState, setBotState] = useState<BotDetails | null>(null);
  const [chatMessages, setChatMessages] = useState<BotChatMessage[]>([]);
  const [inventorySlots, setInventorySlots] = useState<BotInventorySlot[]>([]);
  const [inventoryTitle, setInventoryTitle] = useState('Inventory');
  const [chatInput, setChatInput] = useState('');
  const [selectedSlot, setSelectedSlot] = useState(0);
  const [chatScroll, setChatScroll] = useState(0);

  // Controls tab state
  const profileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const jndata = runtime.handler.settings.JNdata;
  const gamemodes = useMemo(() => {
    const gmObj = jndata?.servers?.[profileKey];
    if (gmObj && typeof gmObj === 'object') return Object.keys(gmObj);
    return ['survival', 'skyblock', 'factions', 'prison', 'lifesteal'];
  }, [jndata, profileKey]);

  const [selectedGmIndex, setSelectedGmIndex] = useState(0);
  const [controlActionIndex, setControlActionIndex] = useState(0);

  const selectedBot = activeBots[selectedBotIndex];

  // Refresh bot state and chat periodically
  useEffect(() => {
    if (!selectedBot) return;
    let cancelled = false;

    const fetchState = async () => {
      const stateRes = await getBotState(runtime, selectedBot.botInfo.botId);
      if (!cancelled && stateRes.ok && stateRes.data) setBotState(stateRes.data);

      const chatRes = await getBotChat(runtime, selectedBot.botInfo.botId, 50);
      if (!cancelled && chatRes.ok && chatRes.data && chatRes.data.length > 0) {
        setChatMessages(chatRes.data);
      }
    };

    fetchState();
    const interval = setInterval(fetchState, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedBot, runtime]);

  // Refresh inventory when tab changes to inventory
  useEffect(() => {
    if (!selectedBot || tab !== 'inventory') return;
    let cancelled = false;
    const fetchInv = async () => {
      const invRes = await getBotInventory(runtime, selectedBot.botInfo.botId);
      if (!cancelled && invRes.ok && invRes.data) {
        setInventorySlots(invRes.data.items);
        setInventoryTitle(invRes.data.title || 'Inventory');
      }
    };
    fetchInv();
    const interval = setInterval(fetchInv, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedBot, tab, runtime]);

  useInput(async (input, key) => {
    if (!selectedBot) {
      if (input === 'j') onOpenJoin();
      if (key.escape) onExitView();
      return;
    }

    // Switch between multiple bots with [ and ] (when in inventory or controls or if ctrl pressed)
    if ((key.ctrl && input === '[') || (tab !== 'chat' && input === '[')) {
      setSelectedBotIndex((i) => (i - 1 + activeBots.length) % activeBots.length);
      return;
    }
    if ((key.ctrl && input === ']') || (tab !== 'chat' && input === ']')) {
      setSelectedBotIndex((i) => (i + 1) % activeBots.length);
      return;
    }

    // Tab key switches between sub-tabs
    if (key.tab) {
      if (tab === 'chat') setTab('inventory');
      else if (tab === 'inventory') setTab('controls');
      else setTab('chat');
      return;
    }

    // Escape exits BotView (or clears chat input if not empty)
    if (key.escape) {
      if (tab === 'chat' && chatInput) {
        setChatInput('');
      } else {
        onExitView();
      }
      return;
    }

    // TAB: CHAT
    if (tab === 'chat') {
      if (key.return) {
        if (chatInput.trim()) {
          const msg = chatInput.trim();
          setChatInput('');
          // Do not manually append to chatMessages; Minecraft server broadcasts back the chat
          void sendBotChat(runtime, selectedBot.botInfo.botId, msg);
        }
        return;
      }
      if (key.backspace || key.delete) {
        setChatInput((val) => val.slice(0, -1));
        return;
      }
      if (key.upArrow && !chatInput) {
        setChatScroll((s) => s + 1);
        return;
      }
      if (key.downArrow && !chatInput) {
        setChatScroll((s) => Math.max(0, s - 1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setChatInput((val) => val + input);
        return;
      }
      return;
    }

    // TAB: INVENTORY
    if (tab === 'inventory') {
      if (key.downArrow) {
        setSelectedSlot((s) => Math.min(s + 1, Math.max(0, inventorySlots.length - 1)));
        return;
      }
      if (key.upArrow) {
        setSelectedSlot((s) => Math.max(0, s - 1));
        return;
      }

      const highlightedItem = inventorySlots[selectedSlot];

      // Left click
      if (key.return) {
        if (highlightedItem) {
          await clickBotInventory(runtime, selectedBot.botInfo.botId, highlightedItem.slot, 0, 0);
          onNotice(`Clicked slot ${highlightedItem.slot} (${highlightedItem.displayName}).`);
        }
        return;
      }
      // Right click
      if (input === ' ') {
        if (highlightedItem) {
          await clickBotInventory(runtime, selectedBot.botInfo.botId, highlightedItem.slot, 1, 0);
          onNotice(`Right-clicked slot ${highlightedItem.slot}.`);
        }
        return;
      }
      // Shift click
      if (input === 's') {
        if (highlightedItem) {
          await clickBotInventory(runtime, selectedBot.botInfo.botId, highlightedItem.slot, 0, 1);
          onNotice(`Shift-clicked slot ${highlightedItem.slot}.`);
        }
        return;
      }
      // Toss item
      if (input === 't') {
        await botTossItem(runtime, selectedBot.botInfo.botId);
        onNotice('Dropped held item.');
        return;
      }
      // Close window
      if (input === 'c') {
        await botCloseWindow(runtime, selectedBot.botInfo.botId);
        onNotice('Closed window.');
        return;
      }
      return;
    }

    // TAB: CONTROLS
    if (tab === 'controls') {
      const totalControlItems = 8;
      if (key.downArrow) {
        setControlActionIndex((idx) => Math.min(idx + 1, totalControlItems - 1));
        return;
      }
      if (key.upArrow) {
        setControlActionIndex((idx) => Math.max(0, idx - 1));
        return;
      }

      // Action 0: Join Gamemode
      if (controlActionIndex === 0) {
        if (key.leftArrow) {
          setSelectedGmIndex((idx) => (idx - 1 + gamemodes.length) % gamemodes.length);
        } else if (key.rightArrow || input === ' ') {
          setSelectedGmIndex((idx) => (idx + 1) % gamemodes.length);
        } else if (key.return) {
          const gm = gamemodes[selectedGmIndex];
          const res = await botJoinGamemode(runtime, selectedBot.botInfo.botId, gm);
          onNotice(res.ok ? `Joining ${gm}…` : (res.error || 'Failed'));
        }
        return;
      }

      // Action 1: Auto-Login / Password
      if (controlActionIndex === 1 && key.return) {
        const alts = runtime.handler.settings.getAltsWithDataForProfile(profileKey);
        const alt = alts.find((a) => a.username.toLowerCase() === selectedBot.botInfo.username.toLowerCase());
        const pwd = alt?.data?.password;
        if (pwd) {
          await sendBotChat(runtime, selectedBot.botInfo.botId, `/login ${pwd}`);
          onNotice('Sent /login with stored alt password.');
        } else {
          await runBotControl(runtime, selectedBot.botInfo.botId, 'login');
          onNotice('Triggered login sequence.');
        }
        return;
      }

      // Action 2: Activate Held Item
      if (controlActionIndex === 2 && key.return) {
        await runBotControl(runtime, selectedBot.botInfo.botId, 'activateItem');
        onNotice('Activated held item.');
        return;
      }

      // Action 3: Toss / Drop Item
      if (controlActionIndex === 3 && key.return) {
        await botTossItem(runtime, selectedBot.botInfo.botId);
        onNotice('Dropped held item.');
        return;
      }

      // Action 4: Close Container
      if (controlActionIndex === 4 && key.return) {
        await botCloseWindow(runtime, selectedBot.botInfo.botId);
        onNotice('Closed container.');
        return;
      }

      // Action 5: Respawn
      if (controlActionIndex === 5 && key.return) {
        await runBotControl(runtime, selectedBot.botInfo.botId, 'respawn');
        onNotice('Respawning bot…');
        return;
      }

      // Action 6: Movement Controls (W forward, S back, A left, D right, Space jump, Shift sneak)
      if (controlActionIndex === 6) {
        if (input === 'w' || input === 'W') {
          await botToggleMovement(runtime, selectedBot.botInfo.botId, 'forward');
          onNotice('Toggled walk forward.');
        } else if (input === 's' || input === 'S') {
          await botToggleMovement(runtime, selectedBot.botInfo.botId, 'back');
          onNotice('Toggled walk backward.');
        } else if (input === 'a' || input === 'A') {
          await botToggleMovement(runtime, selectedBot.botInfo.botId, 'left');
          onNotice('Toggled walk left.');
        } else if (input === 'd' || input === 'D') {
          await botToggleMovement(runtime, selectedBot.botInfo.botId, 'right');
          onNotice('Toggled walk right.');
        } else if (input === ' ') {
          await botToggleMovement(runtime, selectedBot.botInfo.botId, 'jump');
          onNotice('Toggled jump.');
        } else if (input === 'n' || input === 'N') {
          await botToggleMovement(runtime, selectedBot.botInfo.botId, 'sneak');
          onNotice('Toggled sneak.');
        }
        return;
      }

      // Action 7: Disconnect
      if (controlActionIndex === 7 && key.return) {
        await runBotControl(runtime, selectedBot.botInfo.botId, 'disconnect');
        onNotice(`Disconnected ${selectedBot.botInfo.username}.`);
        return;
      }
    }
  });

  if (activeBots.length === 0) {
    return (
      <Section title="Active Bots">
        <Box flexDirection="column" marginY={1}>
          <Text dimColor>No bots are currently connected to any server.</Text>
          <Box marginTop={1}>
            <Text color="cyan">Press [j] to start and join a bot · Esc back.</Text>
          </Box>
        </Box>
      </Section>
    );
  }

  // Dynamically compute chat limit to fill the terminal window
  const chatLimit = Math.max(6, height - 11);
  const endSlice = Math.max(0, chatMessages.length - chatScroll);
  const startSlice = Math.max(0, endSlice - chatLimit);
  const visibleChat = chatMessages.slice(startSlice, endSlice);

  const invLimit = Math.max(6, height - 12);
  const invStart = Math.max(
    0,
    Math.min(selectedSlot - Math.floor(invLimit / 2), Math.max(0, inventorySlots.length - invLimit)),
  );
  const visibleInv = inventorySlots.slice(invStart, invStart + invLimit);

  const healthVal = botState?.health ?? 20;
  const foodVal = botState?.food ?? 20;
  const pos = botState?.position;

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Bot Selector Bar if multiple bots */}
      {activeBots.length > 1 ? (
        <Box justifyContent="space-between" marginBottom={0} paddingX={1}>
          <Box gap={1}>
            <Text dimColor>Bots:</Text>
            {activeBots.map((b, idx) => (
              <Text
                key={b.botInfo.botId}
                color={idx === selectedBotIndex ? 'cyan' : 'gray'}
                bold={idx === selectedBotIndex}
              >
                {idx === selectedBotIndex ? '●' : '○'} {b.botInfo.username}
              </Text>
            ))}
          </Box>
          <Text dimColor>[ / ] switch bot · Esc back</Text>
        </Box>
      ) : null}

      {/* Compact Bot Status Bar */}
      <Box justifyContent="space-between" paddingX={1} marginBottom={0}>
        <Box gap={1} flexWrap="wrap">
          <Text>
            Bot: <Text color="green" bold>{selectedBot.botInfo.username}</Text>{' '}
            <Text dimColor>({selectedBot.botInfo.host})</Text>
          </Text>
          <Text>
            ♥ <Text color={healthVal > 10 ? 'green' : healthVal > 5 ? 'yellow' : 'red'}>{healthVal}/20</Text>
          </Text>
          <Text>
            🍖 <Text color="yellow">{foodVal}/20</Text>
          </Text>
          <Text color="cyan">{botState?.gamemode ?? 'survival'}</Text>
          {pos ? (
            <Text dimColor>
              XYZ: {Math.round(pos.x)},{Math.round(pos.y)},{Math.round(pos.z)}
            </Text>
          ) : null}
          {botState?.heldItem ? (
            <Text>
              Held: <Text color="white">{clipText(botState.heldItem, 14)}</Text>
            </Text>
          ) : null}
        </Box>
      </Box>

      {/* Sub-Tabs Switcher */}
      <Box gap={2} marginBottom={0} paddingX={1}>
        <Text color={tab === 'chat' ? 'cyan' : 'gray'} bold={tab === 'chat'}>
          {tab === 'chat' ? '▶ ' : '  '}[1] Live Chat
        </Text>
        <Text color={tab === 'inventory' ? 'cyan' : 'gray'} bold={tab === 'inventory'}>
          {tab === 'inventory' ? '▶ ' : '  '}[2] Inventory ({inventorySlots.length})
        </Text>
        <Text color={tab === 'controls' ? 'cyan' : 'gray'} bold={tab === 'controls'}>
          {tab === 'controls' ? '▶ ' : '  '}[3] Controls &amp; Actions
        </Text>
        <Text dimColor>(Tab switches · Esc back)</Text>
      </Box>

      {/* SUB-TAB 1: LIVE CHAT */}
      {tab === 'chat' ? (
        <Section title="Live Server Chat" flexGrow={1} marginBottom={0}>
          <Box flexDirection="column" flexGrow={1} height={chatLimit}>
            {visibleChat.length > 0 ? (
              visibleChat.map((msg, i) => (
                <Text key={`${msg.timestamp}-${i}`} wrap="truncate">
                  {msg.sender ? <Text color="cyan">&lt;{msg.sender}&gt; </Text> : ''}
                  {msg.text}
                </Text>
              ))
            ) : (
              <Text dimColor>No messages yet. Send a message or command below.</Text>
            )}
          </Box>
          {/* Prominent Chat Input Prompt */}
          <Box marginTop={0} borderStyle="single" borderColor="cyan" paddingX={1}>
            <Text bold color="cyan">&gt; </Text>
            {chatInput.length > 0 ? (
              <Text bold color="yellow">{chatInput}</Text>
            ) : (
              <Text dimColor>Type message or /command and press Enter...</Text>
            )}
            <Text inverse> </Text>
          </Box>
          <Text dimColor>Type message or /command and press Enter · ↑↓ scroll chat</Text>
        </Section>
      ) : null}

      {/* SUB-TAB 2: INVENTORY */}
      {tab === 'inventory' ? (
        <Section title={`${inventoryTitle} (${inventorySlots.length} items)`} flexGrow={1} marginBottom={0}>
          <Box flexDirection="column" flexGrow={1} height={invLimit}>
            {visibleInv.length > 0 ? (
              visibleInv.map((slot, i) => {
                const actualIdx = invStart + i;
                const isSelected = selectedSlot === actualIdx;
                return (
                  <Box key={`${slot.slot}-${i}`} justifyContent="space-between">
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '› ' : '  '}
                      [{slot.slot}] {clipText(slot.displayName || slot.name, Math.max(16, width - 30))}
                    </Text>
                    <Text color={slot.count > 1 ? 'yellow' : 'white'}>
                      ×{slot.count}
                    </Text>
                  </Box>
                );
              })
            ) : (
              <Text dimColor>Inventory is empty.</Text>
            )}
            {inventorySlots.length > visibleInv.length ? (
              <Text dimColor>
                {invStart + 1}–{invStart + visibleInv.length} of {inventorySlots.length}
              </Text>
            ) : null}
          </Box>
          <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
            <Text color="cyan">
              ↑↓ select · Enter left-click · Space right-click · [s] shift-click · [t] toss · [c] close
            </Text>
          </Box>
        </Section>
      ) : null}

      {/* SUB-TAB 3: CONTROLS & ACTIONS */}
      {tab === 'controls' ? (
        <Section title="Bot Controls &amp; Movement" flexGrow={1} marginBottom={0}>
          <Box flexDirection="column" flexGrow={1}>
            {/* Gamemode Selector */}
            <Box justifyContent="space-between">
              <Text color={controlActionIndex === 0 ? 'cyan' : undefined} bold={controlActionIndex === 0}>
                {controlActionIndex === 0 ? '› ' : '  '}Join Gamemode:
              </Text>
              <Text color={controlActionIndex === 0 ? 'yellow' : 'white'}>
                ← {gamemodes[selectedGmIndex]} → (Enter to join)
              </Text>
            </Box>

            {/* Auto Login */}
            <Box justifyContent="space-between">
              <Text color={controlActionIndex === 1 ? 'cyan' : undefined} bold={controlActionIndex === 1}>
                {controlActionIndex === 1 ? '› ' : '  '}Auto-Login / Enter Password:
              </Text>
              <Text color={controlActionIndex === 1 ? 'green' : 'gray'}>
                [ Enter to run /login ]
              </Text>
            </Box>

            {/* Activate Item */}
            <Box justifyContent="space-between">
              <Text color={controlActionIndex === 2 ? 'cyan' : undefined} bold={controlActionIndex === 2}>
                {controlActionIndex === 2 ? '› ' : '  '}Activate Held Item:
              </Text>
              <Text color={controlActionIndex === 2 ? 'green' : 'gray'}>
                [ Enter to use/eat item ]
              </Text>
            </Box>

            {/* Toss Item */}
            <Box justifyContent="space-between">
              <Text color={controlActionIndex === 3 ? 'cyan' : undefined} bold={controlActionIndex === 3}>
                {controlActionIndex === 3 ? '› ' : '  '}Drop / Toss Held Item:
              </Text>
              <Text color={controlActionIndex === 3 ? 'green' : 'gray'}>
                [ Enter to drop item ]
              </Text>
            </Box>

            {/* Close Container */}
            <Box justifyContent="space-between">
              <Text color={controlActionIndex === 4 ? 'cyan' : undefined} bold={controlActionIndex === 4}>
                {controlActionIndex === 4 ? '› ' : '  '}Close Open Container / Chest:
              </Text>
              <Text color={controlActionIndex === 4 ? 'green' : 'gray'}>
                [ Enter to close window ]
              </Text>
            </Box>

            {/* Respawn */}
            <Box justifyContent="space-between">
              <Text color={controlActionIndex === 5 ? 'cyan' : undefined} bold={controlActionIndex === 5}>
                {controlActionIndex === 5 ? '› ' : '  '}Respawn:
              </Text>
              <Text color={controlActionIndex === 5 ? 'green' : 'gray'}>
                [ Enter to respawn bot ]
              </Text>
            </Box>

            {/* Movement */}
            <Box justifyContent="space-between">
              <Text color={controlActionIndex === 6 ? 'cyan' : undefined} bold={controlActionIndex === 6}>
                {controlActionIndex === 6 ? '› ' : '  '}Movement Controls:
              </Text>
              <Text color={controlActionIndex === 6 ? 'yellow' : 'gray'}>
                [W] Fwd · [S] Back · [A] Left · [D] Right · [Space] Jump · [N] Sneak
              </Text>
            </Box>

            {/* Disconnect */}
            <Box justifyContent="space-between">
              <Text color={controlActionIndex === 7 ? 'cyan' : undefined} bold={controlActionIndex === 7}>
                {controlActionIndex === 7 ? '› ' : '  '}Disconnect Session:
              </Text>
              <Text color={controlActionIndex === 7 ? 'red' : 'gray'}>
                [ Enter to disconnect ]
              </Text>
            </Box>
          </Box>

          <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
            <Text dimColor>↑↓ select action · Enter trigger · Tab switch tab · Esc back</Text>
          </Box>
        </Section>
      ) : null}
    </Box>
  );
};
