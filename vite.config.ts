import { defineConfig } from 'vitest/config';

// localStorage belongs to an origin, and the port is part of it. If Vite
// silently moved to another port the trail would look empty, so both servers
// use 5173 and refuse to start when it is taken. Binding to localhost keeps
// the app off the local network.
const server = { host: 'localhost', port: 5173, strictPort: true };

export default defineConfig({
  server,
  preview: server,
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './tests/setup.ts',
  },
});
