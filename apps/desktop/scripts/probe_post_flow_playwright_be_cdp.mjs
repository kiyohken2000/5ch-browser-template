import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const desktopDir = process.cwd();
const root = path.resolve(desktopDir, '..', '..');
const envPath = path.join(desktopDir, '.env.local');
const outPath = path.join(root, 'docs', 'POST_FLOW_PLAYWRIGHT_BE_CDP_2026-03-07.json');

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

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');

const records = [];
const reqMap = new Map();

cdp.on('Network.requestWillBeSent', (e) => {
  if (e.request?.url?.includes('/test/bbs.cgi')) {
    reqMap.set(e.requestId, { url: e.request.url, method: e.request.method, headers: e.request.headers || {} });
  }
});

cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
  if (reqMap.has(e.requestId)) {
    const rec = reqMap.get(e.requestId);
    rec.extraRequestHeaders = e.headers || {};
    reqMap.set(e.requestId, rec);
  }
});

cdp.on('Network.responseReceived', (e) => {
  if (reqMap.has(e.requestId)) {
    const rec = reqMap.get(e.requestId);
    rec.status = e.response.status;
    rec.responseHeaders = e.response.headers || {};
    reqMap.set(e.requestId, rec);
  }
});

cdp.on('Network.responseReceivedExtraInfo', (e) => {
  if (reqMap.has(e.requestId)) {
    const rec = reqMap.get(e.requestId);
    rec.extraResponseHeaders = e.headers || {};
    reqMap.set(e.requestId, rec);
    records.push(rec);
  }
});

await page.goto('https://5ch.io/_login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[name="umail"]', env.BE_EMAIL || '');
await page.fill('input[name="pword"]', env.BE_PASSWORD || '');
await Promise.all([
  page.waitForLoadState('domcontentloaded', { timeout: 60000 }),
  page.click('input[name="login_be_normal_user"]'),
]);

await page.goto('https://mao.5ch.io/test/read.cgi/ngt/9240230711/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('textarea[name="MESSAGE"]', '');
await Promise.all([
  page.waitForLoadState('domcontentloaded', { timeout: 60000 }),
  page.click('input[name="submit"]'),
]);
await page.waitForTimeout(1200);

const cookies = await context.cookies();

const normalize = (obj) => {
  const c = obj?.cookie || obj?.Cookie || '';
  const names = c
    ? [...new Set(c.split(';').map(x => x.trim().split('=')[0]).filter(Boolean))].sort()
    : [];
  return { cookie_present: Boolean(c), cookie_names: names };
};

const cleaned = records.map((r) => ({
  url: r.url,
  method: r.method,
  status: r.status,
  request_header_cookie: normalize(r.extraRequestHeaders || r.headers),
  response_set_cookie_present: Boolean((r.extraResponseHeaders && (r.extraResponseHeaders['set-cookie'] || r.extraResponseHeaders['Set-Cookie'])) || (r.responseHeaders && (r.responseHeaders['set-cookie'] || r.responseHeaders['Set-Cookie']))),
}));

const report = {
  executed_at: new Date().toISOString(),
  final_url: page.url(),
  context_cookie_names: [...new Set(cookies.map(c => c.name))].sort(),
  bbs_records: cleaned,
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`WROTE: ${outPath}`);
console.log(`COOKIES: ${report.context_cookie_names.join(',') || '(none)'}`);
console.log(`BBS_RECORDS: ${cleaned.length}`);

await browser.close();
