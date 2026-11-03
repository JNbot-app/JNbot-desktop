import fs from 'fs';
import os from 'os';
import path from 'path';
import { isAutomationDocument } from '../../src/common/automation';
import Macros from '../../src/main/src/functions/Macros';

describe('recording plugins', () => {
  test('use plugin metadata and a recording code file', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'recording-plugin-'),
    );
    const previousSend = (global as any).send;
    (global as any).send = jest.fn();
    try {
      const macros = new Macros({} as any);
      macros.macros_path = directory;
      const created = macros.create({
        name: 'Harvest wheat',
        description: 'Recorded farm route',
        language: 'recording',
        scriptType: 'script',
      });

      expect(created.status).toBe('success');
      expect(created.language).toBe('recording');
      expect(
        fs.existsSync(
          path.join(directory, `${created.pluginId}.recording.json`),
        ),
      ).toBe(true);

      const loaded = macros.getMacro(created.pluginId);
      expect(loaded.status).toBe('success');
      if (loaded.status !== 'success') return;
      expect(loaded.info.language).toBe('recording');
      expect(isAutomationDocument(loaded.code)).toBe(true);
      if (!isAutomationDocument(loaded.code)) return;

      loaded.code.steps.push({
        id: 'chat-one',
        kind: 'chat',
        enabled: true,
        atMs: 0,
        message: '/home',
      });
      const saved = macros.save(created.pluginId, loaded.code);
      expect(isAutomationDocument(saved)).toBe(true);
      if (isAutomationDocument(saved)) {
        expect(saved.id).toBe(created.pluginId);
        expect(saved.revision).toBe(1);
      }

      const copy = macros.duplicate(created.pluginId);
      expect(copy.status).toBe('success');
      expect(copy.language).toBe('recording');
      expect(
        fs.existsSync(
          path.join(directory, `${copy.pluginId}.recording.json`),
        ),
      ).toBe(true);

      const actionData = macros.scriptActionData('Harvest wheat');
      expect('error' in actionData).toBe(false);
      if (!('error' in actionData)) {
        expect(actionData.info.language).toBe('recording');
        expect(actionData.info.config?.[0]?.name).toBe('Replay Settings');
        expect(actionData.info.config?.[0]?.options.some((opt) => opt.id === 'account')).toBe(true);
        expect(actionData.info.config?.[0]?.options.some((opt) => opt.id === 'spatialMode')).toBe(true);
      }
    } finally {
      (global as any).send = previousSend;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  test('assigns plugin to folder if folder is provided on creation', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'folder-plugin-'),
    );
    const previousSend = (global as any).send;
    (global as any).send = jest.fn();
    try {
      const mockSettings = {
        shared: { pluginMetadata: {} },
        updateShared: jest.fn((update: any) => {
          Object.assign(mockSettings.shared, update);
        }),
      };
      const macros = new Macros({} as any, mockSettings as any);
      macros.macros_path = directory;
      const created = macros.create({
        name: 'Farming Plugin',
        description: 'Automates farming',
        language: 'js',
        scriptType: 'script',
        folder: 'Farming',
      });

      expect(created.status).toBe('success');
      expect(mockSettings.updateShared).toHaveBeenCalledWith({
        pluginMetadata: {
          [created.pluginId]: { folder: 'Farming' },
        },
      });
      expect((mockSettings.shared.pluginMetadata as any)[created.pluginId]).toEqual({
        folder: 'Farming',
      });
    } finally {
      (global as any).send = previousSend;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
