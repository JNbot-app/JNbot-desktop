const mockSent: unknown[] = [];
let mockMessageListener: ((message: { kind: string }) => void) | undefined;

jest.mock('rn-bridge', () => ({
  app: { datadir: () => '/tmp/jnbot-mobile-test' },
  channel: {
    on: jest.fn((_event: string, listener: (message: { kind: string }) => void) => {
      mockMessageListener = listener;
    }),
    send: jest.fn((message: unknown) => mockSent.push(message)),
  },
}), { virtual: true });

const mockCreateCliRuntime = jest.fn().mockResolvedValue({ handler: { settings: { server: 'localhost', on: jest.fn(), off: jest.fn() } } });
const mockRegisterRemoteClient = jest.fn().mockReturnValue({ address: 123, receive: jest.fn(), dispose: jest.fn() });
const mockCreateClientBootstrap = jest.fn().mockReturnValue({ profiles: [] });

jest.mock('../../src/cli/v2/runtime', () => ({ createCliRuntime: mockCreateCliRuntime }));
jest.mock('../../src/main/src/messaging', () => ({ backendMessaging: { registerRemoteClient: mockRegisterRemoteClient } }));
jest.mock('../../src/main/src/messaging/bootstrap', () => ({ createClientBootstrap: mockCreateClientBootstrap }));

import '../../src/mobile-backend/main';

async function flushStartup() {
  for (let i = 0; i < 8; i += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('mobile backend reconnect', () => {
  beforeEach(() => {
    mockSent.length = 0;
    mockCreateCliRuntime.mockClear();
    mockRegisterRemoteClient.mockClear();
    mockCreateClientBootstrap.mockClear();
  });

  it('replays the handshake when React reconnects to the running Node runtime', async () => {
    expect(mockMessageListener).toBeDefined();

    mockMessageListener?.({ kind: 'start' });
    await flushStartup();
    mockMessageListener?.({ kind: 'start' });
    await flushStartup();

    const handshake = mockSent.filter((message: any) =>
      ['assigned', 'frame', 'ready'].includes(message.kind),
    );
    expect(handshake.map((message: any) => message.kind)).toEqual([
      'assigned', 'frame', 'ready',
      'assigned', 'frame', 'ready',
    ]);
    expect(mockRegisterRemoteClient).toHaveBeenCalledTimes(1);
    expect(mockCreateCliRuntime).toHaveBeenCalledTimes(1);
    expect(mockCreateClientBootstrap).toHaveBeenCalledTimes(1);
    expect(process.env.JNBOT_USER_DATA).toBe('/tmp/jnbot-mobile-test');
  });
});
