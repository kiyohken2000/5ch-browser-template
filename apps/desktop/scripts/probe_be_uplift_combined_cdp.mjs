import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const desktopDir = process.cwd();
const root = path.resolve(desktopDir, '..', '..');
const envPath = path.join(desktopDir, '.env.local');
const outPath = path.join(root, 'docs', 'BE_UPLIFT_COMBINED_POST_CDP_2026-03-07.json');

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
for (const k of ['BE_EMAIL','BE_PASSWORD','UPLIFT_EMAIL','UPLIFT_PASSWORD']) {
  if (!env[k]) {
    console.error(`FAILED: missing ${k}`);
    process.exit(1);
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');

let loginSetCookies = [];
const reqMap = new Map();
const bbsRecords = [];

cdp.on('Network.responseReceivedExtraInfo', (e) => {
  const setCookie = e.headers['set-cookie'] || e.headers['Set-Cookie'] || '';
  if (setCookie && reqMap.has(e.requestId)) {
    const rec = reqMap.get(e.requestId);
    if (rec.url.includes('/_login') || rec.url.includes('uplift.5ch.io/log')) {
      loginSetCookies.push({ url: rec.url, set_cookie_raw: setCookie });
    }
  }
  if (reqMap.has(e.requestId)) {
    const rec = reqMap.get(e.requestId);
    if (rec.url.includes('/test/bbs.cgi') && rec.method === 'POST') {
      const reqCookie = (rec.extraRequestHeaders?.cookie || rec.extraRequestHeaders?.Cookie || '');
      const cookieNames = reqCookie
        ? [...new Set(reqCookie.split(';').map(x => x.trim().split('=')[0]).filter(Boolean))].sort()
        : [];
      bbsRecords.push({
        url: rec.url,
        method: rec.method,
        request_cookie_names: cookieNames,
        response_set_cookie: Boolean(setCookie),
      });
    }
  }
});

cdp.on('Network.requestWillBeSent', (e) => {
  reqMap.set(e.requestId, { url: e.request.url, method: e.request.method });
});

cdp.on('Network.requestWillBeSentExtraInfo', (e) => {
  if (reqMap.has(e.requestId)) {
    const rec = reqMap.get(e.requestId);
    rec.extraRequestHeaders = e.headers || {};
    reqMap.set(e.requestId, rec);
  }
});

// 1) BE front login
await page.goto('https://5ch.io/_login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[name="umail"]', env.BE_EMAIL);
await page.fill('input[name="pword"]', env.BE_PASSWORD);
await Promise.all([
  page.waitForLoadState('domcontentloaded', { timeout: 60000 }),
  page.click('input[name="login_be_normal_user"]'),
]);
await page.waitForTimeout(1200);
const beFinal = page.url();

// 2) UPLIFT login
await page.goto('https://uplift.5ch.io/login', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('input[name="usr"]', env.UPLIFT_EMAIL);
await page.fill('input[name="pwd"]', env.UPLIFT_PASSWORD);
await Promise.all([
  page.waitForLoadState('domcontentloaded', { timeout: 60000 }),
  page.click('button[name="log"]'),
]);
await page.waitForTimeout(1200);
const upliftFinal = page.url();

// 3) post probe (empty body)
await page.goto('https://mao.5ch.io/test/read.cgi/ngt/9240230711/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.fill('textarea[name="MESSAGE"]', '');
await Promise.all([
  page.waitForLoadState('domcontentloaded', { timeout: 60000 }),
  page.click('input[name="submit"]'),
]);
await page.waitForTimeout(1200);

const cookies = await context.cookies();

const report = {
  executed_at: new Date().toISOString(),
  be_login_final_url: beFinal,
  uplift_login_final_url: upliftFinal,
  context_cookies: cookies.map(c => ({ name: c.name, domain: c.domain, path: c.path, secure: c.secure, httpOnly: c.httpOnly, expires: c.expires })),
  bbs_records: bbsRecords,
  login_set_cookie_headers: loginSetCookies,
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`WROTE: ${outPath}`);
console.log(`CTX_COOKIES: ${report.context_cookies.map(c=>c.name).sort().join(',')}`);
if (bbsRecords[0]) console.log(`BBS_REQ_COOKIE_NAMES: ${bbsRecords[0].request_cookie_names.join(',')}`);

await browser.close();
