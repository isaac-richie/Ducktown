// Renders Pollen's exact Microduck (every colourway × pose) to frontend/src/renders/*.webp.
// Needs the dev server (npm run dev:frontend) and a GPU-backed Chrome: `node tools/render-ducks.mjs`.
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const out = new URL('../frontend/src/renders/', import.meta.url);
const browser = await chromium.launch({channel: 'chrome'});
const page = await browser.newPage({viewport: {width: 800, height: 800}});
page.on('pageerror', e => console.error(e));
await page.goto('http://127.0.0.1:5173/render-duck.html');
await page.waitForFunction(() => window.renderReady, null, {timeout: 120000});
const poses = await page.evaluate(() => window.POSES);
for (const variant of ['cream', 'graphite', 'lavender', 'sky']) for (const pose of poses) {
  const url = await page.evaluate(([v, p]) => window.renderDuck(v, p), [variant, pose]);
  const bytes = Buffer.from(url.split(',')[1], 'base64');
  await writeFile(new URL(`${variant}-${pose}.webp`, out), bytes);
  console.log(`${variant}-${pose}.webp ${(bytes.length / 1024).toFixed(0)} KB`);
}
await browser.close();
