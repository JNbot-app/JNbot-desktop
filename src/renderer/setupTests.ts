import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';
import { MessageChannel } from 'node:worker_threads';

// Ant Design styles + React 18 rendering in jsdom under heavy multi-core CPU load
// can exceed the default 1000ms asyncUtilTimeout. 5000ms gives ample time for DOM updates.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no MessageChannel; antd's form uses it to schedule watcher updates.
global.MessageChannel ??= MessageChannel as unknown as typeof global.MessageChannel;
