import { defineConfig, devices } from '@playwright/test';

// DUCKTOWN_E2E_PORT moves the isolated test server off 8790 when something else is using it.
const PORT=Number(process.env.DUCKTOWN_E2E_PORT||8790);

export default defineConfig({
  testDir:'./e2e',
  testMatch:'*.spec.js',
  fullyParallel:false,
  workers:1,
  reporter:'list',
  use:{baseURL:`http://127.0.0.1:${PORT}`,trace:'on-first-retry'},
  projects:[
    {name:'desktop',use:{...devices['Desktop Chrome']}},
    {name:'mobile',use:{...devices['Pixel 7']}}
  ],
  webServer:{command:'node e2e/serve.js',url:`http://127.0.0.1:${PORT}/api/v1/health`,reuseExistingServer:false,timeout:30000}
});
