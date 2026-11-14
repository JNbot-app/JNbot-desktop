import path from 'path';
import { devicePath } from './portablePaths';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { RecordingHeader } from '../../../../common/types/proxyApi';
import { decodeRecording } from './decodeRecording';

class Recordings {
  public readonly recordingsPath: string;

  private cache: RecordingHeader[] | null = null;

  constructor() {
    this.recordingsPath = devicePath('recordings');
    if (!existsSync(this.recordingsPath)) {
      mkdirSync(this.recordingsPath, { recursive: true });
    }
  }

  public async update() {
    this.cache = null;
    return this.getRecordings();
  }

  public async getRecordings() {
    if (this.cache) return this.cache;

    let files: string[] = [];
    try {
      files = await fs.readdir(this.recordingsPath);
    } catch {
      this.cache = [];
      return this.cache;
    }

    const contents = await Promise.all(
      files
        .filter((file) => file.endsWith('.json'))
        .map((file) =>
          fs.readFile(path.join(this.recordingsPath, file), 'utf8').catch(() => ''),
        ),
    );
    this.cache = contents
      .map((s) => {
        if (!s) return null;
        try {
          return JSON.parse(s) || null;
        } catch (err) {
          console.info(err);
          return null;
        }
      })
      .filter((recording): recording is RecordingHeader => !!recording);
    return this.cache;
  }

  public addRecording(recording: RecordingHeader) {
    this.cache?.push(recording);
  }

  public async removeRecording(id: string) {
    if (!this.cache) return;
    this.cache = this.cache.filter((recording) => recording.id !== id);
    await Promise.all([
      fs.unlink(path.join(this.recordingsPath, `${id}.json`)).catch(() => {}),
      fs.unlink(path.join(this.recordingsPath, `${id}.log`)).catch(() => {}),
    ]);
  }

  public async updateName(id: string, name: string) {
    const recordings = await this.getRecordings();
    if (/[^a-zA-Z0-9_-]/.test(name)) {
      console.info('Invalid name');
      return;
    }
    const recording = recordings.find((item) => item.id === id);
    if (!recording) {
      console.info(`Recording ${id} not found`);
      return;
    }
    recording.name = name;
    try {
      await fs.writeFile(
        path.join(this.recordingsPath, `${id}.json`),
        JSON.stringify(recording),
      );
    } catch (err) {
      console.error('Failed to save updated recording name:', err);
    }
  }

  public async updateRecordingData(id: string, data: string) {
    if (typeof data !== 'string') {
      console.error('Invalid data');
      return;
    }
    const filePath = path.join(this.recordingsPath, `${id}.log`);
    try {
      await fs.writeFile(filePath, data);
    } catch (err) {
      console.error('Failed to write recording data:', err);
    }
  }

  /** The packets of a recording, with raw packets decoded. */
  public async getRecordingData(id: string) {
    const filePath = path.join(this.recordingsPath, `${id}.log`);
    let data: string;
    try {
      data = await fs.readFile(filePath, 'utf8');
    } catch {
      return null;
    }
    const header = (await this.getRecordings()).find((recording) => recording.id === id);
    return header?.mcVersion ? decodeRecording(data, header.mcVersion) : data;
  }
}

export default Recordings;
