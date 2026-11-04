import React, { useEffect, useState } from 'react';
import fs from 'fs';
import { Box, Text, useInput } from 'ink';
import {
  importCloudData,
  importProfile,
  installMarketplaceProfile,
  marketplaceProfileRows,
  useProfile,
  type MarketplaceProfileRow,
} from './actions';
import type { CliRuntime } from './types';

export type ProfileWizardTab = 'marketplace' | 'file' | 'cloud' | 'existing';

function clip(value: unknown, width: number): string {
  const str = String(value ?? '');
  return str.length <= width
    ? str
    : `${str.slice(0, Math.max(0, width - 1))}…`;
}

function page<T>(
  items: T[],
  selected: number,
  limit: number,
): { items: T[]; start: number } {
  const start = Math.max(
    0,
    Math.min(selected - Math.floor(limit / 2), Math.max(0, items.length - limit)),
  );
  return { items: items.slice(start, start + limit), start };
}

interface ProfileWizardViewProps {
  runtime: CliRuntime;
  forced: boolean;
  width: number;
  height: number;
  onDone: (profileName: string) => void;
  onCancel?: () => void;
  onExit: () => void;
}

export function ProfileWizardView({
  runtime,
  forced,
  height,
  onDone,
  onCancel,
  onExit,
}: ProfileWizardViewProps) {
  const profiles = runtime.handler.settings.getAvailableProfiles();
  const hasProfiles = profiles.length > 0;

  // Default is download from marketplace as requested
  const [activeTab, setActiveTab] = useState<ProfileWizardTab>('marketplace');
  const [selectedMarketplace, setSelectedMarketplace] = useState(0);
  const [selectedExisting, setSelectedExisting] = useState(0);
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  // File import state
  const [filePath, setFilePath] = useState('');
  const [trustUnverified, setTrustUnverified] = useState(true);
  const [fileField, setFileField] = useState<'path' | 'trust'>('path');

  // Cloud import state
  const [cloudUserId, setCloudUserId] = useState('');
  const [cloudShareKey, setCloudShareKey] = useState('');
  const [cloudConfirmed, setCloudConfirmed] = useState(false);
  const [cloudField, setCloudField] = useState<'userId' | 'shareKey' | 'confirm'>('userId');

  const [marketplaceServers, setMarketplaceServers] = useState<MarketplaceProfileRow[]>([]);
  useEffect(() => {
    marketplaceProfileRows(runtime)
      .then(setMarketplaceServers)
      .catch((error) => setNotice(error instanceof Error ? error.message : String(error)));
  }, [runtime]);

  const tabs: Array<{ id: ProfileWizardTab; label: string; key: string }> = [
    ...(hasProfiles ? [{ id: 'existing' as const, label: 'Existing Profiles', key: '0' }] : []),
    { id: 'marketplace', label: 'Marketplace (Download)', key: '1' },
    { id: 'file', label: 'Import File', key: '2' },
    { id: 'cloud', label: 'JNbot Cloud', key: '3' },
  ];

  const cycleTab = (direction: 1 | -1) => {
    const currentIndex = tabs.findIndex((t) => t.id === activeTab);
    const nextIndex = (currentIndex + direction + tabs.length) % tabs.length;
    setActiveTab(tabs[nextIndex].id);
    setNotice(undefined);
  };

  const listLimit = Math.max(3, Math.min(8, height - 12));
  const marketplacePage = page(marketplaceServers, selectedMarketplace, listLimit);
  const existingPage = page(profiles, selectedExisting, listLimit);

  useInput(async (input, key) => {
    if (busy) return;

    if (key.ctrl && input === 'c') {
      onExit();
      return;
    }

    // Tab switching with Tab / Shift+Tab (when not typing in a text field)
    if (key.tab && !key.shift && activeTab === 'marketplace') {
      cycleTab(1);
      return;
    }
    if (key.tab && key.shift && activeTab === 'marketplace') {
      cycleTab(-1);
      return;
    }

    // Number keys switch tabs when not typing text
    if (
      (activeTab === 'marketplace' || activeTab === 'existing') &&
      ['0', '1', '2', '3'].includes(input)
    ) {
      const match = tabs.find((t) => t.key === input);
      if (match) {
        setActiveTab(match.id);
        setNotice(undefined);
        return;
      }
    }

    // Esc handling
    if (key.escape) {
      if (!forced && onCancel) {
        onCancel();
        return;
      }
      if (activeTab !== 'marketplace') {
        setActiveTab('marketplace');
        setNotice(undefined);
        return;
      }
    }

    // Tab 1: Marketplace (Default)
    if (activeTab === 'marketplace') {
      if (input === 'q') {
        onExit();
        return;
      }
      if (key.downArrow) {
        setSelectedMarketplace((value) =>
          Math.min(value + 1, Math.max(0, marketplaceServers.length - 1)),
        );
        return;
      }
      if (key.upArrow) {
        setSelectedMarketplace((value) => Math.max(0, value - 1));
        return;
      }
      if (key.return && marketplaceServers[selectedMarketplace]) {
        const server = marketplaceServers[selectedMarketplace];
        setBusy(true);
        setNotice(`Installing and activating ${server.name}...`);
        try {
          const result = await installMarketplaceProfile(runtime, server.id);
          if (result.ok) {
            onDone(server.name);
          } else {
            setNotice(result.error ?? 'Failed to install marketplace profile.');
            setBusy(false);
          }
        } catch (error) {
          setNotice(error instanceof Error ? error.message : String(error));
          setBusy(false);
        }
        return;
      }
      return;
    }

    // Tab 2: File Import
    if (activeTab === 'file') {
      if (key.tab) {
        setFileField((field) => (field === 'path' ? 'trust' : 'path'));
        return;
      }
      if (fileField === 'trust') {
        if (input === ' ' || key.return) {
          setTrustUnverified((value) => !value);
          return;
        }
      }
      if (fileField === 'path') {
        if (key.return) {
          const targetPath = filePath.trim();
          if (!targetPath) {
            setNotice('Please enter a file path to import.');
            return;
          }
          if (!fs.existsSync(targetPath)) {
            setNotice(`File not found: ${targetPath}`);
            return;
          }
          setBusy(true);
          setNotice(`Importing ${targetPath}...`);
          try {
            const result = await importProfile(runtime, targetPath, trustUnverified);
            if (result.ok) {
              onDone((result.data as any)?.name ?? targetPath);
            } else {
              setNotice(result.error ?? 'Failed to import profile.');
              setBusy(false);
            }
          } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
            setBusy(false);
          }
          return;
        }
        if (key.backspace || key.delete) {
          setFilePath((value) => value.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setFilePath((value) => value + input);
          return;
        }
      }
      return;
    }

    // Tab 3: JNbot Cloud
    if (activeTab === 'cloud') {
      if (key.tab) {
        setCloudField((field) => {
          if (field === 'userId') return 'shareKey';
          if (field === 'shareKey') return 'confirm';
          return 'userId';
        });
        return;
      }
      if (cloudField === 'confirm') {
        if (input === ' ' || input === 'y' || input === 'Y') {
          setCloudConfirmed((v) => !v);
          return;
        }
      }
      if (key.return) {
        if (cloudField === 'userId') {
          if (!cloudUserId.trim()) {
            setNotice('Please enter your JNbot Cloud User ID.');
            return;
          }
          setCloudField('shareKey');
          return;
        }
        if (cloudField === 'shareKey') {
          if (!cloudShareKey.trim()) {
            setNotice('Please enter your Share Key.');
            return;
          }
          setCloudField('confirm');
          return;
        }
        if (cloudField === 'confirm') {
          if (!cloudUserId.trim()) {
            setNotice('User ID is missing.');
            setCloudField('userId');
            return;
          }
          if (!cloudShareKey.trim()) {
            setNotice('Share Key is missing.');
            setCloudField('shareKey');
            return;
          }
          if (!cloudConfirmed) {
            setNotice('Please confirm overwriting local data before proceeding.');
            return;
          }
          setBusy(true);
          setNotice('Downloading and restoring cloud backup...');
          try {
            const result = await importCloudData(
              runtime,
              cloudUserId.trim(),
              cloudShareKey.trim(),
            );
            if (result.ok) {
              onDone('Cloud Backup');
            } else {
              setNotice(result.error ?? 'Failed to import cloud backup.');
              setBusy(false);
            }
          } catch (error) {
            setNotice(error instanceof Error ? error.message : String(error));
            setBusy(false);
          }
          return;
        }
      }
      if (cloudField === 'userId') {
        if (key.backspace || key.delete) {
          setCloudUserId((value) => value.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setCloudUserId((value) => value + input);
          return;
        }
      }
      if (cloudField === 'shareKey') {
        if (key.backspace || key.delete) {
          setCloudShareKey((value) => value.slice(0, -1));
          return;
        }
        if (input && !key.ctrl && !key.meta) {
          setCloudShareKey((value) => value + input);
          return;
        }
      }
      return;
    }

    // Tab 0: Existing Profiles
    if (activeTab === 'existing') {
      if (input === 'q') {
        onExit();
        return;
      }
      if (key.downArrow) {
        setSelectedExisting((value) =>
          Math.min(value + 1, Math.max(0, profiles.length - 1)),
        );
        return;
      }
      if (key.upArrow) {
        setSelectedExisting((value) => Math.max(0, value - 1));
        return;
      }
      if (key.return && profiles[selectedExisting]) {
        const profile = profiles[selectedExisting];
        setBusy(true);
        setNotice(`Activating ${profile.data.name ?? profile.server}...`);
        try {
          // eslint-disable-next-line react-hooks/rules-of-hooks -- CLI command, not a hook
          const result = await useProfile(runtime, profile.server);
          if (result.ok) {
            onDone(profile.data.name ?? profile.server);
          } else {
            setNotice(result.error ?? 'Failed to switch profile.');
            setBusy(false);
          }
        } catch (error) {
          setNotice(error instanceof Error ? error.message : String(error));
          setBusy(false);
        }
        return;
      }
    }
  });

  return (
    <Box flexDirection="column" paddingX={1} overflow="hidden">
      {/* Header Banner */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
        marginBottom={1}
      >
        <Text bold color="cyan">
          {forced
            ? 'JNbot · Profile Setup Required'
            : 'JNbot · Profile Manager'}
        </Text>
        <Text dimColor>
          {forced
            ? 'No active profile is available. Please download or import a profile to continue.'
            : 'Select an existing profile or install a new one.'}
        </Text>
      </Box>

      {/* Method Tabs */}
      <Box marginBottom={1} gap={1}>
        {tabs.map((tab) => {
          const isCurrent = activeTab === tab.id;
          return (
            <Text
              key={tab.id}
              color={isCurrent ? 'cyan' : undefined}
              bold={isCurrent}
              inverse={isCurrent}
            >
              {' '}[{tab.key}] {tab.label}{' '}
            </Text>
          );
        })}
      </Box>

      {/* Tab 1: Marketplace (Default) */}
      {activeTab === 'marketplace' && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginBottom={1}
        >
          <Text bold color="cyan">
            Download from Marketplace (Default)
          </Text>
          <Text dimColor>
            Choose a ready-made Minecraft server profile:
          </Text>
          <Box flexDirection="column" marginY={1}>
            {marketplacePage.items.length ? (
              marketplacePage.items.map((server, index) => {
                const isSelected =
                  index + marketplacePage.start === selectedMarketplace;
                return (
                  <Box key={server.id} justifyContent="space-between">
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '› ' : '  '}
                      {clip(server.name, 22)}
                      {'  '}
                      <Text dimColor>{clip(server.official ? 'Official' : server.publisher, 20)}</Text>
                      {'  '}
                      <Text dimColor>({clip(server.summary, 28)})</Text>
                    </Text>
                    <Text color={server.installed ? 'green' : 'yellow'}>
                      {server.installed ? '[Installed]' : '[Download]'}
                    </Text>
                  </Box>
                );
              })
            ) : (
              <Text dimColor>No marketplace servers found.</Text>
            )}
            {marketplaceServers.length > marketplacePage.items.length ? (
              <Text dimColor>
                {marketplacePage.start + 1}–
                {marketplacePage.start + marketplacePage.items.length} of{' '}
                {marketplaceServers.length}
              </Text>
            ) : null}
          </Box>
          <Text dimColor>
            ↑↓ choose · Enter install & activate · Tab next method · q quit
          </Text>
        </Box>
      )}

      {/* Tab 2: File Import */}
      {activeTab === 'file' && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginBottom={1}
        >
          <Text bold color="cyan">
            Import Profile using File (.jnp / .json)
          </Text>
          <Text dimColor>
            Import an exported JNbot profile package from disk.
          </Text>
          <Box flexDirection="column" marginY={1}>
            <Text color={fileField === 'path' ? 'cyan' : undefined}>
              File Path: {filePath}
              <Text inverse>{fileField === 'path' ? ' ' : ''}</Text>
            </Text>
            <Text color={fileField === 'trust' ? 'cyan' : undefined}>
              Trust unverified scripts:{' '}
              {trustUnverified ? '[✓] Allowed' : '[ ] Verified Only'}{' '}
              <Text dimColor>(Space toggles)</Text>
            </Text>
          </Box>
          <Text dimColor>
            Tab switch field · Enter import · Esc back to Marketplace
          </Text>
        </Box>
      )}

      {/* Tab 3: JNbot Cloud */}
      {activeTab === 'cloud' && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginBottom={1}
        >
          <Text bold color="cyan">
            Use JNbot Cloud to Import All Data
          </Text>
          <Text dimColor>
            Import your encrypted cloud backup (profiles, alts, and settings).
          </Text>
          <Box flexDirection="column" marginY={1}>
            <Text dimColor>1. Open settings in your desktop app and go to backup.</Text>
            <Text dimColor>{'2. Click "Connect to JNbot Cloud".'}</Text>
            <Text dimColor>{'3. Save the user ID and share key, then click "Save to Cloud".'}</Text>
            <Text dimColor>4. Paste both values below.</Text>
          </Box>
          <Box flexDirection="column" marginBottom={1}>
            <Text color={cloudField === 'userId' ? 'cyan' : undefined}>
              User ID:{'   '}{cloudUserId}
              <Text inverse>{cloudField === 'userId' ? ' ' : ''}</Text>
            </Text>
            <Text color={cloudField === 'shareKey' ? 'cyan' : undefined}>
              Share Key: {cloudShareKey ? '•'.repeat(cloudShareKey.length) : ''}
              <Text inverse>{cloudField === 'shareKey' ? ' ' : ''}</Text>
            </Text>
            <Text color="yellow">
              ⚠ Warning: Importing will overwrite your local alts, settings, and profiles.
            </Text>
            <Text color={cloudField === 'confirm' ? 'cyan' : undefined}>
              Confirm overwrite:{' '}
              {cloudConfirmed ? '[✓] Yes, replace data' : '[ ] Not confirmed'}{' '}
              <Text dimColor>(Space/y toggles)</Text>
            </Text>
          </Box>
          <Text dimColor>
            Tab switch field · Enter submit · Esc back to Marketplace
          </Text>
        </Box>
      )}

      {/* Tab 0: Existing Profiles (if any) */}
      {activeTab === 'existing' && hasProfiles && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
          marginBottom={1}
        >
          <Text bold color="cyan">
            Select Installed Profile
          </Text>
          <Text dimColor>
            Choose an existing profile already configured on this system:
          </Text>
          <Box flexDirection="column" marginY={1}>
            {existingPage.items.map((profile, index) => {
              const isSelected =
                index + existingPage.start === selectedExisting;
              return (
                <Text
                  key={profile.server}
                  color={isSelected ? 'cyan' : undefined}
                  bold={isSelected}
                >
                  {isSelected ? '› ' : '  '}
                  {profile.data.name ?? profile.data.shortName ?? profile.server}{' '}
                  <Text dimColor>({profile.server})</Text>
                </Text>
              );
            })}
          </Box>
          <Text dimColor>
            ↑↓ choose · Enter activate · Tab next method · q quit
          </Text>
        </Box>
      )}

      {/* Notice / Error message */}
      {notice ? (
        <Box marginBottom={1}>
          <Text color="yellow">{notice}</Text>
        </Box>
      ) : null}

      {busy ? (
        <Box marginBottom={1}>
          <Text color="cyan">Working, please wait...</Text>
        </Box>
      ) : null}

      {/* Footer Navigation Hints */}
      <Box justifyContent="space-between">
        <Text dimColor>
          {forced
            ? 'Profile selection required to access dashboard & automation'
            : 'Esc cancels and returns to profiles'}
        </Text>
        <Text dimColor>
          1 Marketplace · 2 File · 3 Cloud{hasProfiles ? ' · 0 Existing' : ''}
        </Text>
      </Box>
    </Box>
  );
}
