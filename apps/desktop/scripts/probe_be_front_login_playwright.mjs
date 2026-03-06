import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const desktopDir = process.cwd();
const root = path.resolve(desktopDir, '..', '..');
const envPath = path.join(desktopDir, '.env.local');
const outPath = path.join(root, 'docs', 'BE_FRONT_LOGIN_PLAYWRIGHT_2026-03-07.json');

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
let loginPostBody = null;

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on('response', async (resp) => {
  const url = resp.url();
  if (!url.includes('5ch.io')) return;
  const headers = await resp.allHeaders();
  const item = {
    url,
    status: resp.status(),
    method: resp.request().method(),
    location: headers['location'] || null,
    set_cookie_present: Boolean(headers['set-cookie']),
    set_cookie_prefix: headers['set-cookie'] ? headers['set-cookie'].split(';')[0].split('=')[0] : null,
  };
  if (url.includes('/_login') && resp.request().method() === 'POST') {
    try {
      loginPostBody = await resp.text();
    } catch {}
  }
  events.push(item);
});

await page.goto('https://5ch.io/_login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[name="umail"]', env.BE_EMAIL);
await page.fill('input[name="pword"]', env.BE_PASSWORD);
await Promise.all([
  page.waitForLoadState('domcontentloaded', { timeout: 60000 }),
  page.click('input[name="login_be_normal_user"]'),
]);
await page.waitForTimeout(2500);

const finalUrl = page.url();
const title = await page.title();
const text = await page.textContent('body');
const cookies = await context.cookies('https://5ch.io/');

const report = {
  executed_at: new Date().toISOString(),
  final_url: finalUrl,
  title,
  markers: {
    has_login_word: /ログイン|login/i.test(text || ''),
    has_logout_word: /ログアウト|logout/i.test(text || ''),
    has_ng_exact: (loginPostBody || '').trim() === 'NG',
    login_post_body_preview: loginPostBody ? loginPostBody.slice(0, 200) : null,
  },
  cookies: cookies.map(c => ({ name: c.name, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly })),
  events,
  notes: ['credential values are never written', 'cookie values are omitted'],
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`WROTE: ${outPath}`);
console.log(`FINAL_URL: ${finalUrl}`);
console.log(`COOKIES: ${report.cookies.map(c => c.name).join(',') || '(none)'}`);
console.log(`LOGIN_POST_BODY: ${(loginPostBody || '').slice(0,120)}`);

await browser.close();
