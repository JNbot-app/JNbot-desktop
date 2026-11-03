import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import {
  deleteAlt,
  remoteAccessUrl,
  startRemote,
  useProfile,
  getProfileScriptItems,
  getInitialProfileScriptItems,
  getLibraryPluginItems,
  listCooldowns,
  toggleCooldownAutoStart,
  resetCooldown,
  updateCooldownDuration,
  removeCooldown,
  startDiscordBot,
  startProxy,
} from './actions';
import { layoutForWidth } from './layout';
import { commandArguments } from './commandLine';
import type { OutputRouter } from './output';
import { cliSnapshot } from './snapshot';
import type { CliRuntime, OutputEvent, Screen, RunItem, CooldownInfo } from './types';
import { ProfileWizardView } from './profileWizard';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { DashboardView } from './views/DashboardView';
import { ScriptsView } from './views/ScriptsView';
import { ScriptOptionsModal } from './views/ScriptOptionsModal';
import { BotView } from './views/BotView';
import { AltsView } from './views/AltsView';
import { AltFormModal } from './views/AltFormModal';
import { AltDetailsModal } from './views/AltDetailsModal';
import { ProfilesView } from './views/ProfilesView';
import { RemoteView } from './views/RemoteView';
import { LogsView } from './views/LogsView';
import { HelpView, COMMAND_GROUPS } from './views/HelpView';
import { ResultView } from './views/ResultView';
import { CommandPalette } from './views/CommandPalette';
import { JoinBotModal } from './views/JoinBotModal';
import { DeviceFormModal } from './views/DeviceFormModal';

