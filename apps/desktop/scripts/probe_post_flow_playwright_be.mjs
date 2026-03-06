import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const desktopDir = process.cwd();
const root = path.resolve(desktopDir, '..', '..');
const envPath = path.join(desktopDir, '.env.local');
const outPath = path.join(root, 'docs', 'POST_FLOW_PLAYWRIGHT_BE_2026-03-07.json');
const threadUrl = 'https://mao.5ch.io/test/read.cgi/ngt/9240230711/';

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

function cookieNamesFromHeader(cookieHeader) {
  if (!cookieHeader) return [];
  return [...new Set(cookieHeader.split(';').map(x => x.trim().split('=')[0]).filter(Boolean))].sort();
}

const env = loadEnv(envPath);
if (!env.BE_EMAIL || !env.BE_PASSWORD) {
  console.error('FAILED: BE_EMAIL/BE_PASSWORD missing');
  process.exit(1);
}

async function runCase(mode, withBeLogin) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const capture = {
    mode,
    login_final_url: null,
    context_cookie_names: [],
    bbs_request_cookie_names: [],
    bbs_response_status: null,
    bbs_response_location: null,
    markers: {},
  };

  let bbsCookieHeader = null;

  page.on('request', (req) => {
    if (req.url().includes('/test/bbs.cgi') && req.method() === 'POST') {
      bbsCookieHeader = req.headers()['cookie'] || '';
    }
  });

  page.on('response', async (resp) => {
    if (resp.url().includes('/test/bbs.cgi') && resp.request().method() === 'POST') {
      const h = await resp.allHeaders();
      capture.bbs_response_status = resp.status();
      capture.bbs_response_location = h['location'] || null;
    }
  });

  if (withBeLogin) {
    await page.goto('https://5ch.io/_login', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.fill('input[name="umail"]', env.BE_EMAIL);
    await page.fill('input[name="pword"]', env.BE_PASSWORD);
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 60000 }),
      page.click('input[name="login_be_normal_user"]'),
    ]);
    await page.waitForTimeout(1200);
    capture.login_final_url = page.url();
  }

  await page.goto(threadUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.fill('textarea[name="MESSAGE"]', '');
  await Promise.all([
    page.waitForLoadState('domcontentloaded', { timeout: 60000 }),
    page.click('input[name="submit"]'),
  ]);

  await page.waitForTimeout(1500);

  const body = (await page.textContent('body')) || '';
  capture.markers = {
    has_confirm: /確認|confirm/i.test(body),
    has_error: /error|エラー|本文/i.test(body),
    has_login_word: /ログイン|login/i.test(body),
  };

  const cookies = await context.cookies();
  capture.context_cookie_names = [...new Set(cookies.map(c => c.name))].sort();
  capture.bbs_request_cookie_names = cookieNamesFromHeader(bbsCookieHeader);

  await browser.close();
  return capture;
}

const results = [];
results.push(await runCase('anonymous', false));
results.push(await runCase('be_front_logged_in', true));

const report = {
  executed_at: new Date().toISOString(),
  thread_url: threadUrl,
  results,
  notes: [
    'credential values are never written',
    'cookie values are omitted',
  ],
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
console.log(`WROTE: ${outPath}`);
for (const r of results) {
  console.log(`[${r.mode}] login_final=${r.login_final_url} ctx_cookies=${r.context_cookie_names.join(',') || '(none)'} bbs_req_cookies=${r.bbs_request_cookie_names.join(',') || '(none)'} bbs_status=${r.bbs_response_status}`);
}
