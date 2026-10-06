// Renders the Town Map scenes to frontend/src/places/*.webp. Needs the dev server and
// tools/fetch-place-assets.mjs run once. Usage: node tools/render-places.mjs [name ...]
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const out = new URL('../frontend/src/places/', import.meta.url);
await mkdir(out, {recursive: true});
const browser = await chromium.launch({channel: 'chrome'});
const page = await browser.newPage({viewport: {width: 1300, height: 1000}});
page.on('pageerror', e => console.error(e));
await page.goto('http://127.0.0.1:5173/render-places.html');
await page.waitForFunction(() => window.renderReady, null, {timeout: 120000});
const names = process.argv.slice(2).length ? process.argv.slice(2) : await page.evaluate(() => window.PLACES);
for (const name of names) {
  const url = await page.evaluate(n => window.renderPlace(n), name);
  const bytes = Buffer.from(url.split(',')[1], 'base64');
  await writeFile(new URL(`${name}.webp`, out), bytes);
  console.log(`${name}.webp ${(bytes.length / 1024).toFixed(0)} KB`);
}
await browser.close();
