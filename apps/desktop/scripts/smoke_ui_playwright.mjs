import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

let browser;
try {
  const envUrl = process.env.SMOKE_UI_URL?.trim();
  const targetUrl = envUrl && envUrl.length > 0 ? envUrl : pathToFileURL(path.resolve(process.cwd(), "dist", "index.html")).href;
  if (!envUrl) {
    const distPath = path.resolve(process.cwd(), "dist", "index.html");
    if (!existsSync(distPath)) {
      throw new Error("dist/index.html not found. run `npm run build` before smoke test.");
    }
  }

  browser = await chromium.launch({ headless: true });
  console.log("smoke-ui: browser launched");
  const context = await browser.newContext();
  await context.addInitScript(() => {
    localStorage.removeItem("desktop.layoutPrefs.v1");
  });
  const page = await context.newPage();
  await page.goto(targetUrl, { waitUntil: "load" });
  console.log("smoke-ui: page loaded");

  await page.waitForSelector(".layout");
  const initialColumns = await page.$eval(".layout", (el) => el.style.gridTemplateColumns);
  const splitters = await page.$$(".pane-splitter");
  assert(splitters.length >= 2, "missing pane splitters");
  const firstSplitterBox = await splitters[0].boundingBox();
  assert(firstSplitterBox, "failed to get splitter bounds");
  await page.mouse.move(firstSplitterBox.x + firstSplitterBox.width / 2, firstSplitterBox.y + firstSplitterBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(firstSplitterBox.x + firstSplitterBox.width / 2 + 48, firstSplitterBox.y + firstSplitterBox.height / 2);
  await page.mouse.up();
  const resizedColumns = await page.$eval(".layout", (el) => el.style.gridTemplateColumns);
  assert(initialColumns !== resizedColumns, "pane resize did not update layout columns");
  console.log("smoke-ui: pane resize ok");

  await page.waitForSelector(".threads tbody tr");
  const rowsBefore = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  await page.click(".threads tbody tr:first-child", { button: "right" });
  await page.click('.thread-menu button:has-text("Close Thread")');
  const rowsAfterClose = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  assert(rowsAfterClose === Math.max(rowsBefore - 1, 0), "close thread action did not reduce rows");
  console.log("smoke-ui: close thread ok");

  await page.click(".threads tbody tr:first-child", { button: "right" });
  await page.click('.thread-menu button:has-text("Reopen Last")');
  const rowsAfterReopenLast = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  assert(rowsAfterReopenLast >= rowsBefore, "reopen last action did not restore thread row");
  console.log("smoke-ui: reopen last ok");

  await page.click(".threads tbody tr:first-child", { button: "right" });
  await page.click('.thread-menu button:has-text("Close Thread")');

  await page.click(".threads tbody tr:first-child", { button: "right" });
  await page.click('.thread-menu button:has-text("Reopen All")');
  const rowsAfterReopen = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  assert(rowsAfterReopen >= rowsBefore, "reopen all action did not restore thread rows");
  console.log("smoke-ui: reopen all ok");

  await page.click(".response-no", { button: "left" });
  await page.click('.response-menu button:has-text("Quote This Response")');
  await page.waitForSelector(".compose-window textarea.compose-body");
  const composeText = await page.$eval(".compose-window textarea.compose-body", (el) => el.value);
  assert(composeText.includes(">>1"), "quote action did not append response anchor");

  console.log("smoke-ui: ok");
} finally {
  if (browser) {
    await browser.close();
  }
}
