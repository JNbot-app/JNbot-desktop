import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// Ant Design styles + React 18 rendering in jsdom under heavy multi-core CPU load
// can exceed the default 1000ms asyncUtilTimeout. 5000ms gives ample time for DOM updates.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no MessageChannel; antd's form uses it to schedule watcher updates.
// Node's own version would keep open ports that stop Jest from exiting.
class TimeoutMessageChannel {
  port1: { onmessage?: () => void } = {};

  port2 = { postMessage: () => setTimeout(() => this.port1.onmessage?.()) };
}
global.MessageChannel ??=
  TimeoutMessageChannel as unknown as typeof global.MessageChannel;
