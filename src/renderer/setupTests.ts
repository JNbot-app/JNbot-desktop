import '@testing-library/jest-dom';
import { configure } from '@testing-library/react';

// Ant Design styles + React 18 rendering in jsdom under heavy multi-core CPU load
// can exceed the default 1000ms asyncUtilTimeout. 5000ms gives ample time for DOM updates.
configure({ asyncUtilTimeout: 5000 });
