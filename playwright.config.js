import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir:'./e2e',
  testMatch:'*.spec.js',
  fullyParallel:false,
  workers:1,
  reporter:'list',
  use:{baseURL:'http://127.0.0.1:8790',trace:'on-first-retry'},
  projects:[
    {name:'desktop',use:{...devices['Desktop Chrome']}},
    {name:'mobile',use:{...devices['Pixel 7']}}
  ],
  webServer:{command:'node e2e/serve.js',url:'http://127.0.0.1:8790/api/v1/health',reuseExistingServer:false,timeout:30000}
});
