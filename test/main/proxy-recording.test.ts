import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSerializer } from 'minecraft-protocol';

import { PacketContext, PacketPipeline, ANY_PACKET } from '../../src/main/src/workers/bot/proxyV3/PacketPipeline';
import { DebugCapture } from '../../src/main/src/workers/bot/proxyV3/plugins/Recorder/Recorder';
import { decodeRecording } from '../../src/main/src/functions/storage/decodeRecording';

const VERSION = '1.21.11';

/** Raw packet body (packet id included) as the proxy sees it. */
function raw(direction: 'c2s' | 's2c', name: string, params: object): Buffer {
  return createSerializer({ state: 'play', version: VERSION, isServer: direction === 's2c' }).createPacketBuffer({
    name,
    params,
  });
}

describe('proxy recording', () => {
  test('a raw observer does not make the proxy decode packets', () => {
    const pipeline = new PacketPipeline();
    pipeline.observeRaw(ANY_PACKET, () => {});
    expect(pipeline.hasListeners('map_chunk')).toBe(false);
    pipeline.observe(ANY_PACKET, () => {});
    expect(pipeline.hasListeners('map_chunk')).toBe(true);
  });

  test('records raw bytes without decoding and decodes them when read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recording-'));
    const pipeline = new PacketPipeline();
    const capture = new DebugCapture({
      pipeline,
      mcVersion: VERSION,
      fileName: path.join(dir, 'test'),
      maxPacketBytes: 64,
      maxDiskBytes: 1024 * 1024,
    });
    capture.record();

    const packet = (direction: 'c2s' | 's2c', name: string, buffer: Buffer) =>
      pipeline.run(new PacketContext({ name, state: 'play', direction, data: null, buffer, unparsed: true }));
    packet('c2s', 'held_item_slot', raw('c2s', 'held_item_slot', { slotId: 3 }));
    packet('s2c', 'update_time', raw('s2c', 'update_time', { age: 5n, time: 6000n, tickDayTime: true }));
    packet('s2c', 'map_chunk', Buffer.alloc(100)); // over maxPacketBytes
    packet('s2c', 'bogus', Buffer.from([0x7f, 1, 2])); // undecodable
    capture.stop();

    return new Promise<void>((resolve) => setTimeout(resolve, 20)).then(() => {
      const written = fs.readFileSync(capture.dataFilePath, 'utf8');
      expect(written).not.toContain('"p":{"slotId"'); // stored raw

      const lines = decodeRecording(written, VERSION).trim().split('\n').map((line) => JSON.parse(line));
      expect(lines.map((line) => [line.n, line.p, line.r])).toEqual([
        ['held_item_slot', { slotId: 3 }, undefined],
        ['update_time', { age: [0, 5], time: [0, 6000], tickDayTime: true }, undefined],
        ['map_chunk', { __truncated: true, bytes: 100 }, undefined],
        ['bogus', expect.objectContaining({ __unparsed: true, raw: 'fwEC' }), undefined],
      ]);
      expect(lines[0]).toMatchObject({ d: 'c2s', m: { phase: 'play', bytes: 3 } });
    });
  });
});