export function CliApp({
  runtime,
  output,
  onExit,
}: {
  runtime: CliRuntime;
  output: OutputRouter;
  onExit(): void;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [events, setEvents] = useState<readonly OutputEvent[]>(output.list());
  const [now, setNow] = useState(0);
  const [notice, setNotice] = useState<string>();
  const [palette, setPalette] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedPalette, setSelectedPalette] = useState(0);
  const [selectedHelp, setSelectedHelp] = useState(0);
  const [selectedResult, setSelectedResult] = useState(0);
  const [selectedScript, setSelectedScript] = useState(0);
  const [selectedPlugin, setSelectedPlugin] = useState(0);
  const [selectedCooldown, setSelectedCooldown] = useState(0);
  const [scriptsFocus, setScriptsFocus] = useState<'scripts' | 'plugins' | 'cooldowns'>('scripts');
  const [selectedAlt, setSelectedAlt] = useState(0);
  const [selectedProfile, setSelectedProfile] = useState(0);
  const [selectedDevice, setSelectedDevice] = useState(0);
  const [revealedDevice, setRevealedDevice] = useState<string>();
  const [revealedMode, setRevealedMode] = useState<'mobile' | 'web'>('web');
  const [confirmRemoval, setConfirmRemoval] = useState<'device' | 'alt' | null>(null);
  const [commandOutput, setCommandOutput] = useState<string[]>([]);
  const [resultReturn, setResultReturn] = useState<Screen>('dashboard');

  // Modals
  const [scriptOptionsItem, setScriptOptionsItem] = useState<RunItem | null>(null);
  const [selectedAltItem, setSelectedAltItem] = useState<any | null>(null);
  const [altToEdit, setAltToEdit] = useState<any | null>(null);
  const [altFormOpen, setAltFormOpen] = useState(false);
  const [joinFormOpen, setJoinFormOpen] = useState(false);
  const [deviceFormOpen, setDeviceFormOpen] = useState(false);

  const width = stdout?.columns ?? 80;
  const height = stdout?.rows ?? 24;
  const snapshot = useMemo(() => cliSnapshot(runtime), [runtime, now]);
  const profiles = runtime.handler.settings.getAvailableProfiles();
  const activeProfileKey = runtime.handler.getBootstrapRuntime().profileKey;
  const hasValidProfile = profiles.some((p) => p.server === activeProfileKey);
  const [wizardOpen, setWizardOpen] = useState(false);
  const isWizardActive = !hasValidProfile || wizardOpen;
  const devices = Object.values(runtime.handler.deviceHandler.getDevices());
  const alts = runtime.handler.settings.getAltsWithDataForProfile(snapshot.profile.id);

  const [profileScripts, setProfileScripts] = useState<RunItem[]>(() =>
    getInitialProfileScriptItems(runtime),
  );
  const [libraryPlugins, setLibraryPlugins] = useState<RunItem[]>(() =>
    getLibraryPluginItems(runtime),
  );
  const [cooldowns, setCooldowns] = useState<CooldownInfo[]>(() =>
    listCooldowns(runtime).data ?? [],
  );

  useEffect(() => {
    let cancelled = false;
    getProfileScriptItems(runtime)
      .then((items) => {
        if (!cancelled && items.length) {
          setProfileScripts(items);
        }
      })
      .catch(() => undefined);
    setLibraryPlugins(getLibraryPluginItems(runtime));
    const cdRes = listCooldowns(runtime);
    if (cdRes.ok && cdRes.data) setCooldowns(cdRes.data);
    return () => {
      cancelled = true;
    };
  }, [runtime, snapshot.profile.id, now]);

  const layout = layoutForWidth(width);
  const compact = layout === 'compact';

  useEffect(() => {
    setSelectedScript((value) => Math.min(value, Math.max(0, profileScripts.length - 1)));
    setSelectedPlugin((value) => Math.min(value, Math.max(0, libraryPlugins.length - 1)));
    setSelectedAlt((value) => Math.min(value, Math.max(0, alts.length - 1)));
    setSelectedProfile((value) => Math.min(value, Math.max(0, profiles.length - 1)));
    setSelectedDevice((value) => Math.min(value, Math.max(0, devices.length - 1)));
  }, [alts.length, devices.length, profiles.length, profileScripts.length, libraryPlugins.length]);

  useEffect(() => {
    const onEvent = () => setEvents([...output.list()]);
    output.on('event', onEvent);
    return () => {
      output.off('event', onEvent);
    };
  }, [output]);

  useEffect(() => {
    const seen = new WeakSet<object>();
    const syncLogs = () => {
      for (const log of runtime.handler.getBootstrapRuntime().consoleHandler.getAllLogs()) {
        if (!seen.has(log)) {
          seen.add(log);
          output.pushScriptLog(log);
        }
      }
    };
    syncLogs();
    const timer = setInterval(syncLogs, 250);
    return () => clearInterval(timer);
  }, [output, runtime]);

  useEffect(() => {
    const timer = setInterval(() => setNow((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const leave = () => {
    onExit();
    exit();
  };

  const showResult = (result: { ok: boolean; error?: string }, success: string) => {
    setNotice(result.ok ? success : result.error ?? 'Operation failed.');
    setNow((value) => value + 1);
  };

  const paletteItems = [
    ...COMMAND_GROUPS.flatMap(([group, commands]) =>
      commands.map((label) => ({ label, description: group })),
    ),
    ...profileScripts.map((item) => ({
      label: `script run "${item.name}"`,
      description: `Run profile script ${item.name}`,
    })),
    ...libraryPlugins.map((item) => ({
      label: `plugin run "${item.id}"`,
      description: `Run plugin ${item.name}`,
    })),
    { label: 'remote stop', description: 'Stop remote server' },
    { label: 'script stop all', description: 'Stop all active scripts' },
  ];

  const normalizedQuery = query.trim().replace(/^jnbot\s+/i, '').toLowerCase();
  const matches = paletteItems.filter(
    (item) =>
      item.label.toLowerCase().includes(normalizedQuery) ||
      item.description.toLowerCase().includes(normalizedQuery),
  );

  const executeCommand = async (source: string) => {
    const command = source.trim().replace(/^jnbot(?:\s+|$)/i, '');
    if (
      [
        'dashboard',
        'scripts',
        'bots',
        'logs',
        'profiles',
        'alts',
        'remote',
        'help',
      ].includes(command)
    ) {
      setPalette(false);
      setQuery('');
      setScreen(command as Screen);
      return;
    }
    if (command === 'remote stop') {
      setPalette(false);
      setQuery('');
      runtime.handler.deviceHandler.stop('peer2peer' as never);
      setNotice('Remote access stopped.');
      return;
    }
    if (command === 'script stop all') {
      setPalette(false);
      setQuery('');
      runtime.handler.stopAllScripts();
      setNotice('Stopped all scripts.');
      return;
    }
    if (command === 'bot join') {
      setPalette(false);
      setQuery('');
      setJoinFormOpen(true);
      return;
    }
    try {
      const { createProgram } = await import('./commands');
      const showOutput = (text: string) => {
        setPalette(false);
        setQuery('');
        setCommandOutput(text.trimEnd().split('\n'));
        setSelectedResult(0);
        setResultReturn(screen);
        setScreen('result');
      };
      const program = createProgram({
        runtime,
        onOutput: showOutput,
        onResult: (result) => {
          if (!result.ok) {
            setPalette(false);
            setQuery('');
            setNotice(result.error ?? 'Command failed.');
          } else if (result.data !== undefined)
            showOutput(JSON.stringify(result.data, null, 2));
          else setNotice('Command completed.');
          setNow((value) => value + 1);
        },
      });
      program.exitOverride();
      await program.parseAsync(['node', 'jnbot', ...commandArguments(command)]);
    } catch (error: any) {
      setPalette(false);
      setQuery('');
      if (
        error?.code !== 'commander.helpDisplayed' &&
        error?.code !== 'commander.version'
      )
        setNotice(error?.message ?? String(error));
    }
  };

  useInput(async (input, key) => {
    if (key.ctrl && input === 'c') {
      leave();
      return;
    }
    if (isWizardActive) {
      return;
    }
    if (scriptOptionsItem || selectedAltItem || altFormOpen || joinFormOpen || deviceFormOpen) {
      return;
    }

    if (palette) {
      if (key.escape) {
        setPalette(false);
        setQuery('');
        return;
      }
      if (key.tab && matches[selectedPalette]) {
        setQuery(
          `${/^jnbot\s/i.test(query) ? 'jnbot ' : ''}${matches[selectedPalette].label}`,
        );
        return;
      }
      if (key.downArrow) {
        setSelectedPalette((value) =>
          Math.min(value + 1, Math.max(0, matches.length - 1)),
        );
        return;
      }
      if (key.upArrow) {
        setSelectedPalette((value) => Math.max(0, value - 1));
        return;
      }
      if (key.return) {
        const command = query.trim() || matches[selectedPalette]?.label;
        if (command) await executeCommand(command);
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((value) => value.slice(0, -1));
        setSelectedPalette(0);
      } else if (input && !key.ctrl && !key.meta) {
        setQuery((value) => value + input);
        setSelectedPalette(0);
      }
      return;
    }

    if (screen === 'result') {
      // Fix for Requirement 7: Allow pressing / directly from result screen to start next command!
      if (input === '/' || (key.ctrl && input === 'k')) {
        setPalette(true);
        return;
      }
      if (key.escape || input === 'q') {
        setCommandOutput([]);
        setScreen(resultReturn);
        return;
      }
      if (key.downArrow)
        setSelectedResult((value) =>
          Math.min(value + 1, Math.max(0, commandOutput.length - 1)),
        );
      if (key.upArrow) setSelectedResult((value) => Math.max(0, value - 1));
      return;
    }

    if (confirmRemoval) {
      if (input === 'y') {
        if (confirmRemoval === 'device') {
          const device = devices[selectedDevice];
          if (device) runtime.handler.deviceHandler.removeDevice(device.id);
          setNotice('Access link revoked.');
          setSelectedDevice((value) => Math.max(0, value - 1));
          setRevealedDevice(undefined);
        } else {
          const alt = alts[selectedAlt];
          if (alt)
            showResult(
              deleteAlt(runtime, alt.username),
              `Removed ${alt.username}.`,
            );
          setSelectedAlt((value) => Math.max(0, value - 1));
        }
      } else setNotice('Removal cancelled.');
      setConfirmRemoval(null);
      return;
    }

    // Isolate screen === 'bots': BotView handles all chat input, movement, and controls
    if (screen === 'bots') {
      return;
    }

    // Global navigation shortcuts (when not in sub-modal or chat)
    if (input === '/' || (key.ctrl && input === 'k')) {
      setPalette(true);
      return;
    }
    if (input === 'q') {
      leave();
      return;
    }
    if (input === '?') {
      setScreen('help');
      return;
    }
    if (input === '1') {
      setScreen('dashboard');
      return;
    }
    if (input === '2') {
      setScreen('scripts');
      return;
    }
    if (input === '3' || input === 'b') {
      setScreen('bots');
      return;
    }
    if (input === '4') {
      setScreen('logs');
      return;
    }
    if (input === 'p') {
      setScreen('profiles');
      return;
    }
    if (input === 'a') {
      setScreen('alts');
      return;
    }
    if (input === 'r' && screen !== 'scripts') {
      setScreen('remote');
      return;
    }

    // Screen-specific controls
    if (screen === 'scripts') {
      if (key.tab) {
        setScriptsFocus((f) => (f === 'scripts' ? 'plugins' : f === 'plugins' ? 'cooldowns' : 'scripts'));
        return;
      }
      if (scriptsFocus === 'scripts') {
        if (key.downArrow) {
          setSelectedScript((v) => Math.min(v + 1, Math.max(0, profileScripts.length - 1)));
          return;
        }
        if (key.upArrow) {
          setSelectedScript((v) => Math.max(0, v - 1));
          return;
        }
        if (key.return && profileScripts[selectedScript]) {
          setScriptOptionsItem(profileScripts[selectedScript]);
          return;
        }
      } else if (scriptsFocus === 'plugins') {
        if (key.downArrow) {
          setSelectedPlugin((v) => Math.min(v + 1, Math.max(0, libraryPlugins.length - 1)));
          return;
        }
        if (key.upArrow) {
          setSelectedPlugin((v) => Math.max(0, v - 1));
          return;
        }
        if (key.return && libraryPlugins[selectedPlugin]) {
          setScriptOptionsItem(libraryPlugins[selectedPlugin]);
          return;
        }
      } else if (scriptsFocus === 'cooldowns') {
        if (key.downArrow) {
          setSelectedCooldown((v) => Math.min(v + 1, Math.max(0, cooldowns.length - 1)));
          return;
        }
        if (key.upArrow) {
          setSelectedCooldown((v) => Math.max(0, v - 1));
          return;
        }
        const cd = cooldowns[selectedCooldown];
        if (cd) {
          if (input === ' ' || input === 'a') {
            const res = toggleCooldownAutoStart(runtime, cd.id);
            setNotice(res.ok ? `Auto-run ${res.data?.autoStart ? 'enabled' : 'disabled'} for ${cd.name}.` : 'Failed');
            setNow((v) => v + 1);
            return;
          }
          if (input === 'r') {
            resetCooldown(runtime, cd.id);
            setNotice(`Reset cooldown timer for ${cd.name}.`);
            setNow((v) => v + 1);
            return;
          }
          if (input === 'c' || input === 'e') {
            const presets = [60000, 300000, 900000, 1800000, 3600000, 21600000, 43200000, 86400000];
            const currentIdx = presets.indexOf(cd.cooldown);
            const nextMs = presets[(currentIdx + 1) % presets.length];
            updateCooldownDuration(runtime, cd.id, nextMs);
            setNotice(`Updated cooldown for ${cd.name} to ${Math.round(nextMs / 60000)}m.`);
            setNow((v) => v + 1);
            return;
          }
          if (input === 'd' || key.delete) {
            removeCooldown(runtime, cd.id);
            setNotice(`Removed cooldown for ${cd.name}.`);
            setNow((v) => v + 1);
            return;
          }
        }
      }
      if (input === 'j') {
        setJoinFormOpen(true);
        return;
      }
      if (input === 'd') {
        showResult(await startDiscordBot(runtime), 'Started Discord bot.');
        return;
      }
      if (input === 'x') {
        showResult(await startProxy(runtime), 'Started JNbot Proxy.');
        return;
      }
      if (input === 's') {
        runtime.handler.stopAllScripts();
        setNotice('Stopped all scripts.');
        return;
      }
    }

    if (screen === 'profiles') {
      if (input === 'm' || input === 'n') {
        setWizardOpen(true);
        return;
      }
      if (key.downArrow) {
        setSelectedProfile((value) =>
          Math.min(value + 1, Math.max(0, profiles.length - 1)),
        );
        return;
      }
      if (key.upArrow) {
        setSelectedProfile((value) => Math.max(0, value - 1));
        return;
      }
      if (key.return && profiles[selectedProfile])
        showResult(
          await useProfile(runtime, profiles[selectedProfile].server),
          `Using ${profiles[selectedProfile].data.name ?? profiles[selectedProfile].server}.`,
        );
      return;
    }

    if (screen === 'alts') {
      if (key.downArrow) {
        setSelectedAlt((value) =>
          Math.min(value + 1, Math.max(0, alts.length - 1)),
        );
        return;
      }
      if (key.upArrow) {
        setSelectedAlt((value) => Math.max(0, value - 1));
        return;
      }
      if (key.return && alts[selectedAlt]) {
        setSelectedAltItem(alts[selectedAlt]);
        return;
      }
      if (input === 'n') {
        setAltToEdit(null);
        setAltFormOpen(true);
        return;
      }
      if ((input === 'd' || key.delete) && alts[selectedAlt]) {
        setConfirmRemoval('alt');
        setNotice(
          `Remove ${alts[selectedAlt].username} from this profile? Press y to confirm.`,
        );
      }
      return;
    }

    if (screen === 'remote') {
      if (key.downArrow) {
        setSelectedDevice((value) =>
          Math.min(value + 1, Math.max(0, devices.length - 1)),
        );
        setRevealedDevice(undefined);
        return;
      }
      if (key.upArrow) {
        setSelectedDevice((value) => Math.max(0, value - 1));
        setRevealedDevice(undefined);
        return;
      }
      if (key.tab || input === 'm' || input === 'w') {
        setRevealedMode((mode) => (mode === 'mobile' ? 'web' : 'mobile'));
        return;
      }
      if (key.escape && revealedDevice) {
        setRevealedDevice(undefined);
        return;
      }
      if (input === 's') {
        showResult(await startRemote(runtime), 'Remote access started.');
        return;
      }
      if (input === 'x') {
        runtime.handler.deviceHandler.stop('peer2peer' as never);
        setNotice('Remote access stopped.');
        return;
      }
      if (input === 'n') {
        setDeviceFormOpen(true);
        return;
      }
      if ((input === 'd' || key.delete) && devices[selectedDevice]) {
        setConfirmRemoval('device');
        setNotice(`Revoke ${devices[selectedDevice].name}? Press y to confirm.`);
        return;
      }
      if ((input === 'v' || key.return) && devices[selectedDevice]) {
        const devId = devices[selectedDevice].id;
        if (revealedDevice === devId) {
          setRevealedDevice(undefined);
        } else {
          const result = remoteAccessUrl(runtime, devId);
          if (result.ok) setRevealedDevice(devId);
          else setNotice(result.error);
        }
        return;
      }
      if (input === 'c' && devices[selectedDevice]) {
        const result = remoteAccessUrl(runtime, devices[selectedDevice].id);
        if (result.ok) {
          const copyUrl =
            revealedMode === 'mobile'
              ? result.data!.mobileUrl
              : result.data!.url;
          process.stdout.write(
            `\x1b]52;c;${Buffer.from(copyUrl).toString('base64')}\x07`,
          );
          setNotice(
            `${revealedMode === 'mobile' ? 'Mobile app link' : 'Web access link'} copied (OSC 52).`,
          );
        } else setNotice(result.error);
        return;
      }
    }

    if (screen === 'help') {
      const allLinesCount = COMMAND_GROUPS.reduce((acc, [, cmds]) => acc + 1 + cmds.length, 0);
      if (key.downArrow)
        setSelectedHelp((value) => Math.min(value + 1, allLinesCount - 1));
      if (key.upArrow)
        setSelectedHelp((value) => Math.max(0, value - 1));
      return;
    }
  });

  if (isWizardActive) {
    return (
      <Box
        flexDirection="column"
        height={Math.max(1, height - 1)}
        overflow="hidden"
        paddingX={compact ? 0 : 1}
      >
        <Header
          screen={!hasValidProfile ? 'setup' : 'profiles'}
          profileName={snapshot.profile.name}
          notice={notice}
          width={width}
        />
        <ProfileWizardView
          runtime={runtime}
          forced={!hasValidProfile}
          width={width}
          height={height}
          onDone={(profileName) => {
            setWizardOpen(false);
            setNotice(`Active profile: ${profileName}`);
            setNow((value) => value + 1);
          }}
          onCancel={() => {
            setWizardOpen(false);
          }}
          onExit={leave}
        />
      </Box>
    );
  }

  // Active view rendering
  let content: React.ReactNode;

  if (selectedAltItem) {
    content = (
      <AltDetailsModal
        alt={selectedAltItem}
        serverName={snapshot.profile.name}
        width={width}
        onEdit={() => {
          setAltToEdit(selectedAltItem);
          setSelectedAltItem(null);
          setAltFormOpen(true);
        }}
        onRemove={() => {
          setSelectedAltItem(null);
          setConfirmRemoval('alt');
          setNotice(`Remove ${selectedAltItem.username} from this profile? Press y to confirm.`);
        }}
        onClose={() => setSelectedAltItem(null)}
      />
    );
  } else if (scriptOptionsItem) {
    content = (
      <ScriptOptionsModal
        runtime={runtime}
        item={scriptOptionsItem}
        width={width}
        height={height}
        onClose={(didRun) => {
          setScriptOptionsItem(null);
          if (didRun) {
            setScreen('dashboard');
            setNow((v) => v + 1);
          }
        }}
        onNotice={(msg) => setNotice(msg)}
      />
    );
  } else if (altFormOpen) {
    content = (
      <AltFormModal
        runtime={runtime}
        width={width}
        height={height}
        initialAlt={altToEdit ?? undefined}
        onClose={() => {
          setAltFormOpen(false);
          setAltToEdit(null);
        }}
        onSuccess={(msg) => {
          setNotice(msg);
          setAltToEdit(null);
          setNow((v) => v + 1);
        }}
      />
    );
  } else if (joinFormOpen) {
    content = (
      <JoinBotModal
        runtime={runtime}
        width={width}
        onClose={() => setJoinFormOpen(false)}
        onSuccess={(msg) => {
          setNotice(msg);
          setNow((v) => v + 1);
        }}
      />
    );
  } else if (deviceFormOpen) {
    content = (
      <DeviceFormModal
        runtime={runtime}
        onClose={() => setDeviceFormOpen(false)}
        onSuccess={(msg) => {
          setNotice(msg);
          setSelectedDevice(Math.max(0, devices.length));
          setNow((v) => v + 1);
        }}
      />
    );
  } else if (palette) {
    content = (
      <CommandPalette
        query={query}
        matches={matches}
        selectedIndex={selectedPalette}
        width={width}
        height={height}
      />
    );
  } else if (screen === 'result') {
    content = (
      <ResultView
        lines={commandOutput}
        selectedIndex={selectedResult}
        width={width}
        height={height}
      />
    );
  } else if (screen === 'dashboard') {
    content = (
      <DashboardView
        snapshot={snapshot}
        cooldowns={cooldowns}
        recentLogs={events}
        width={width}
        height={height}
        layout={layout}
      />
    );
  } else if (screen === 'scripts') {
    content = (
      <ScriptsView
        profileScripts={profileScripts}
        libraryPlugins={libraryPlugins}
        cooldowns={cooldowns}
        snapshot={snapshot}
        selectedScript={selectedScript}
        selectedPlugin={selectedPlugin}
        selectedCooldown={selectedCooldown}
        activeFocus={scriptsFocus}
        width={width}
        height={height}
        layout={layout}
      />
    );
  } else if (screen === 'bots') {
    content = (
      <BotView
        runtime={runtime}
        width={width}
        height={height}
        onNotice={(msg) => setNotice(msg)}
        onOpenJoin={() => setJoinFormOpen(true)}
        onExitView={() => setScreen('dashboard')}
      />
    );
  } else if (screen === 'logs') {
    content = <LogsView events={events} width={width} height={height} />;
  } else if (screen === 'profiles') {
    content = (
      <ProfilesView
        profiles={profiles}
        activeProfileKey={snapshot.profile.id}
        selectedProfile={selectedProfile}
        width={width}
        height={height}
      />
    );
  } else if (screen === 'alts') {
    content = (
      <AltsView
        alts={alts}
        selectedAlt={selectedAlt}
        confirmRemoval={confirmRemoval === 'alt'}
        width={width}
        height={height}
      />
    );
  } else if (screen === 'remote') {
    const activeDev = devices[selectedDevice];
    const link = activeDev ? remoteAccessUrl(runtime, activeDev.id) : undefined;
    content = (
      <RemoteView
        remoteActive={snapshot.remote.active}
        devices={devices}
        selectedDevice={selectedDevice}
        revealedDevice={revealedDevice}
        revealedMode={revealedMode}
        linkData={link?.ok ? link.data : undefined}
        width={width}
        height={height}
      />
    );
  } else if (screen === 'help') {
    content = <HelpView selectedHelp={selectedHelp} width={width} height={height} />;
  }

  return (
    <Box
      flexDirection="column"
      height={Math.max(1, height - 1)}
      overflow="hidden"
      paddingX={compact ? 0 : 1}
    >
      <Header
        screen={screen}
        profileName={snapshot.profile.name}
        notice={notice}
        width={width}
      />
      <Box flexGrow={1} flexDirection="column">
        {content}
      </Box>
      <Footer screen={screen} width={width} paletteOpen={palette} />
    </Box>
  );
}

export async function startTui(
  runtime: CliRuntime,
  output: OutputRouter,
): Promise<void> {
  const { render } = await import('ink');
  const terminal = process.stdout;
  const synchronized = new Proxy(terminal, {
    get(target, property) {
      if (property === 'write')
        return (chunk: unknown, ...args: unknown[]) =>
          target.write(
            `\x1b[?2026h${String(chunk)}\x1b[?2026l`,
            ...(args as []),
          );
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as NodeJS.WriteStream;
  terminal.write('\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l');
  let app: ReturnType<typeof render> | undefined;
  try {
    app = render(
      <CliApp runtime={runtime} output={output} onExit={() => undefined} />,
      {
        stdout: synchronized,
        patchConsole: false,
        exitOnCtrlC: false,
      },
    );
    await app.waitUntilExit();
  } finally {
    app?.clear();
    terminal.write('\x1b[?25h\x1b[?1049l');
  }
}
