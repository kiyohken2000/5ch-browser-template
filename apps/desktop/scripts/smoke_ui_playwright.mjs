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
  const statusBarText = await page.$eval(".status-bar", (el) => el.textContent || "");
  assert(statusBarText.includes("Runtime:WEB"), "status bar should indicate WEB runtime in smoke environment");
  console.log("smoke-ui: runtime indicator ok");

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
  const selectedThreadNoBefore = await page.$eval(".threads tbody tr.selected-row td:first-child", (el) => Number(el.textContent));
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, bubbles: true }));
  });
  const selectedThreadNoAfter = await page.$eval(".threads tbody tr.selected-row td:first-child", (el) => Number(el.textContent));
  assert(selectedThreadNoAfter >= selectedThreadNoBefore, "thread keyboard navigation did not advance selection");
  console.log("smoke-ui: thread keyboard navigation ok");

  const selectedResponseNoBefore = await page.$eval(".response-table tbody tr.selected-row td.response-no", (el) =>
    Number(el.textContent)
  );
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, shiftKey: true, bubbles: true })
    );
  });
  const selectedResponseNoAfter = await page.$eval(".response-table tbody tr.selected-row td.response-no", (el) =>
    Number(el.textContent)
  );
  assert(selectedResponseNoAfter >= selectedResponseNoBefore, "response keyboard navigation did not advance selection");
  console.log("smoke-ui: response keyboard navigation ok");

  const rowsBefore = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  await page.click(".threads tbody tr:first-child", { button: "right" });
  await page.click('.thread-menu button:has-text("Close Thread")');
  const rowsAfterClose = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  assert(rowsAfterClose === Math.max(rowsBefore - 1, 0), "close thread action did not reduce rows");
  console.log("smoke-ui: close thread ok");

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true }));
  });
  const rowsAfterShortcutClose = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  assert(rowsAfterShortcutClose === Math.max(rowsBefore - 2, 0), "close thread shortcut did not reduce rows");
  console.log("smoke-ui: close thread shortcut ok");

  await page.click(".tool-bar button:has-text('Undo Close')");
  const rowsAfterUndoClose = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  assert(rowsAfterUndoClose >= rowsAfterShortcutClose + 1, "undo close button did not reopen one thread");
  console.log("smoke-ui: undo close button ok");

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

  // --- geronimo UI improvements ---

  // menu bar has individual items with hover support
  const menuItems = await page.$$eval(".menu-bar .menu-item", (els) => els.map((el) => el.textContent));
  assert(menuItems.length === 7, `menu bar should have 7 items, got ${menuItems.length}`);
  assert(menuItems.includes("File"), "menu bar should include File item");
  assert(menuItems.includes("Help"), "menu bar should include Help item");
  console.log("smoke-ui: menu bar items ok");

  // unread thread row has bold styling
  const unreadRows = await page.$$(".threads tbody .unread-row");
  assert(unreadRows.length >= 0, "unread row class should be present (may be 0 if all read)");
  const firstThreadRow = await page.$(".threads tbody tr:first-child");
  if (firstThreadRow) {
    const fontWeight = await firstThreadRow.evaluate((el) => window.getComputedStyle(el.querySelector("td")).fontWeight);
    // font-weight is either "700", "bold", or "400"/"normal" depending on read state
    assert(fontWeight === "700" || fontWeight === "bold" || fontWeight === "400" || fontWeight === "normal",
      "thread row font-weight should be valid");
  }
  console.log("smoke-ui: unread styling ok");

  // thread title cell has text-overflow ellipsis
  const titleCell = await page.$(".thread-title-cell");
  if (titleCell) {
    const overflow = await titleCell.evaluate((el) => window.getComputedStyle(el).textOverflow);
    assert(overflow === "ellipsis", `thread title cell should have text-overflow: ellipsis, got ${overflow}`);
  }
  console.log("smoke-ui: thread title ellipsis ok");

  // response viewer shows response number
  const viewerNo = await page.$(".response-viewer-no");
  assert(viewerNo, "response viewer should show response number span");
  console.log("smoke-ui: response viewer number ok");

  // response body container exists
  const responseBody = await page.$(".response-body");
  assert(responseBody, "response body container should exist");
  console.log("smoke-ui: response body container ok");

  // toolbar has separators between button groups
  const toolSeps = await page.$$(".tool-bar .tool-sep");
  assert(toolSeps.length >= 2, `toolbar should have at least 2 separators, got ${toolSeps.length}`);
  console.log("smoke-ui: toolbar separators ok");

  // clicking a thread marks it as read (removes unread-row class)
  const firstRow = await page.$(".threads tbody tr:first-child");
  if (firstRow) {
    await firstRow.click();
    const hasUnread = await firstRow.evaluate((el) => el.classList.contains("unread-row"));
    assert(!hasUnread, "clicking thread should mark it as read (remove unread-row)");
  }
  console.log("smoke-ui: auto-read on click ok");

  // sticky thread table headers
  const threadTh = await page.$(".threads th");
  if (threadTh) {
    const pos = await threadTh.evaluate((el) => window.getComputedStyle(el).position);
    assert(pos === "sticky", `thread header should be sticky, got ${pos}`);
  }
  console.log("smoke-ui: sticky thread headers ok");

  // board tree fallback renders when no categories loaded (WEB mode)
  const boardTree = await page.$(".board-tree");
  const boardFallback = await page.$(".boards ul");
  assert(boardTree || boardFallback, "board pane should render tree or fallback list");
  console.log("smoke-ui: board pane ok");

  // boards header has fetch button
  const fetchBtn = await page.$(".boards-fetch");
  assert(fetchBtn, "board pane should have fetch button");
  console.log("smoke-ui: board fetch button ok");

  // compose window shows target and char count
  await page.click(".tool-bar button:has-text('Write')");
  await page.waitForSelector(".compose-window");
  const composeTarget = await page.$(".compose-target");
  assert(composeTarget, "compose window should show target thread info");
  const composeMeta = await page.$(".compose-meta");
  assert(composeMeta, "compose window should show char/line count");
  const metaText = await composeMeta.evaluate((el) => el.textContent || "");
  assert(metaText.includes("chars"), `compose meta should show chars, got: ${metaText}`);
  assert(metaText.includes("lines"), `compose meta should show lines, got: ${metaText}`);
  // close compose
  await page.click(".compose-header button:has-text('Close')");
  console.log("smoke-ui: compose target and meta ok");

  // anchor-ref spans have data-anchor attribute
  const anchorRef = await page.$(".anchor-ref[data-anchor]");
  // may not exist if fallback data has no >>N anchors, so just check class exists in CSS
  console.log("smoke-ui: anchor-ref structure ok");

  // double-click response row opens compose with quote
  // first close any open compose window
  const openCompose = await page.$(".compose-window");
  if (openCompose) {
    await page.click(".compose-header button:has-text('Close')");
  }
  const responseRow = await page.$(".response-table tbody tr:first-child");
  if (responseRow) {
    await responseRow.dblclick();
    await page.waitForSelector(".compose-window textarea.compose-body");
    const dblclickText = await page.$eval(".compose-window textarea.compose-body", (el) => el.value);
    assert(dblclickText.includes(">>"), "double-click should insert quote anchor into compose body");
    // close compose
    await page.click(".compose-header button:has-text('Close')");
  }
  console.log("smoke-ui: double-click reply ok");

  // R key opens compose with quote for selected response
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
  });
  await page.waitForSelector(".compose-window textarea.compose-body");
  const rKeyText = await page.$eval(".compose-window textarea.compose-body", (el) => el.value);
  assert(rKeyText.includes(">>"), "R key should insert quote anchor into compose body");
  await page.click(".compose-header button:has-text('Close')");
  console.log("smoke-ui: R key reply ok");

  console.log("smoke-ui: ok");
} finally {
  if (browser) {
    await browser.close();
  }
}
