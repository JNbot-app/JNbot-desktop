import React from 'react';
import { Box, Text } from 'ink';
import { Section } from '../components/Section';
import { clipText } from '../components/Header';
import { generateTerminalQrLines } from '../qr';
import type { RemoteAccessLinks } from '../actions';

interface DeviceItem {
  id: string;
  name: string;
  connectionCount?: number;
}

interface RemoteViewProps {
  remoteActive: boolean;
  devices: DeviceItem[];
  selectedDevice: number;
  revealedDevice?: string;
  revealedMode: 'mobile' | 'web';
  linkData?: RemoteAccessLinks;
  width: number;
  height: number;
}

export const RemoteView: React.FC<RemoteViewProps> = ({
  remoteActive,
  devices,
  selectedDevice,
  revealedDevice,
  revealedMode,
  linkData,
  width,
  height,
}) => {
  const activeDevice = devices[selectedDevice];
  const isRevealed = Boolean(revealedDevice && activeDevice && revealedDevice === activeDevice.id);
  const activeUrl = linkData
    ? revealedMode === 'mobile'
      ? linkData.mobileUrl
      : linkData.url
    : undefined;

  const qrLines = activeUrl ? generateTerminalQrLines(activeUrl) : [];
  const qrWidth = qrLines[0]?.length ?? 0;
  const canRenderQr = qrWidth > 0 && width >= qrWidth + 4 && height >= qrLines.length + 6;

  const limit = Math.max(3, height - (isRevealed ? 22 : 9));
  const start = Math.max(0, Math.min(selectedDevice - Math.floor(limit / 2), devices.length - limit));
  const visibleDevices = devices.slice(start, start + limit);

  return (
    <Box flexDirection="column">
      <Section title="Remote Access">
        <Box justifyContent="space-between">
          <Text>
            Status:{' '}
            <Text color={remoteActive ? 'green' : 'yellow'}>
              {remoteActive ? '● online' : '○ offline'}
            </Text>
          </Text>
          <Text dimColor>[s] start · [x] stop · [n] new link</Text>
        </Box>
      </Section>

      {isRevealed && linkData && canRenderQr ? (
        <Section title={`Access Link & QR · ${activeDevice?.name}`}>
          <Text>
            Target:{' '}
            <Text color={revealedMode === 'mobile' ? 'cyan' : undefined} bold={revealedMode === 'mobile'}>
              {revealedMode === 'mobile' ? '● ' : '○ '}JNbot Mobile App
            </Text>
            {'   '}
            <Text color={revealedMode === 'web' ? 'cyan' : undefined} bold={revealedMode === 'web'}>
              {revealedMode === 'web' ? '● ' : '○ '}Web Browser
            </Text>
            <Text dimColor> (Tab switches)</Text>
          </Text>
          <Box flexDirection="column" marginY={1}>
            {qrLines.map((line, index) => (
              <Text key={index} color="black" backgroundColor="white">
                {line}
              </Text>
            ))}
          </Box>
          <Text dimColor>
            {revealedMode === 'mobile'
              ? 'Scan with your phone camera or JNbot Mobile'
              : 'Scan with camera or browser'} · Tab toggle · [c] copy · Esc hide
          </Text>
        </Section>
      ) : (
        <>
          <Section title="Access Links" badge={devices.length}>
            <Box justifyContent="space-between" marginBottom={1}>
              <Text dimColor>↑↓ select · Enter/v QR · Tab Web/Mobile · [c] copy · [d] revoke</Text>
            </Box>
            {devices.length ? (
              visibleDevices.map((item, index) => {
                const actualIdx = start + index;
                const isSelected = selectedDevice === actualIdx;
                return (
                  <Box key={item.id} justifyContent="space-between">
                    <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                      {isSelected ? '› ' : '  '}
                      {clipText(item.name, Math.max(16, Math.floor(width * 0.45)))}
                    </Text>
                    <Text dimColor>
                      {item.connectionCount ? `${item.connectionCount} connected` : 'offline'}
                    </Text>
                  </Box>
                );
              })
            ) : (
              <Text dimColor>No access links created. Press [n] to create one.</Text>
            )}
            {devices.length > visibleDevices.length ? (
              <Text dimColor>
                {start + 1}–{start + visibleDevices.length} of {devices.length}
              </Text>
            ) : null}
          </Section>

          {isRevealed && linkData && !canRenderQr ? (
            <Section title={`Access Link URL · ${activeDevice?.name}`}>
              <Text wrap="wrap">{activeUrl}</Text>
              <Text color="yellow">Terminal too small for QR. Resize to show code.</Text>
            </Section>
          ) : null}
        </>
      )}
    </Box>
  );
};
