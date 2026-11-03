import path from 'path';
import fs from 'fs/promises';
import { freshUserData, bootElectron, cleanupUserData } from './helpers';

describe('Recordings storage', () => {
  let tmpDir: string;
  let RecordingsClass: typeof import('../../src/main/src/functions/storage/Recordings').default;

  beforeEach(() => {
    tmpDir = freshUserData();
    bootElectron(tmpDir);
    RecordingsClass = require('../../src/main/src/functions/storage/Recordings').default;
  });

  afterAll(() => {
    cleanupUserData();
  });

  it('creates recordings directory on instantiation', async () => {
    const recordings = new RecordingsClass();
    const stat = await fs.stat(recordings.recordingsPath);
    expect(stat.isDirectory()).toBe(true);
  });

  it('getRecordings parses json headers and skips corrupted files', async () => {
    const recordings = new RecordingsClass();
    const dir = recordings.recordingsPath;
    await fs.mkdir(dir, { recursive: true });

    const valid1 = { id: 'rec-1', name: 'Mining Run', duration: 120 };
    const valid2 = { id: 'rec-2', name: 'Farming Run', duration: 300 };

    await fs.writeFile(path.join(dir, 'rec-1.json'), JSON.stringify(valid1));
    await fs.writeFile(path.join(dir, 'rec-2.json'), JSON.stringify(valid2));
    await fs.writeFile(path.join(dir, 'corrupt.json'), 'not valid json {{{');
    await fs.writeFile(path.join(dir, 'ignored.txt'), 'text file');

    const result = await recordings.getRecordings();
    expect(result).toHaveLength(2);
    expect(result.map((r: any) => r.id).sort()).toEqual(['rec-1', 'rec-2']);
  });

  it('addRecording appends to cache and getRecordings returns cached list', async () => {
    const recordings = new RecordingsClass();
    await fs.mkdir(recordings.recordingsPath, { recursive: true });

    // Populate initial cache
    await recordings.getRecordings();

    const newHeader: any = { id: 'rec-3', name: 'PvP Session', duration: 50 };
    recordings.addRecording(newHeader);

    const list = await recordings.getRecordings();
    expect(list).toContainEqual(newHeader);
  });

  it('removeRecording deletes files and updates cache', async () => {
    const recordings = new RecordingsClass();
    const dir = recordings.recordingsPath;
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(path.join(dir, 'del-1.json'), JSON.stringify({ id: 'del-1' }));
    await fs.writeFile(path.join(dir, 'del-1.log'), 'recorded packet data');

    await recordings.getRecordings(); // prime cache
    await recordings.removeRecording('del-1');

    const list = await recordings.getRecordings();
    expect(list.find((r: any) => r.id === 'del-1')).toBeUndefined();

    await expect(fs.stat(path.join(dir, 'del-1.json'))).rejects.toThrow();
    await expect(fs.stat(path.join(dir, 'del-1.log'))).rejects.toThrow();
  });

  it('updateName validates name formatting and updates file', async () => {
    const recordings = new RecordingsClass();
    const dir = recordings.recordingsPath;
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(path.join(dir, 'name-test.json'), JSON.stringify({ id: 'name-test', name: 'Old' }));

    // Reject names with spaces or special characters
    await recordings.updateName('name-test', 'Invalid Name With Space');
    let data = JSON.parse(await fs.readFile(path.join(dir, 'name-test.json'), 'utf8'));
    expect(data.name).toBe('Old');

    await recordings.updateName('name-test', 'Valid_Name-123');
    data = JSON.parse(await fs.readFile(path.join(dir, 'name-test.json'), 'utf8'));
    expect(data.name).toBe('Valid_Name-123');
  });

  it('updateRecordingData & getRecordingData read and write raw logs', async () => {
    const recordings = new RecordingsClass();
    await fs.mkdir(recordings.recordingsPath, { recursive: true });

    await recordings.updateRecordingData('data-1', 'packet:001;packet:002');
    const read = await recordings.getRecordingData('data-1');
    expect(read).toBe('packet:001;packet:002');

    // Missing file returns null
    const missing = await recordings.getRecordingData('non-existent');
    expect(missing).toBeNull();
  });

  it('updateRecordingData rejects non-string data', async () => {
    const recordings = new RecordingsClass();
    await fs.mkdir(recordings.recordingsPath, { recursive: true });

    await recordings.updateRecordingData('data-2', 12345 as any);
    expect(await recordings.getRecordingData('data-2')).toBeNull();
  });
});
