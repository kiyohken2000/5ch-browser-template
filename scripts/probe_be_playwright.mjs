import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const envPath = path.join(root, 'apps', 'desktop', '.env.local');
const outPath = path.join(root, 'docs', 'BE_PLAYWRIGHT_PROBE_2026-03-07.json');

function loadEnv(file) {
  const map = {};
  const txt = fs.readFileSync(file, 'utf8');
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return map;
}

const env = loadEnv(envPath);
if (!env.BE_EMAIL || !env.BE_PASSWORD) {
  console.error('FAILED: BE_EMAIL/BE_PASSWORD missing');
  process.exit(1);
}

const events = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on('response', async (resp) => {
  const url = resp.url();
  if (!url.includes('be.5ch.net')) return;
  const headers = await resp.allHeaders();
  events.push({
    url,
    status: resp.status(),
    location: headers['location'] || null,
    set_cookie_present: Boolean(headers['set-cookie']),
    set_cookie_prefix: headers['set-cookie'] ? headers['set-cookie'].split(';')[0].split('=')[0] : null,
  });
});

await page.goto('https://be.5ch.net/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[name="mail"]', env.BE_EMAIL);
await page.fill('input[name="pass"]', env.BE_PASSWORD);
await Promise.all([
  page.waitForLoadState('domcontentloaded', { timeout: 60000 }),
  page.click('button[name="login"]'),
]);

await page.waitForTimeout(2000);

const finalUrl = page.url();
const title = await page.title();
const pageText = await page.textContent('body');
const cookies = await context.cookies('https://be.5ch.net/');

const report = {
  executed_at: new Date().toISOString(),
  final_url: finalUrl,
  title,
  markers: {
    has_login_word: /ログイン|login/i.test(pageText || ''),
    has_logout_word: /ログアウト|logout/i.test(pageText || ''),
    has_status_word: /status|ステータス|会員/i.test(pageText || ''),
  },
  cookies: cookies.map(c => ({ name: c.name, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly })),
  events,
  notes: [
    'credential values are never written',
    'cookie values are omitted',
  ],
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`WROTE: ${outPath}`);
console.log(`FINAL_URL: ${finalUrl}`);
console.log(`COOKIES: ${report.cookies.map(c => c.name).join(',') || '(none)'}`);

await browser.close();
