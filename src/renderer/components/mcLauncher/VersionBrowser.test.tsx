import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import VersionBrowser, { VersionItem } from './VersionBrowser';
import { MinecraftLauncherTypes } from '../../../common/CommonEnums';

// Mock matchMedia for Ant Design drawer / responsive components
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: jest.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    })),
  });
});

describe('VersionBrowser', () => {
  const sampleVersions: VersionItem[] = [
    {
      id: '26.2',
      version: '26.2',
      type: 'release',
      launcherType: MinecraftLauncherTypes.VANILLA,
    },
    {
      id: '26.1',
      version: '26.1',
      type: 'release',
      launcherType: MinecraftLauncherTypes.VANILLA,
    },
    {
      id: '1.21.4',
      version: '1.21.4',
      type: 'release',
      launcherType: MinecraftLauncherTypes.VANILLA,
    },
  ];

  it('groups 26.1 and 26.2 into a single "26" card under Minecraft Versions', () => {
    const onSelect = jest.fn();
    render(
      <VersionBrowser
        versions={sampleVersions}
        selectedVersion={null}
        onSelect={onSelect}
      />,
    );

    // Should display group card "26" and "1.21", but NOT separate cards for "26.1" and "26.2" in the main grid
    expect(screen.getByText('26')).toBeInTheDocument();
    expect(screen.getByText('1.21')).toBeInTheDocument();
    expect(screen.queryByText('26.1')).not.toBeInTheDocument();
    expect(screen.queryByText('26.2')).not.toBeInTheDocument();
  });

  it('opens drawer with individual drops (26.1 and 26.2) when clicking "26" group card', () => {
    const onSelect = jest.fn();
    render(
      <VersionBrowser
        versions={sampleVersions}
        selectedVersion={null}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByText('26'));

    // Featured section shows latest (26.2)
    expect(screen.getAllByText('26.2').length).toBeGreaterThan(0);

    // Expand "Vanilla" panel to view all versions in the group
    fireEvent.click(screen.getByText('Vanilla'));
    expect(screen.getByText('26.1')).toBeInTheDocument();

    // Selecting 26.2 should trigger onSelect with versionId 26.2
    fireEvent.click(screen.getAllByText('26.2')[0]);
    expect(onSelect).toHaveBeenCalledWith({
      versionId: '26.2',
      launcherFlags: MinecraftLauncherTypes.VANILLA,
    });
  });
});
