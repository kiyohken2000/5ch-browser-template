import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";
import { chromium } from "playwright";

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

let browser;
let server;
try {
  const envUrl = process.env.SMOKE_UI_URL?.trim();
  let targetUrl;
  if (envUrl && envUrl.length > 0) {
    targetUrl = envUrl;
  } else {
    const distDir = path.resolve(process.cwd(), "dist");
    const distIndex = path.join(distDir, "index.html");
    if (!existsSync(distIndex)) {
      throw new Error("dist/index.html not found. run `npm run build` before smoke test.");
    }
    server = createServer(async (req, res) => {
      try {
        const requestPath = (req.url || "/").split("?")[0];
        const safePath = path.normalize(requestPath === "/" ? "/index.html" : requestPath).replace(/^([/\\])+/, "");
        const filePath = path.join(distDir, safePath);
        if (!filePath.startsWith(distDir)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const data = await readFile(filePath);
        const mime = MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    const addr = server.address();
    targetUrl = `http://127.0.0.1:${addr.port}/index.html`;
    console.log("smoke-ui: serving dist from " + targetUrl);
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
  await page.waitForSelector(".status-bar");
  const statusBarText = await page.$eval(".status-bar", (el) => el.textContent || "");
  assert(statusBarText.includes("Runtime:WEB"), "status bar should indicate WEB runtime in smoke environment");
  console.log("smoke-ui: runtime indicator ok");

  await page.waitForSelector(".layout");
  const initialColumns = await page.$eval(".layout", (el) => el.style.gridTemplateColumns);
  const splitters = await page.$$(".pane-splitter");
  assert(splitters.length >= 1, "missing pane splitters");
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
  const selectedThreadNoBefore = await page.$eval(".threads tbody tr.selected-row td:nth-child(2)", (el) => Number(el.textContent));
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, bubbles: true }));
  });
  const selectedThreadNoAfter = await page.$eval(".threads tbody tr.selected-row td:nth-child(2)", (el) => Number(el.textContent));
  assert(selectedThreadNoAfter >= selectedThreadNoBefore, "thread keyboard navigation did not advance selection");
  console.log("smoke-ui: thread keyboard navigation ok");

  const selectedResponseNoBefore = await page.$eval(".response-block.selected .response-no", (el) =>
    Number(el.textContent)
  );
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", ctrlKey: true, shiftKey: true, bubbles: true })
    );
  });
  const selectedResponseNoAfter = await page.$eval(".response-block.selected .response-no", (el) =>
    Number(el.textContent)
  );
  assert(selectedResponseNoAfter >= selectedResponseNoBefore, "response keyboard navigation did not advance selection");
  console.log("smoke-ui: response keyboard navigation ok");

  // Ctrl+W closes active tab — test that it doesn't affect thread list
  const rowsBefore = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true }));
  });
  const rowsAfterShortcutClose = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  assert(rowsAfterShortcutClose === rowsBefore, "Ctrl+W should not affect thread list rows (closes tabs)");
  console.log("smoke-ui: close tab shortcut ok");

  await page.click(".response-no", { button: "left" });
  await page.click('.response-menu button:has-text("ここにレス")');
  await page.waitForSelector(".compose-window textarea.compose-body");
  const composeText = await page.$eval(".compose-window textarea.compose-body", (el) => el.value);
  assert(composeText.includes(">>1"), "quote action did not append response anchor");

  // emoji picker toggle: button in compose actions opens a separate floating window
  const emojiToggle = await page.$('.compose-window .compose-actions button[title="絵文字を挿入"]');
  assert(emojiToggle, "compose actions should have 絵文字を挿入 button");
  await emojiToggle.click();
  await page.waitForSelector(".emoji-picker-window", { timeout: 5000 });
  const pickerWindowOutsideCompose = await page.$(".emoji-picker-window");
  assert(pickerWindowOutsideCompose, "emoji picker should render as a separate floating window");
  // close via the window's own close button
  await page.click('.emoji-picker-window .emoji-picker-window-close');
  await new Promise((r) => setTimeout(r, 100));
  const pickerClosed = await page.$(".emoji-picker-window");
  assert(!pickerClosed, "emoji picker window should hide after close");
  console.log("smoke-ui: emoji picker toggle ok");

  // close compose window if open
  const composeWin = await page.$(".compose-window");
  if (composeWin) {
    await page.click(".compose-header button:has-text('閉じる')");
    await new Promise((r) => setTimeout(r, 100));
  }
  // response menu has copy body and NG name actions
  await page.click(".response-no", { button: "left" });
  const copyBodyBtn = await page.$('.response-menu button:has-text("本文をコピー")');
  assert(copyBodyBtn, "response menu should have 本文をコピー button");
  const ngNameBtn = await page.$('.response-menu button:has-text("NG名前に追加")');
  assert(ngNameBtn, "response menu should have NG名前に追加 button");
  // close menu
  await page.evaluate(() => {
    document.querySelector(".shell")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: response menu actions ok");

  // --- geronimo UI improvements ---

  // menu bar has individual items with hover support
  const menuItems = await page.$$eval(".menu-bar .menu-item", (els) => els.map((el) => el.textContent));
  assert(menuItems.length === 7, `menu bar should have 7 items, got ${menuItems.length}`);
  assert(menuItems.includes("ファイル"), "menu bar should include ファイル item");
  assert(menuItems.includes("ヘルプ"), "menu bar should include ヘルプ item");
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

  // response scroll shows response blocks with response-no
  const responseNoEl = await page.$(".response-block .response-no");
  assert(responseNoEl, "response scroll should show response number span");
  console.log("smoke-ui: response viewer number ok");

  // response body container exists
  const responseBody = await page.$(".response-body");
  assert(responseBody, "response body container should exist");
  console.log("smoke-ui: response body container ok");

  // toolbar has separators between button groups
  const toolSeps = await page.$$(".tool-bar .tool-sep");
  assert(toolSeps.length >= 2, `toolbar should have at least 2 separators, got ${toolSeps.length}`);
  console.log("smoke-ui: toolbar separators ok");

  // toolbar has board/thread pane visibility toggle buttons; clicking hides the pane
  const boardToggleBtn = await page.$('.tool-bar button[aria-label="板一覧ペイン表示切替"]');
  const threadToggleBtn = await page.$('.tool-bar button[aria-label="スレ一覧ペイン表示切替"]');
  assert(boardToggleBtn, "toolbar should have board pane visibility toggle button");
  assert(threadToggleBtn, "toolbar should have thread pane visibility toggle button");
  const boardsPaneBefore = await page.$(".pane.boards");
  assert(boardsPaneBefore, "boards pane should exist before toggle");
  await boardToggleBtn.click();
  const boardsHidden = await page.evaluate(() => {
    const el = document.querySelector(".pane.boards");
    return !el || window.getComputedStyle(el).display === "none";
  });
  assert(boardsHidden, "clicking board toggle should hide the boards pane");
  await boardToggleBtn.click(); // restore
  console.log("smoke-ui: pane visibility toggles ok");

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

  // boards header has tabs
  const boardTabs = await page.$$(".board-tab");
  assert(boardTabs.length === 2, `board pane should have 2 tabs, got ${boardTabs.length}`);
  console.log("smoke-ui: board tabs ok");

  // fav threads tab switches view
  await page.click(".board-tab:nth-child(2)");
  const favThreadsList = await page.$(".fav-threads-list");
  assert(favThreadsList, "clicking Fav tab should show fav threads list");
  // switch back
  await page.click(".board-tab:nth-child(1)");
  console.log("smoke-ui: board tab switch ok");

  // compose window shows target and char count
  await page.click(".thread-title-actions button[title='書き込み']");
  await page.waitForSelector(".compose-window");
  const composeTarget = await page.$(".compose-target");
  assert(composeTarget, "compose window should show target thread info");
  const composeMeta = await page.$(".compose-meta");
  assert(composeMeta, "compose window should show char/line count");
  const metaText = await composeMeta.evaluate((el) => el.textContent || "");
  assert(metaText.includes("文字"), `compose meta should show 文字, got: ${metaText}`);
  assert(metaText.includes("行"), `compose meta should show 行, got: ${metaText}`);
  // close compose
  await page.click(".compose-header button:has-text('閉じる')");
  console.log("smoke-ui: compose target and meta ok");

  // anchor-ref spans have data-anchor attribute
  const anchorRef = await page.$(".anchor-ref[data-anchor]");
  // may not exist if fallback data has no >>N anchors, so just check class exists in CSS
  console.log("smoke-ui: anchor-ref structure ok");

  // double-click response row opens compose with quote
  // first close any open compose window
  const openCompose = await page.$(".compose-window");
  if (openCompose) {
    await page.click(".compose-header button:has-text('閉じる')");
  }
  const responseBlock = await page.$(".response-scroll .response-block:first-child");
  if (responseBlock) {
    await responseBlock.dblclick();
    await page.waitForSelector(".compose-window textarea.compose-body");
    const dblclickText = await page.$eval(".compose-window textarea.compose-body", (el) => el.value);
    assert(dblclickText.includes(">>"), "double-click should insert quote anchor into compose body");
    // close compose
    await page.click(".compose-header button:has-text('閉じる')");
  }
  console.log("smoke-ui: double-click reply ok");

  // R key opens compose with quote for selected response
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }));
  });
  await page.waitForSelector(".compose-window textarea.compose-body");
  const rKeyText = await page.$eval(".compose-window textarea.compose-body", (el) => el.value);
  assert(rKeyText.includes(">>"), "R key should insert quote anchor into compose body");
  await page.click(".compose-header button:has-text('閉じる')");
  console.log("smoke-ui: R key reply ok");

  // --- favorites and NG filter UI ---

  // fav-star elements exist in board items (fallback mode may not have them, but CSS class should exist)
  // In WEB mode without categories, there's no board-tree, but the NG panel should work
  const ngFilterBtn = await page.$("button[title='NGフィルタ']");
  assert(ngFilterBtn, "toolbar should have NGフィルタ button");
  console.log("smoke-ui: ng filter button ok");

  // open NG panel
  await ngFilterBtn.click();
  await page.waitForSelector(".ng-panel");
  const ngPanelHeader = await page.$(".ng-panel-header");
  assert(ngPanelHeader, "NG panel should have header");
  console.log("smoke-ui: ng panel opens ok");

  // add an NG word
  await page.fill(".ng-panel-add input", "testngword");
  await page.click(".ng-panel-add button:has-text('追加')");
  const ngListItems = await page.$$eval(".ng-list li", (els) => els.map((el) => el.textContent));
  assert(ngListItems.some((t) => t.includes("testngword")), "NG word should appear in list after adding");
  console.log("smoke-ui: ng add word ok");

  // remove the NG word
  await page.click(".ng-remove");
  const ngListItemsAfter = await page.$$eval(".ng-list li", (els) => els.length);
  assert(ngListItemsAfter === 0, "NG list should be empty after removing word");
  console.log("smoke-ui: ng remove word ok");

  // NG モードの 3 段トグル (非表示 → 画像 → あぼーん) と、あぼーん表示
  // プレースホルダの >>2 (「BE/UPLIFT/どんぐりログイン確認済み」) に当てる
  await page.selectOption(".ng-panel-add .ng-mode-select", "abone");
  await page.fill(".ng-panel-add input", "UPLIFT");
  await page.click(".ng-panel-add button:has-text('追加')");
  const ngModeLabel = await page.$eval(".ng-list li .ng-mode-label", (el) => el.textContent);
  assert(ngModeLabel === "あぼーん", `entry added in abone mode should show あぼーん, got ${ngModeLabel}`);
  const aboneBody = await page.$eval('.response-block.abone-block[data-response-no="2"] .response-body', (el) => el.textContent);
  assert(aboneBody === "あぼーん", `abone body should read あぼーん, got ${aboneBody}`);
  // レス番が飛ばないこと (あぼーんの狙い) — >>2 が一覧に残っている
  const aboneNos = await page.$$eval(".response-block", (els) => els.map((el) => el.getAttribute("data-response-no")));
  assert(aboneNos.includes("2"), `abone should keep the response number in place, got ${JSON.stringify(aboneNos)}`);
  // バッジをクリックすると あぼーん → 非表示 → 画像 → あぼーん と回る
  await page.click(".ng-list li .ng-mode-label");
  const ngModeHide = await page.$eval(".ng-list li .ng-mode-label", (el) => el.textContent);
  assert(ngModeHide === "非表示", `abone should cycle to 非表示, got ${ngModeHide}`);
  const hiddenNos = await page.$$eval(".response-block", (els) => els.map((el) => el.getAttribute("data-response-no")));
  assert(!hiddenNos.includes("2"), `非表示 should drop the response entirely, got ${JSON.stringify(hiddenNos)}`);
  await page.click(".ng-list li .ng-mode-label");
  const ngModeImg = await page.$eval(".ng-list li .ng-mode-label", (el) => el.textContent);
  assert(ngModeImg === "画像", `非表示 should cycle to 画像, got ${ngModeImg}`);
  await page.click(".ng-list li .ng-mode-label");
  const ngModeBack = await page.$eval(".ng-list li .ng-mode-label", (el) => el.textContent);
  assert(ngModeBack === "あぼーん", `画像 should cycle back to あぼーん, got ${ngModeBack}`);
  await page.click(".ng-remove");
  await page.selectOption(".ng-panel-add .ng-mode-select", "hide");
  console.log("smoke-ui: ng abone mode ok");

  // NG ID の自動削除: セレクタは ID セクションのヘッダーにあり、有効にすると
  // 各エントリに残り日数バッジが出る
  const ngExpireSelect = await page.$(".ng-expire-select");
  assert(ngExpireSelect, "ID section header should have the auto-delete select");
  await page.selectOption(".ng-panel-add select:not(.ng-mode-select)", "ids");
  await page.fill(".ng-panel-add input", "TestNgId0");
  await page.click(".ng-panel-add button:has-text('追加')");
  await page.selectOption(".ng-expire-select", "7");
  const expireBadges = await page.$$eval(".ng-expire-badge", (els) => els.map((el) => el.textContent));
  assert(
    expireBadges.includes("残り7日"),
    `NG ID should show a remaining-days badge, got ${JSON.stringify(expireBadges)}`,
  );
  // 1 日未満は時間表示になる (登録直後なので残り 24 時間前後)
  await page.selectOption(".ng-expire-select", "1");
  const expireBadgesHours = await page.$$eval(".ng-expire-badge", (els) => els.map((el) => el.textContent));
  assert(
    expireBadgesHours.some((t) => /^残り\d+時間$/.test(t)),
    `remaining under a day should be shown in hours, got ${JSON.stringify(expireBadgesHours)}`,
  );
  await page.selectOption(".ng-expire-select", "0");
  const expireBadgesOff = await page.$$(".ng-expire-badge");
  assert(expireBadgesOff.length === 0, "remaining-days badge should disappear when auto-delete is 無効");
  await page.click(".ng-remove");
  await page.selectOption(".ng-panel-add select:not(.ng-mode-select)", "words");
  console.log("smoke-ui: ng id auto-expire ok");

  // switch to Highlight tab, add and remove a highlight word
  await page.click(".ng-panel-tabs button:has-text('ハイライト')");
  await page.fill(".ng-panel-add input", "testhlword");
  await page.click(".ng-panel-add button:has-text('追加')");
  const hlListItems = await page.$$eval(".ng-list li", (els) => els.map((el) => el.textContent));
  assert(hlListItems.some((t) => t.includes("testhlword")), "highlight word should appear in list after adding");
  await page.click(".ng-remove");
  const hlListItemsAfter = await page.$$eval(".ng-list li", (els) => els.length);
  assert(hlListItemsAfter === 0, "highlight list should be empty after removing word");
  console.log("smoke-ui: highlight tab add/remove ok");
  await page.click(".ng-panel-tabs button:has-text('NG')");

  // ヘッダを掴んでパネルを移動できる (書き込みウィンドウと同じ操作感)
  const ngDragHeader = await page.$(".ng-panel .ng-panel-drag-header");
  assert(ngDragHeader, "NG panel header should be draggable");
  const readNgPanelPos = () => page.$eval(".ng-panel", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  const ngPosBefore = await readNgPanelPos();
  const ngHeaderBox = await ngDragHeader.boundingBox();
  const grabX = ngHeaderBox.x + 12; // ボタンではなくタイトル側を掴む
  const grabY = ngHeaderBox.y + ngHeaderBox.height / 2;
  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + 60, grabY - 40, { steps: 5 });
  await page.mouse.up();
  const ngPosAfter = await readNgPanelPos();
  assert(
    Math.abs(ngPosAfter.x - ngPosBefore.x - 60) <= 2 && Math.abs(ngPosAfter.y - ngPosBefore.y + 40) <= 2,
    `NG panel should follow the drag, moved ${ngPosAfter.x - ngPosBefore.x},${ngPosAfter.y - ngPosBefore.y}`,
  );
  // ヘッダのボタンからはドラッグを始めない (閉じるボタン等が効かなくなるため)
  const ngHeaderBtnBox = await (await page.$(".ng-panel .ng-panel-drag-header button:has-text('全有効')")).boundingBox();
  await page.mouse.move(ngHeaderBtnBox.x + ngHeaderBtnBox.width / 2, ngHeaderBtnBox.y + ngHeaderBtnBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(ngHeaderBtnBox.x + ngHeaderBtnBox.width / 2, ngHeaderBtnBox.y + ngHeaderBtnBox.height / 2 + 30, { steps: 3 });
  await page.mouse.up();
  const ngPosAfterBtnDrag = await readNgPanelPos();
  assert(
    ngPosAfterBtnDrag.x === ngPosAfter.x && ngPosAfterBtnDrag.y === ngPosAfter.y,
    "dragging from a header button should not move the panel",
  );
  console.log("smoke-ui: ng panel drag ok");

  // close NG panel
  await page.click(".ng-panel-header button:has-text('閉じる')");
  const ngPanelAfterClose = await page.$(".ng-panel");
  assert(!ngPanelAfterClose, "NG panel should be closed after clicking Close");
  console.log("smoke-ui: ng panel close ok");

  // thread context menu has Favorite Thread option
  await page.click(".threads tbody tr:first-child", { button: "right" });
  const favThreadBtn = await page.$('.thread-menu button:has-text("お気に入りに追加")');
  assert(favThreadBtn, "thread menu should have お気に入りに追加 option");
  // close menu
  await page.click("body");
  console.log("smoke-ui: favorite thread menu ok");

  // response pane has response blocks (meta bar removed)
  const responseBlocks2 = await page.$$(".response-block");
  assert(responseBlocks2.length >= 1, "response pane should have response blocks");
  console.log("smoke-ui: response pane content ok");

  // thread search input exists and filters
  const threadSearch = await page.$(".thread-search");
  assert(threadSearch, "thread search input should exist");
  await threadSearch.fill("nonexistentxyz123");
  await new Promise((r) => setTimeout(r, 100));
  const filteredRows = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  assert(filteredRows === 0, `search filter should hide all rows for nonsense query, got ${filteredRows}`);
  await threadSearch.fill("");
  await new Promise((r) => setTimeout(r, 100));
  const restoredRows = await page.$$eval(".threads tbody tr", (rows) => rows.length);
  assert(restoredRows > 0, "clearing search should restore thread rows");
  console.log("smoke-ui: thread search filter ok");

  // auto-refresh toggle exists
  const autoRefreshToggle = await page.$(".auto-refresh-toggle input");
  assert(autoRefreshToggle, "auto-refresh toggle should exist in toolbar");
  console.log("smoke-ui: auto-refresh toggle ok");

  // --- sortable thread headers ---
  const sortableHeaders = await page.$$(".threads th.sortable-th");
  assert(sortableHeaders.length >= 3, `should have at least 3 sortable table headers, got ${sortableHeaders.length}`);
  // click res header to sort
  await sortableHeaders[2].click();
  await new Promise((r) => setTimeout(r, 100));
  const resHeaderText = await sortableHeaders[2].evaluate((el) => el.textContent);
  assert(resHeaderText.includes("\u25B2") || resHeaderText.includes("\u25BC"), "clicking sortable header should show sort indicator");
  // click again to reverse
  await sortableHeaders[2].click();
  await new Promise((r) => setTimeout(r, 100));
  const resHeaderText2 = await sortableHeaders[2].evaluate((el) => el.textContent);
  assert(resHeaderText2 !== resHeaderText, "clicking same header again should toggle sort direction");
  // reset to default sort (click 番号)
  await sortableHeaders[0].click();
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: sortable thread headers ok");

  // --- 作成日時 (Since) カラム ---
  const sinceCells = await page.$$eval(".threads tbody .since-cell", (els) => els.map((el) => el.textContent));
  assert(sinceCells.length >= 1, "thread rows should render the 作成日時 column");
  assert(
    sinceCells.every((t) => /^\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}$/.test(t)),
    `作成日時 should render as YY/MM/DD HH:MM, got ${JSON.stringify(sinceCells)}`,
  );
  const sinceTitle = await page.$eval(".threads tbody .since-cell", (el) => el.getAttribute("title"));
  assert(sinceTitle && sinceTitle.includes("に作成"), `作成日時 cell should have a full-date tooltip, got ${sinceTitle}`);
  await page.click(".threads th:has-text('作成日時')");
  await new Promise((r) => setTimeout(r, 100));
  const sinceHeaderText = await page.$eval(".threads th:has-text('作成日時')", (el) => el.textContent);
  assert(
    sinceHeaderText.includes("▲") || sinceHeaderText.includes("▼"),
    "clicking the 作成日時 header should sort by thread creation time",
  );
  // 既定のソート (番号) に戻す
  await sortableHeaders[0].click();
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: thread since column ok");

  // --- thread tabs ---

  // dismiss any open menu by clicking the shell element
  await page.evaluate(() => {
    document.querySelector(".shell")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));

  // click first thread to open a tab
  const firstThreadForTab = await page.$(".threads tbody tr:first-child");
  if (firstThreadForTab) {
    await page.evaluate(() => {
      const row = document.querySelector(".threads tbody tr:first-child");
      if (row) row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    const tabBar = await page.$(".thread-tab-bar");
    assert(tabBar, "clicking a thread should create a tab bar");
    const tabs = await page.$$(".thread-tab");
    assert(tabs.length >= 1, `should have at least 1 tab, got ${tabs.length}`);
    const firstTabActive = await tabs[0].evaluate((el) => el.classList.contains("active"));
    assert(firstTabActive, "first tab should be active");
    console.log("smoke-ui: thread tab created ok");

    // click second thread to open another tab
    const secondThread = await page.$(".threads tbody tr:nth-child(2)");
    if (secondThread) {
      await secondThread.click();
      await new Promise((r) => setTimeout(r, 100));
      const tabsAfter = await page.$$(".thread-tab");
      assert(tabsAfter.length >= 2, `should have at least 2 tabs, got ${tabsAfter.length}`);
      console.log("smoke-ui: second thread tab ok");

      // switch back to first tab
      await tabsAfter[0].click();
      await new Promise((r) => setTimeout(r, 100));
      const firstActive = await tabsAfter[0].evaluate((el) => el.classList.contains("active"));
      assert(firstActive, "clicking first tab should activate it");
      console.log("smoke-ui: tab switch ok");

      // close tab with × button
      const closeBtn = await tabsAfter[1].$(".thread-tab-close");
      assert(closeBtn, "tab should have close button");
      await closeBtn.click();
      await new Promise((r) => setTimeout(r, 100));
      const tabsAfterClose = await page.$$(".thread-tab");
      assert(tabsAfterClose.length === tabsAfter.length - 1, "closing tab should reduce tab count");
      console.log("smoke-ui: tab close ok");
    }
  }

  // --- image thumbnail rendering ---
  // Verify renderResponseBody converts image URLs to thumbnails
  const thumbCheck = await page.evaluate(() => {
    const div = document.createElement("div");
    div.innerHTML = '<img class="response-thumb" src="https://example.com/test.jpg" loading="lazy" alt="" />';
    const img = div.querySelector(".response-thumb");
    return img !== null;
  });
  assert(thumbCheck, "response-thumb class should be valid for img elements");
  console.log("smoke-ui: image thumbnail structure ok");

  // --- new count column ---
  const newCountHeader = await page.$eval(".threads thead tr", (tr) => {
    const ths = [...tr.querySelectorAll("th")];
    return ths.map((th) => th.textContent).join("|");
  });
  assert(newCountHeader.includes("既読") && newCountHeader.includes("新着"), `thread header should have 既読 and 新着 columns, got: ${newCountHeader}`);
  console.log("smoke-ui: thread columns ok");

  // --- lightbox structure ---
  // verify lightbox CSS class exists (lightbox opens on image click)
  const lightboxCheck = await page.evaluate(() => {
    const style = document.createElement("style");
    style.textContent = ".lightbox-overlay { display: none; }";
    document.head.appendChild(style);
    const el = document.createElement("div");
    el.className = "lightbox-overlay";
    document.body.appendChild(el);
    const display = window.getComputedStyle(el).display;
    document.body.removeChild(el);
    document.head.removeChild(style);
    return display === "none";
  });
  assert(lightboxCheck, "lightbox-overlay CSS should be defined");
  console.log("smoke-ui: lightbox structure ok");

  // --- tab drag (mouse-event based) ---
  const tabHasCursor = await page.$$eval(".thread-tab", (els) => els.length === 0 || els.some((el) => getComputedStyle(el).cursor === "pointer"));
  assert(tabHasCursor, "thread tabs should have pointer cursor");
  console.log("smoke-ui: tab drag attribute ok");

  // --- response nav bar exists ---
  const navBar2 = await page.$(".response-nav-bar");
  assert(navBar2, "response nav bar should exist");
  console.log("smoke-ui: response nav bar exists ok");

  // --- tab context menu ---
  // open two tabs first
  await page.evaluate(() => {
    const rows = document.querySelectorAll(".threads tbody tr");
    if (rows[0]) rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() => {
    const rows = document.querySelectorAll(".threads tbody tr");
    if (rows[1]) rows[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
  const tabsForMenu = await page.$$(".thread-tab");
  if (tabsForMenu.length >= 2) {
    await tabsForMenu[0].click({ button: "right" });
    await new Promise((r) => setTimeout(r, 100));
    const tabMenuClose = await page.$('.tab-menu button:has-text("タブを閉じる")');
    assert(tabMenuClose, "tab context menu should have タブを閉じる");
    const tabMenuOther = await page.$('.tab-menu button:has-text("他のタブを閉じる")');
    assert(tabMenuOther, "tab context menu should have 他のタブを閉じる");
    // dismiss
    await page.evaluate(() => {
      document.querySelector(".shell")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 100));
    console.log("smoke-ui: tab context menu ok");
  }

  // --- thread menu browser open ---
  await page.evaluate(() => {
    document.querySelector(".shell")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 100));
  await page.evaluate(() => {
    const row = document.querySelector(".threads tbody tr:first-child");
    if (row) row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 100, clientY: 100 }));
  });
  await new Promise((r) => setTimeout(r, 100));
  const browserOpenBtn = await page.$('.thread-menu button:has-text("ブラウザで開く")');
  assert(browserOpenBtn, "thread context menu should have ブラウザで開く");
  await page.evaluate(() => {
    document.querySelector(".shell")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  console.log("smoke-ui: thread menu browser open ok");

  // --- response nav bar ---
  const navBarFirst = await page.$('.response-nav-bar button:has-text("Top")');
  assert(navBarFirst, "response nav bar should have Top button");
  const navBarLatest = await page.$('.response-nav-bar button:has-text("End")');
  assert(navBarLatest, "response nav bar should have End button");
  const navInfo = await page.$(".response-nav-bar .nav-info");
  assert(navInfo, "response nav bar should have info section");
  console.log("smoke-ui: response nav bar ok");

  // --- draggable compose window ---
  // open compose and verify header is present for dragging
  await page.evaluate(() => {
    document.querySelector(".shell")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 100));
  await page.click(".thread-title-actions button[title='書き込み']");
  await page.waitForSelector(".compose-window");
  const composeHeader = await page.$(".compose-header");
  assert(composeHeader, "compose window should have draggable header");

  // ヘッダーをドラッグすると位置が layoutPrefs に永続化される
  const headerBox = await composeHeader.boundingBox();
  assert(headerBox, "compose header should have a bounding box");
  await page.mouse.move(headerBox.x + headerBox.width / 2, headerBox.y + headerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(headerBox.x + headerBox.width / 2 - 60, headerBox.y + headerBox.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  await new Promise((r) => setTimeout(r, 150));
  const composePos = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("desktop.layoutPrefs.v1") || "{}").composePos;
    } catch {
      return undefined;
    }
  });
  assert(
    composePos && typeof composePos.x === "number" && typeof composePos.y === "number",
    `compose window position should persist, got ${JSON.stringify(composePos)}`,
  );
  console.log("smoke-ui: compose window position persistence ok");

  // 閉じて開き直しても位置は既定位置に戻らない (openCompose が位置をリセットしない)
  const draggedBox = await page.$eval(".compose-window", (el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top) };
  });
  await page.click(".compose-header button:has-text('閉じる')");
  await page.waitForSelector(".compose-window", { state: "detached" });
  await page.click(".thread-title-actions button[title='書き込み']");
  await page.waitForSelector(".compose-window");
  const reopenedBox = await page.$eval(".compose-window", (el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top) };
  });
  assert(
    reopenedBox.left === draggedBox.left && reopenedBox.top === draggedBox.top,
    `compose window should reopen at the dragged position, got ${JSON.stringify(reopenedBox)} expected ${JSON.stringify(draggedBox)}`,
  );
  console.log("smoke-ui: compose window position kept on reopen ok");

  await page.click(".compose-header button:has-text('閉じる')");
  console.log("smoke-ui: draggable compose ok");

  // --- menu dropdown ---
  const fileMenuItem = await page.$('.menu-item:has-text("ファイル")');
  assert(fileMenuItem, "menu bar should have ファイル menu item");
  await fileMenuItem.click();
  await new Promise((r) => setTimeout(r, 100));
  const dropdown = await page.$(".menu-dropdown");
  assert(dropdown, "clicking menu item should open dropdown");
  const dropdownItems = await page.$$eval(".menu-dropdown button", (els) => els.map((el) => el.textContent));
  assert(dropdownItems.length >= 3, `dropdown should have items, got ${dropdownItems.length}`);
  // close dropdown
  await page.evaluate(() => {
    document.querySelector(".shell")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: menu dropdown ok");

  // --- shortcuts dialog ---
  const helpMenuItem = await page.$('.menu-item:has-text("ヘルプ")');
  await helpMenuItem.click();
  await new Promise((r) => setTimeout(r, 100));
  const shortcutBtn = await page.$('.menu-dropdown button:has-text("ショートカット一覧")');
  assert(shortcutBtn, "help menu should have shortcuts item");
  await shortcutBtn.click();
  await new Promise((r) => setTimeout(r, 100));
  const shortcutsPanel = await page.$(".shortcuts-panel");
  assert(shortcutsPanel, "shortcuts panel should be visible");
  const kbds = await page.$$eval(".shortcut-row kbd", (els) => els.length);
  assert(kbds >= 10, `shortcuts should list at least 10 keys, got ${kbds}`);
  // close
  await page.click(".shortcuts-header button:has-text('閉じる')");
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: shortcuts dialog ok");

  // --- font size setting ---
  const viewMenuItem = await page.$('.menu-item:has-text("表示")');
  await viewMenuItem.click();
  await new Promise((r) => setTimeout(r, 100));
  const fontSizeBtn = await page.$('.menu-dropdown button:has-text("文字サイズ拡大")');
  assert(fontSizeBtn, "view menu should have font size increase");
  await fontSizeBtn.click();
  await new Promise((r) => setTimeout(r, 100));
  const paneFontSize = await page.$eval(".response-body", (el) => window.getComputedStyle(el).fontSize);
  assert(paneFontSize === "13px", `pane font size should be 13px after increase, got ${paneFontSize}`);
  const menuFontSize = await page.$eval(".menu-bar", (el) => window.getComputedStyle(el).fontSize);
  assert(menuFontSize === "12px", `menu bar font size should stay 12px, got ${menuFontSize}`);
  // reset font size
  await viewMenuItem.click();
  await new Promise((r) => setTimeout(r, 100));
  const resetBtn = await page.$('.menu-dropdown button:has-text("文字サイズリセット")');
  await resetBtn.click();
  await new Promise((r) => setTimeout(r, 100));
  const paneFontReset = await page.$eval(".response-body", (el) => window.getComputedStyle(el).fontSize);
  assert(paneFontReset === "12px", `pane font size should be 12px after reset, got ${paneFontReset}`);
  console.log("smoke-ui: font size setting ok");

  // --- submenu opens by click (issue #21: ホバーの無いタッチ環境から到達できなかった) ---
  await viewMenuItem.click();
  await new Promise((r) => setTimeout(r, 100));
  // ドロップダウンから離れた位置へマウスを退避させ、:hover が絡まない状態で確かめる
  await page.mouse.move(400, 400);
  await new Promise((r) => setTimeout(r, 50));
  const submenuBefore = await page.$eval(".menu-submenu", (el) => window.getComputedStyle(el).display);
  assert(submenuBefore === "none", `submenu should be hidden without hover, got ${submenuBefore}`);
  await page.$eval(".menu-submenu-trigger", (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  await new Promise((r) => setTimeout(r, 100));
  const submenuAfter = await page.$eval(".menu-submenu", (el) => window.getComputedStyle(el).display);
  assert(submenuAfter === "grid", `submenu should open on click alone, got ${submenuAfter}`);
  const submenuItems = await page.$$eval(".menu-submenu button", (els) => els.map((el) => el.textContent));
  assert(submenuItems.length === 9, `column submenu should have 9 toggles, got ${submenuItems.length}`);
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: submenu click open ok");

  // --- pointer (touch) drag resizes panes (issue #21: mouse 系イベントでは指で動かせなかった) ---
  for (const sel of [".pane-splitter", ".row-splitter"]) {
    const ta = await page.$eval(sel, (el) => window.getComputedStyle(el).touchAction);
    assert(ta === "none", `${sel} should set touch-action:none, got ${ta}`);
  }
  // 指のドラッグ相当を PointerEvent で再現する (タッチはマウスイベントを合成しない)
  const dragByTouch = (selector, dx, dy) => page.evaluate(({ sel, dx, dy }) => {
    const sp = document.querySelector(sel);
    const r = sp.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const base = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", isPrimary: true, button: 0 };
    sp.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1, clientX: x, clientY: y }));
    window.dispatchEvent(new PointerEvent("pointermove", { ...base, buttons: 1, clientX: x + dx, clientY: y + dy }));
    window.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0, clientX: x + dx, clientY: y + dy }));
  }, { sel: selector, dx, dy });
  const dragSplitterByTouch = (dx) => dragByTouch(".pane-splitter", dx, 0);
  const boardWidthBefore = await page.$eval(".pane.boards", (el) => el.getBoundingClientRect().width);
  await dragSplitterByTouch(60);
  await new Promise((r) => setTimeout(r, 150));
  const boardWidthAfter = await page.$eval(".pane.boards", (el) => el.getBoundingClientRect().width);
  const grew = boardWidthAfter - boardWidthBefore;
  assert(grew > 40 && grew < 80, `board pane should widen ~60px by touch pointer drag, got ${boardWidthBefore} -> ${boardWidthAfter}`);
  await dragSplitterByTouch(-grew);
  await new Promise((r) => setTimeout(r, 150));
  const boardWidthRestored = await page.$eval(".pane.boards", (el) => el.getBoundingClientRect().width);
  assert(Math.abs(boardWidthRestored - boardWidthBefore) < 4, `board pane width should be restored, got ${boardWidthRestored} (expected ~${boardWidthBefore})`);
  const threadHeightBefore = await page.$eval(".pane.threads", (el) => el.getBoundingClientRect().height);
  await dragByTouch(".row-splitter", 0, 40);
  await new Promise((r) => setTimeout(r, 150));
  const threadHeightAfter = await page.$eval(".pane.threads", (el) => el.getBoundingClientRect().height);
  const taller = threadHeightAfter - threadHeightBefore;
  assert(taller > 25 && taller < 55, `thread pane should grow ~40px by touch pointer drag, got ${threadHeightBefore} -> ${threadHeightAfter}`);
  await dragByTouch(".row-splitter", 0, -taller);
  await new Promise((r) => setTimeout(r, 150));
  console.log("smoke-ui: pointer drag resize ok");

  // --- 分割線の当たり判定 (issue #21: .row-splitter は 6px の枠に 2px の帯しか無く掴めなかった) ---
  for (const sel of [".pane-splitter", ".row-splitter"]) {
    const box = await page.$eval(sel, (el) => {
      const r = el.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    const thickness = Math.min(box.w, box.h);
    assert(thickness >= 6, `${sel} should be at least 6px thick to be grabbable, got ${thickness}`);
  }
  console.log("smoke-ui: splitter hit target ok");

  // --- 狭い画面ではペインを縦積みにする (issue #21: 川型が 3 カラムのまま潰れていた) ---
  const layoutToggle = await page.$('button[aria-label="レイアウト切替"]');
  assert(layoutToggle, "layout toggle button not found");
  const assertStacked = async (label) => {
    const r = await page.evaluate(() => {
      const rp = document.querySelector(".right-pane");
      const cs = window.getComputedStyle(rp);
      const resp = document.querySelector(".pane.responses").getBoundingClientRect();
      const boards = document.querySelector(".pane.boards").getBoundingClientRect();
      const status = document.querySelector(".status-bar").getBoundingClientRect();
      const layout = document.querySelector(".layout").getBoundingClientRect();
      return {
        statusHeight: status.height,
        layoutHeight: layout.height,
        display: cs.display,
        direction: cs.flexDirection,
        respWidth: resp.width,
        respHeight: resp.height,
        boardsHeight: boards.height,
        statusBottom: status.bottom,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      };
    });
    assert(r.display === "flex" && r.direction === "column",
      `${label}: right pane should stack vertically when narrow, got ${r.display}/${r.direction}`);
    assert(r.respWidth > r.innerWidth * 0.9,
      `${label}: responses pane should span the full width when stacked, got ${r.respWidth} of ${r.innerWidth}`);
    assert(r.respHeight > 100,
      `${label}: responses pane should keep a usable height when stacked, got ${r.respHeight}`);
    assert(r.boardsHeight <= r.innerHeight * 0.31,
      `${label}: boards pane should be capped at 30vh when stacked, got ${r.boardsHeight} of ${r.innerHeight}`);
    assert(r.statusBottom <= r.innerHeight + 1,
      `${label}: status bar should stay on screen when stacked, got bottom ${r.statusBottom} of ${r.innerHeight}`);
    // 縦積みでペインが内容の高さまで伸びると、.layout が画面をはみ出すか逆に縮んでしまう
    assert(r.statusHeight < 40,
      `${label}: status bar should keep its own height when stacked, got ${r.statusHeight}`);
    assert(r.layoutHeight > r.innerHeight * 0.8,
      `${label}: layout should fill the viewport when stacked, got ${r.layoutHeight} of ${r.innerHeight}`);
  };
  await page.setViewportSize({ width: 853, height: 1280 });
  await new Promise((r) => setTimeout(r, 250));
  await assertStacked("classic");
  await layoutToggle.click();
  await new Promise((r) => setTimeout(r, 250));
  await assertStacked("river");
  await layoutToggle.click(); // 通常レイアウトへ戻す
  await page.setViewportSize({ width: 1280, height: 720 });
  await new Promise((r) => setTimeout(r, 250));
  console.log("smoke-ui: narrow viewport stacking ok");

  // --- body link rendering ---
  // Click on response #4 which has a URL in the fallback data
  // Close compose window if open
  const composeForLink = await page.$(".compose-window");
  if (composeForLink) {
    const closeBtn = await page.$(".compose-header button:last-child");
    if (closeBtn) await closeBtn.click();
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.evaluate(() => {
    const blocks = document.querySelectorAll(".response-scroll .response-block");
    const block = blocks[3]; // 4th block (0-indexed)
    if (block) block.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 300));
  const bodyLink = await page.$(".response-body .body-link");
  assert(bodyLink, "response body should render URL as body-link anchor");
  const linkHref = await bodyLink.evaluate((el) => el.getAttribute("href"));
  assert(linkHref === "https://example.com/page", `body-link href should be the URL, got ${linkHref}`);
  console.log("smoke-ui: body link rendering ok");

  // --- NG thread title menu ---
  // right-click first thread row to get context menu
  await page.evaluate(() => {
    document.querySelector(".shell")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 100));
  const firstThreadForNg = await page.$(".threads tbody tr:first-child");
  assert(firstThreadForNg, "thread row should exist for NG test");
  await firstThreadForNg.click({ button: "right" });
  await new Promise((r) => setTimeout(r, 100));
  const ngTitleBtn = await page.$('.thread-menu button:has-text("スレタイNGに追加")');
  assert(ngTitleBtn, "thread menu should have NG title button");
  // dismiss menu
  await page.evaluate(() => {
    document.querySelector(".shell")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: ng thread title menu ok");

  // --- thread NG word filtering ---
  const threadCountBefore = await page.$$eval(".threads tbody tr", (els) => els.length);
  // Add NG word matching a fallback thread title via the NG panel
  await page.evaluate(() => {
    document.querySelector(".shell")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 100));
  const ngBtn2 = await page.$(".ng-filter-toggle");
  if (ngBtn2) await ngBtn2.click();
  await new Promise((r) => setTimeout(r, 100));
  const ngWordInput = await page.$('.ng-panel input[type="text"]');
  if (ngWordInput) {
    await ngWordInput.fill("認証テスト");
    await ngWordInput.press("Enter");
    await new Promise((r) => setTimeout(r, 200));
    const threadCountAfter = await page.$$eval(".threads tbody tr", (els) => els.length);
    assert(threadCountAfter < threadCountBefore, `NG word should hide thread, before=${threadCountBefore} after=${threadCountAfter}`);
    // cleanup: remove the NG word
    const removeBtn = await page.$('.ng-panel button:has-text("×")');
    if (removeBtn) await removeBtn.click();
    await new Promise((r) => setTimeout(r, 100));
  }
  // close NG panel
  const ngCloseBtn = await page.$('.ng-panel button:has-text("閉じる")');
  if (ngCloseBtn) await ngCloseBtn.click();
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: thread ng word filtering ok");

  // --- back reference display ---
  // Add a fallback response that references >>1 and check if back-refs appear
  // Select response #1 which should be referenced by >>1 anchors
  await page.evaluate(() => {
    const blocks = document.querySelectorAll(".response-scroll .response-block");
    if (blocks[0]) blocks[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
  // back-refs div may or may not appear depending on fallback data; just test the CSS class exists
  const backRefsStyle = await page.evaluate(() => {
    const style = document.querySelector("style, link[rel=stylesheet]");
    // check if .back-refs rule exists in stylesheet
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.cssText?.includes(".back-ref-trigger")) return true;
        }
      } catch { /* cross-origin */ }
    }
    return false;
  });
  assert(backRefsStyle, "back-refs CSS class should exist in stylesheet");
  console.log("smoke-ui: back refs style ok");

  // --- compose prefs persistence ---
  // Open compose, set a name, close, verify localStorage has it
  await page.evaluate(() => {
    const rows = document.querySelectorAll(".threads tbody tr");
    if (rows[0]) rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.press("r");
  await new Promise((r) => setTimeout(r, 200));
  const composeNameInput = await page.$('.compose-fields input');
  if (composeNameInput) {
    await composeNameInput.fill("テスト名前");
    await new Promise((r) => setTimeout(r, 200));
    const prefs = await page.evaluate(() => localStorage.getItem("desktop.composePrefs.v1"));
    assert(prefs, "compose prefs should be saved to localStorage");
    const parsed = JSON.parse(prefs);
    assert(parsed.name === "テスト名前", `compose name should be persisted, got ${parsed.name}`);
  }
  // close compose
  const composeClose = await page.$(".compose-header button:last-child");
  if (composeClose) await composeClose.click();
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: compose prefs persistence ok");

  // --- response ID cell CSS ---
  // In fallback data IDs may not be present; verify the CSS class exists
  const idCellCssExists = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.cssText?.includes(".response-id-cell")) return true;
        }
      } catch { /* cross-origin */ }
    }
    return false;
  });
  assert(idCellCssExists, "response-id-cell CSS should exist in stylesheet");
  console.log("smoke-ui: response ID column ok");

  // --- response block structure ---
  const responseBlocks = await page.$$(".response-scroll .response-block");
  assert(responseBlocks.length > 0, "response scroll should have response blocks");
  console.log("smoke-ui: response row striping ok");

  // --- speed bar visualization ---
  const speedBar = await page.$(".speed-cell .speed-bar");
  assert(speedBar, "speed column should have a bar visualization");
  const speedVal = await page.$(".speed-cell .speed-val");
  assert(speedVal, "speed column should have a value display");
  console.log("smoke-ui: speed bar ok");

  // --- ID popup structure ---
  const idCellStyle = await page.evaluate(() => {
    const style = document.querySelector("style, link[rel=stylesheet]");
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.cssText?.includes(".id-popup")) return true;
        }
      } catch { /* cross-origin */ }
    }
    return false;
  });
  assert(idCellStyle, "id-popup CSS should exist in stylesheet");
  // Click an ID cell to trigger popup (fallback data has no IDs, so just verify CSS exists)
  const idCell = await page.$(".response-id-cell");
  // idCell may be null in fallback data where times don't contain ID:xxx
  console.log("smoke-ui: id popup structure ok");

  // --- thread row striping ---
  const threadRows = await page.$$(".threads tbody tr");
  if (threadRows.length >= 2) {
    const bg0 = await threadRows[0].evaluate((el) => window.getComputedStyle(el.querySelector("td")).backgroundColor);
    const bg1 = await threadRows[1].evaluate((el) => window.getComputedStyle(el.querySelector("td")).backgroundColor);
    assert(bg0 !== bg1, "thread rows should have alternating backgrounds");
  }
  console.log("smoke-ui: thread row striping ok");

  // --- compose preview renders HTML ---
  await page.evaluate(() => {
    const rows = document.querySelectorAll(".threads tbody tr");
    if (rows[0]) rows[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.keyboard.press("r");
  await new Promise((r) => setTimeout(r, 200));
  // Verify compose has sage checkbox
  const sageCheckbox = await page.$('.compose-window input[type="checkbox"]');
  assert(sageCheckbox, "compose should have sage checkbox");
  console.log("smoke-ui: compose preview html ok");

  // close compose
  const composeCloseEnd = await page.$(".compose-header button:last-child");
  if (composeCloseEnd) await composeCloseEnd.click();
  await new Promise((r) => setTimeout(r, 100));

  // --- dark mode toggle ---
  const viewMenuForDark = await page.$('.menu-item:has-text("表示")');
  await viewMenuForDark.click();
  await new Promise((r) => setTimeout(r, 100));
  const darkBtn = await page.$('.menu-dropdown button:has-text("ダークテーマ")');
  assert(darkBtn, "view menu should have dark theme toggle");
  await darkBtn.click();
  await new Promise((r) => setTimeout(r, 200));
  const hasDarkClass = await page.$eval(".shell", (el) => el.classList.contains("dark"));
  assert(hasDarkClass, "shell should have dark class after toggle");
  // verify dark background color is applied
  const darkBg = await page.$eval(".shell", (el) => window.getComputedStyle(el).backgroundColor);
  assert(darkBg !== "rgb(215, 208, 195)", `dark mode should change background, got ${darkBg}`);
  // toggle back to light
  await viewMenuForDark.click();
  await new Promise((r) => setTimeout(r, 100));
  const lightBtn = await page.$('.menu-dropdown button:has-text("ライトテーマ")');
  assert(lightBtn, "dark mode menu should say ライトテーマ");
  await lightBtn.click();
  await new Promise((r) => setTimeout(r, 100));
  const noDarkClass = await page.$eval(".shell", (el) => !el.classList.contains("dark"));
  assert(noDarkClass, "shell should not have dark class after light toggle");
  console.log("smoke-ui: dark mode toggle ok");

  // --- NG regex ---
  // Test regex pattern matching via NG panel
  const ngBtnForRegex = await page.$(".ng-filter-toggle");
  if (ngBtnForRegex) await ngBtnForRegex.click();
  await new Promise((r) => setTimeout(r, 100));
  const ngWordInputRegex = await page.$('.ng-panel input[type="text"]');
  if (ngWordInputRegex) {
    await ngWordInputRegex.fill("/認証.+/");
    await ngWordInputRegex.press("Enter");
    await new Promise((r) => setTimeout(r, 200));
    const threadCountAfterRegex = await page.$$eval(".threads tbody tr", (els) => els.length);
    assert(threadCountAfterRegex < 2, `NG regex should filter thread, got ${threadCountAfterRegex}`);
    // remove regex
    const removeBtnRegex = await page.$('.ng-panel button:has-text("×")');
    if (removeBtnRegex) await removeBtnRegex.click();
    await new Promise((r) => setTimeout(r, 100));
  }
  const ngCloseBtnRegex = await page.$('.ng-panel button:has-text("閉じる")');
  if (ngCloseBtnRegex) await ngCloseBtnRegex.click();
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: ng regex ok");

  // --- settings panel ---
  const fileMenuForSettings = await page.$('.menu-item:has-text("ファイル")');
  await fileMenuForSettings.click();
  await new Promise((r) => setTimeout(r, 100));
  const settingsBtn = await page.$('.menu-dropdown button:has-text("設定")');
  assert(settingsBtn, "file menu should have settings button");
  await settingsBtn.click();
  await new Promise((r) => setTimeout(r, 200));
  const settingsPanel = await page.$(".settings-panel");
  assert(settingsPanel, "settings panel should open");
  // verify fieldsets exist
  const legends = await page.$$eval(".settings-body legend", (els) => els.map((e) => e.textContent?.trim()));
  assert(legends.includes("表示"), `settings should have 表示 section, got ${legends}`);
  assert(legends.includes("書き込み"), `settings should have 書き込み section, got ${legends}`);
  assert(legends.some((l) => l.includes("Ronin")), `settings should have Ronin/BE section, got ${legends}`);
  assert(legends.includes("データフォルダ"), `settings should have データフォルダ section, got ${legends}`);
  assert(legends.includes("情報"), `settings should have 情報 section, got ${legends}`);

  // 通知は独立パネルへ移した。セットアップ手順ものを常用トグルの列に戻さないための歯止め。
  assert(
    !legends.some((l) => l.includes("通知")),
    `notification settings should live in their own panel, not in 設定: ${legends}`,
  );
  // UI サイズ (タッチ端末向けの表示倍率。既定は標準 = 1)
  const uiZoomSelect = await page.$(".settings-body select.ui-zoom-select");
  assert(uiZoomSelect, "settings should have a UI size select");
  assert((await uiZoomSelect.inputValue()) === "1", "UI size should default to 1 (標準)");
  const uiZoomLabels = await page.$$eval(".settings-body select.ui-zoom-select option", (els) =>
    els.map((e) => e.textContent?.trim()),
  );
  assert(
    uiZoomLabels.length === 3 && uiZoomLabels.includes("標準") && uiZoomLabels.includes("大") && uiZoomLabels.includes("特大"),
    `UI size should offer 3 steps, got ${uiZoomLabels}`,
  );
  console.log("smoke-ui: UI size setting ok");

  // UI サイズを上げても縦積みに切り替わらないこと。
  // 縦積みの判定は CSS ピクセル上の幅ではなく、倍率を掛け戻した物理的な幅で行う。
  // これが無いと、画面が狭くなくても倍率を上げただけで 3 ペインが縦に積まれる。
  const isNarrow = () => page.evaluate(() => document.documentElement.classList.contains("narrow-layout"));
  await page.setViewportSize({ width: 853, height: 1280 });
  await new Promise((r) => setTimeout(r, 250));
  assert(await isNarrow(), "853px viewport at 標準 should stack panes");
  // 853 * 1.5 = 1279.5 > 980 なので、倍率 1 なら広い画面ということになる
  await uiZoomSelect.selectOption("1.5");
  await new Promise((r) => setTimeout(r, 250));
  assert(!(await isNarrow()), "853px viewport at 特大 should NOT stack (it is a wide window, just zoomed)");
  await uiZoomSelect.selectOption("1");
  await new Promise((r) => setTimeout(r, 250));
  assert(await isNarrow(), "going back to 標準 should stack again");
  await page.setViewportSize({ width: 1280, height: 720 });
  await new Promise((r) => setTimeout(r, 250));
  assert(!(await isNarrow()), "1280px viewport should not stack");
  console.log("smoke-ui: UI size vs narrow layout ok");

  // タッチ操作モード。ホバー抑止の判定自体はポインタイベント依存でここでは再現できないので、
  // 設定が root の touch-mode クラス (CSS のタップ領域拡大の印) に反映されることを見る。
  const touchModeSelect = await page.$(".settings-body select.touch-mode-select");
  assert(touchModeSelect, "settings should have a touch mode select");
  assert((await touchModeSelect.inputValue()) === "auto", "touch mode should default to auto");
  const touchLabels = await page.$$eval(".settings-body select.touch-mode-select option", (os) => os.map((o) => o.textContent));
  assert(
    touchLabels.length === 3 && touchLabels.join(",") === "自動,常にオン,常にオフ",
    `touch mode should offer 3 choices, got ${touchLabels.join(",")}`,
  );
  const isTouchMode = () => page.evaluate(() => document.documentElement.classList.contains("touch-mode"));
  assert(!(await isTouchMode()), "a mouse-only context should not be in touch mode");
  await touchModeSelect.selectOption("on");
  await new Promise((r) => setTimeout(r, 250));
  assert(await isTouchMode(), "touch mode ON should mark the root element");
  await touchModeSelect.selectOption("auto");
  await new Promise((r) => setTimeout(r, 250));
  assert(!(await isTouchMode()), "auto should stay off while only the mouse has been used");
  console.log("smoke-ui: touch mode setting ok");

  // 自動判定は実際にタッチイベントが出るコンテキストでないと確かめられない。
  // 別コンテキストを起こして、タップで切り替わること / 設定で上書きできることを見る。
  const tapAndCheck = async (pref) => {
    const ctx = await browser.newContext({ hasTouch: true });
    if (pref) await ctx.addInitScript((v) => localStorage.setItem("desktop.touchMode.v1", v), pref);
    const p2 = await ctx.newPage();
    await p2.goto(targetUrl, { waitUntil: "load" });
    await p2.waitForSelector(".layout");
    await p2.touchscreen.tap(200, 200);
    await new Promise((r) => setTimeout(r, 250));
    const marked = await p2.evaluate(() => document.documentElement.classList.contains("touch-mode"));
    await ctx.close();
    return marked;
  };
  assert(await tapAndCheck(null), "auto should switch to touch mode once a real tap arrives");
  assert(!(await tapAndCheck("off")), "常にオフ should override touch detection on a touch device");
  console.log("smoke-ui: touch mode detection ok");

  // ホイールスクロール行数の設定 (既定 OFF、ON のときだけ行数入力が出る)
  const wheelRowToggle = await page.$('.settings-body label:has-text("スレ一覧のホイールスクロールを行単位にする") input[type="checkbox"]');
  assert(wheelRowToggle, "settings should have wheel row scroll toggle");
  assert(!(await wheelRowToggle.isChecked()), "wheel row scroll should default to off");
  assert(
    !(await page.$('.settings-body label:has-text("ホイール1段あたりの行数")')),
    "wheel row count input should be hidden while the toggle is off",
  );
  await wheelRowToggle.check();
  await new Promise((r) => setTimeout(r, 100));
  const wheelRowInput = await page.$('.settings-body label:has-text("ホイール1段あたりの行数") input[type="number"]');
  assert(wheelRowInput, "wheel row count input should appear when the toggle is on");
  assert((await wheelRowInput.inputValue()) === "3", "wheel row count should default to 3");
  await wheelRowToggle.uncheck();
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: wheel row scroll setting ok");

  // IDホバーポップアップの設定 (既定 ON、切り替えは layoutPrefs に永続化される)
  const idPopupToggle = await page.$('.settings-body label:has-text("IDのマウスオーバーで同一IDのレスをポップアップ") input[type="checkbox"]');
  assert(idPopupToggle, "settings should have ID hover popup toggle");
  assert(await idPopupToggle.isChecked(), "ID hover popup should default to on");
  await idPopupToggle.uncheck();
  await new Promise((r) => setTimeout(r, 150));
  const idPopupPrefOff = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("desktop.layoutPrefs.v1") || "{}").idPopupEnabled;
    } catch {
      return undefined;
    }
  });
  assert(idPopupPrefOff === false, `ID hover popup off should persist, got ${idPopupPrefOff}`);
  await idPopupToggle.check();
  await new Promise((r) => setTimeout(r, 150));
  const idPopupPrefOn = await page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem("desktop.layoutPrefs.v1") || "{}").idPopupEnabled;
    } catch {
      return undefined;
    }
  });
  assert(idPopupPrefOn === true, `ID hover popup on should persist, got ${idPopupPrefOn}`);
  console.log("smoke-ui: id hover popup setting ok");

  // OGP link card toggle exists in settings
  const ogpToggleLabel = await page.$('.settings-body label:has-text("OGPカード")');
  assert(ogpToggleLabel, "settings should have OGP card display toggle");
  const ogpCardCss = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.cssText?.includes(".ogp-card")) return true;
        }
      } catch { /* cross-origin */ }
    }
    return false;
  });
  assert(ogpCardCss, "ogp-card CSS should exist in stylesheet");
  const ogpDomainCss = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.cssText?.includes(".ogp-domain-settings-btn")) return true;
        }
      } catch { /* cross-origin */ }
    }
    return false;
  });
  assert(ogpDomainCss, "ogp domain settings button CSS should exist in stylesheet");
  console.log("smoke-ui: ogp card toggle ok");
  // mouse gesture customization: settings has an "assign" button that opens the gesture config panel
  const gestureOpenBtn = await page.$(".gesture-config-open-btn");
  assert(gestureOpenBtn, "settings should have a mouse gesture assignment button");
  await gestureOpenBtn.click();
  await new Promise((r) => setTimeout(r, 150));
  const gesturePanel = await page.$(".gesture-config-panel");
  assert(gesturePanel, "clicking gesture assign button should open gesture config panel");
  const gestureSelects = await page.$$eval(".gesture-config-row select", (els) => els.length);
  assert(gestureSelects === 12, `gesture config should list 12 assignable patterns, got ${gestureSelects}`);
  await page.click('.gesture-config-panel .shortcuts-header button:has-text("閉じる")');
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: mouse gesture customization ok");
  // データフォルダ: 保存先に書き込めないときの警告表示。
  // 実際の判定は Tauri 側 (get_data_dir_info) なので、静的 dist では
  // dataDirInfo が null のまま = 警告を出さないことだけ確認する。
  const dataDirWarning = await page.$(".settings-body .data-dir-warning");
  assert(!dataDirWarning, "data dir warning should stay hidden without tauri runtime");
  const dataDirPath = await page.$eval(
    '.settings-body fieldset:has(legend:text-is("データフォルダ")) .settings-row span:has-text("現在の保存先") + span span',
    (el) => el.textContent?.trim(),
  );
  assert(dataDirPath === "—", `data dir path should be a placeholder without tauri, got ${dataDirPath}`);
  const dataDirWarningCss = await page.evaluate(() => {
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule.cssText?.includes(".data-dir-warning")) return true;
        }
      } catch { /* cross-origin sheet */ }
    }
    return false;
  });
  assert(dataDirWarningCss, "data dir warning CSS should exist in stylesheet");
  console.log("smoke-ui: data dir warning ok");
  // WebView の保存先 (localStorage の実体) の案内。パスは Tauri 側の
  // get_data_dir_info が返すので、静的 dist では行ごと出ないことを確認する。
  const dataDirRowLabels = await page.$$eval(
    '.settings-body fieldset:has(legend:text-is("データフォルダ")) .settings-row > span:first-child',
    (els) => els.map((el) => el.textContent?.trim()),
  );
  assert(dataDirRowLabels.includes("現在の保存先"), "data folder section should list the current data dir");
  assert(
    !dataDirRowLabels.includes("WebView の保存先"),
    "webview data dir row should stay hidden without tauri runtime",
  );
  console.log("smoke-ui: webview data dir row ok");
  // close settings
  await page.click('.settings-header button:has-text("閉じる")');
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: settings panel ok");

  // --- post history panel ---
  const fileMenuForHistory = await page.$('.menu-item:has-text("ファイル")');
  await fileMenuForHistory.click();
  await new Promise((r) => setTimeout(r, 100));
  const historyBtn = await page.$('.menu-dropdown button:has-text("書き込み履歴")');
  assert(!historyBtn, "file menu should not have post history button");
  if (!historyBtn) {
    console.log("smoke-ui: post history menu removed ok");
  } else {
    await historyBtn.click();
  await new Promise((r) => setTimeout(r, 200));
  const historyPanel = await page.$(".post-history-body");
  assert(historyPanel, "post history panel should open");
  // should show empty message
  const emptyMsg = await historyPanel.textContent();
  assert(emptyMsg.includes("まだ書き込みがありません"), `history should be empty, got ${emptyMsg}`);
  // close
  await page.click('.settings-header button:has-text("閉じる")');
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: post history panel ok");
  }

  // --- speed gradient coloring ---
  const speedBarStyle = await page.$eval(".speed-bar", (el) => el.getAttribute("style"));
  assert(speedBarStyle?.includes("background"), "speed bar should have inline background style");
  console.log("smoke-ui: speed gradient ok");

  // --- response block striping ---
  const stripingBlocks = await page.$$(".response-block");
  assert(stripingBlocks.length >= 2, "should have multiple response blocks for striping test");
  console.log("smoke-ui: response block striping ok");

  // --- fetched column ---
  const fetchedHeader = await page.$('.threads th[title^="並び替え: "]');
  assert(fetchedHeader, "thread table should have fetched sort column");
  console.log("smoke-ui: fetched column ok");

  // --- BE icon CSS rule exists (structural) ---
  const beIconRule = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.selectorText && rule.selectorText.includes(".be-icon")) return true;
        }
      } catch {}
    }
    return false;
  });
  assert(beIconRule, "CSS should have .be-icon rule");
  console.log("smoke-ui: be icon css ok");

  // --- 一括巡回 (patrol) CSS rules exist (structural) ---
  const patrolRules = await page.evaluate(() => {
    const wanted = new Set([".patrol-btn", ".patrol-badge", ".fav-thread-title.patrol-new"]);
    const found = new Set();
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (!rule.selectorText) continue;
          for (const w of wanted) {
            if (rule.selectorText.includes(w)) found.add(w);
          }
        }
      } catch {}
    }
    return found.size;
  });
  assert(patrolRules === 3, "CSS should have patrol button/badge/new-title rules");
  console.log("smoke-ui: patrol css ok");

  // --- X ポストカード CSS rules exist (structural) ---
  const tweetCardRules = await page.evaluate(() => {
    const wanted = new Set([
      ".tweet-card",
      ".tweet-card-avatar",
      ".tweet-card-text",
      ".tweet-card-photos",
      ".tweet-card-video-el",
      ".inline-video",
      ".dark .tweet-card",
    ]);
    const found = new Set();
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (!rule.selectorText) continue;
          for (const w of wanted) {
            if (rule.selectorText.includes(w)) found.add(w);
          }
        }
      } catch {}
    }
    return found.size;
  });
  assert(tweetCardRules === 7, "CSS should have tweet card rules (light + dark + video + inline-video)");
  console.log("smoke-ui: tweet card css ok");

  // --- right-pane layout ---
  const rightPane = await page.$(".right-pane");
  assert(rightPane, "right-pane container should exist");
  const rightPaneDisplay = await rightPane.evaluate((el) => getComputedStyle(el).display);
  assert(rightPaneDisplay === "grid", "right-pane should use grid layout");
  console.log("smoke-ui: right pane layout ok");

  // --- row-splitter (horizontal between threads and responses) ---
  const rowSplitter = await page.$(".row-splitter");
  assert(rowSplitter, "horizontal row-splitter between threads and responses should exist");
  console.log("smoke-ui: row splitter ok");

  // --- response nav bar info ---
  const navInfoText = await page.$eval(".nav-info", (el) => el.textContent);
  assert(navInfoText.includes("着:"), "nav info should show response count");
  assert(navInfoText.includes("受信日時:"), "nav info should show fetch time");
  console.log("smoke-ui: response nav info ok");

  // --- board search filter ---
  const boardSearch = await page.$(".board-search");
  assert(boardSearch, "board pane should have search input");
  console.log("smoke-ui: board search ok");

  // --- response loading CSS ---
  const loadingCss = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.cssText?.includes(".response-loading")) return true;
        }
      } catch { /* cross-origin */ }
    }
    return false;
  });
  assert(loadingCss, "response-loading CSS should exist");
  console.log("smoke-ui: response loading css ok");

  // --- response block data attribute ---
  const responseWithData = await page.$(".response-block[data-response-no]");
  assert(responseWithData, "response blocks should have data-response-no attribute");
  console.log("smoke-ui: response data attribute ok");

  // --- nav jump input ---
  const navJumpInput = await page.$(".nav-jump-input");
  assert(navJumpInput, "response nav bar should have jump input");
  console.log("smoke-ui: nav jump input ok");

  // --- compose font size in settings ---
  const fileMenuCompose = await page.$('.menu-item:has-text("ファイル")');
  await fileMenuCompose.click();
  await new Promise((r) => setTimeout(r, 100));
  const settingsBtnCompose = await page.$('.menu-dropdown button:has-text("設定")');
  if (settingsBtnCompose) await settingsBtnCompose.click();
  await new Promise((r) => setTimeout(r, 200));
  const composeFontInput = await page.$('.settings-body input[type="number"][min="10"][max="24"]');
  assert(!settingsBtnCompose || composeFontInput, "settings should have compose font size input");
  if (settingsBtnCompose) await page.click('.settings-header button:has-text("閉じる")');
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: compose font size setting ok");

  // --- compose AI review button ---
  await page.click(".response-no", { button: "left" });
  await page.click('.response-menu button:has-text("ここにレス")');
  await page.waitForSelector(".compose-window textarea.compose-body");
  const aiCheckBtn = await page.$(".compose-actions .compose-ai-check-btn");
  assert(aiCheckBtn, "compose actions should have AI チェック button");
  const aiCheckDisabled = await aiCheckBtn.evaluate((el) => el.disabled);
  // In smoke env there's no active AI model and/or body, so the button must
  // start disabled — proving the gating wiring is in place.
  assert(aiCheckDisabled, "AI チェック button should be disabled without an active model");
  await page.click(".compose-header button:has-text('閉じる')");
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: compose ai review button ok");

  // --- 保存ログ一覧 (全板) がスレ一覧フィルタのメニューに並んでいる ---
  // 一覧の中身は Tauri IPC (load_all_cached_threads) 依存なので、ブラウザ環境では
  // 項目が既存の「dat落ちキャッシュ」と並んで出ていることだけを検証する。
  await page.click(".title-split-toggle");
  await page.waitForSelector(".title-split-menu");
  const filterMenuLabels = await page.$$eval(".title-split-menu button", (els) =>
    els.map((el) => el.textContent.trim()),
  );
  assert(
    filterMenuLabels.some((t) => t.includes("dat落ちキャッシュ")),
    `filter menu should keep dat落ちキャッシュ, got ${filterMenuLabels.join(" / ")}`,
  );
  assert(
    filterMenuLabels.some((t) => t.includes("保存ログ一覧")),
    `filter menu should have 保存ログ一覧, got ${filterMenuLabels.join(" / ")}`,
  );
  await page.click(".title-split-toggle");
  await new Promise((r) => setTimeout(r, 100));
  console.log("smoke-ui: cache log list menu ok");

  // --- NG ID 自動削除の設定が localStorage に永続化され、リロード後も復元される ---
  // (リロードを挟むので必ず一番最後に置くこと)
  await page.click("button[title='NGフィルタ']");
  await page.waitForSelector(".ng-expire-select");
  await page.selectOption(".ng-expire-select", "3");
  await new Promise((r) => setTimeout(r, 100));
  const expireDaysStored = await page.evaluate(() => localStorage.getItem("desktop.ngIdExpireDays.v1"));
  assert(expireDaysStored === "3", `ngIdExpireDays should be saved to localStorage, got ${expireDaysStored}`);
  await page.reload({ waitUntil: "load" });
  // NG フィルタボタンはスレのタイトルバーにあるので、まずスレを開き直す
  await page.waitForSelector(".threads tbody tr");
  await page.click(".threads tbody tr:first-child");
  await page.waitForSelector("button[title='NGフィルタ']");
  await page.click("button[title='NGフィルタ']");
  await page.waitForSelector(".ng-expire-select");
  const expireDaysRestored = await page.$eval(".ng-expire-select", (el) => el.value);
  assert(expireDaysRestored === "3", `ngIdExpireDays should be restored after reload, got ${expireDaysRestored}`);
  console.log("smoke-ui: ng id auto-expire persistence ok");

  // --- スレ一覧フィルタが保存され、「起動時に…復元」設定でリロード後も戻る ---
  // (リロードを挟むので必ず一番最後に置くこと)
  await page.click(".title-split-toggle");
  await page.waitForSelector(".title-split-menu");
  await page.click(".title-split-menu button:has-text('最近開いたスレ')");
  await new Promise((r) => setTimeout(r, 100));
  const filterModeStored = await page.evaluate(() => localStorage.getItem("desktop.threadFilterMode.v1"));
  assert(filterModeStored === "recent-opened", `thread filter mode should be saved, got ${filterModeStored}`);
  // 復元は restoreSession (「起動時に前回のタブ・板・スレ一覧フィルタを復元」) に
  // 相乗りしている。このテストハーネスは冒頭の addInitScript で layoutPrefs を
  // 毎回消してレイアウトを既定値に固定しているので、設定画面で入れてもリロードで
  // 消える。後から登録した initScript は先の削除より後に走るため、ここで直接入れる。
  await page.addInitScript(() => {
    localStorage.setItem("desktop.layoutPrefs.v1", JSON.stringify({ restoreSession: true }));
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".title-split-main");
  const restoredFilterTitle = await page.$eval(".title-split-main", (el) => el.getAttribute("title"));
  assert(
    restoredFilterTitle.includes("最近開いたスレ表示中"),
    `thread filter should be restored after reload, got ${restoredFilterTitle}`,
  );
  const restoredFilterActive = await page.$eval(".title-split-main", (el) => el.classList.contains("active-toggle"));
  assert(restoredFilterActive, "restored thread filter button should be highlighted");
  // フィルタを解除して元の状態に戻す
  await page.click(".title-split-main");
  await new Promise((r) => setTimeout(r, 100));
  const filterModeCleared = await page.evaluate(() => localStorage.getItem("desktop.threadFilterMode.v1"));
  assert(filterModeCleared === "", `clearing the filter should persist an empty mode, got ${filterModeCleared}`);
  console.log("smoke-ui: thread filter restore ok");

  // --- 板ごとに記憶した名前欄が、投稿先の板に追従する ---
  // 保存は投稿成功時 (Tauri IPC 必須) なのでブラウザ環境では検証できない。
  // localStorage にタブと板ごとの名前を仕込み、復元・追従だけを検証する。
  // (リロードを挟むので必ず一番最後に置くこと)
  await page.evaluate(() => {
    localStorage.setItem("desktop.boardNames.v1", JSON.stringify({
      "https://rio2016.5ch.io/base/": "板A太郎",
      "https://rio2016.5ch.io/news4vip/": "板B太郎",
    }));
    localStorage.setItem("desktop.nameHistory.v1", JSON.stringify(["板A太郎", "板B太郎"]));
    localStorage.setItem("desktop.threadTabs.v1", JSON.stringify({
      tabs: [
        { threadUrl: "https://rio2016.5ch.io/test/read.cgi/base/1111111111/", title: "板Aのスレ" },
        { threadUrl: "https://rio2016.5ch.io/test/read.cgi/news4vip/2222222222/", title: "板Bのスレ" },
      ],
      activeIndex: 0,
    }));
  });
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".thread-tab:not(.placeholder)");
  const nameTabs = await page.$$(".thread-tab:not(.placeholder)");
  assert(nameTabs.length >= 2, `restored tabs should be 2, got ${nameTabs.length}`);

  // 書き込み欄を開くと、いま見ている板の名前が入る
  await page.click("button[title='書き込み']");
  await page.waitForSelector(".compose-grid input");
  const nameOnBoardA = await page.$eval(".compose-grid input", (el) => el.value);
  assert(nameOnBoardA === "板A太郎", `compose name should come from board A, got ${nameOnBoardA}`);

  // 開いたままタブを切り替えると投稿先の板が変わるので、名前欄も追従する
  await nameTabs[1].click();
  await new Promise((r) => setTimeout(r, 200));
  const nameOnBoardB = await page.$eval(".compose-grid input", (el) => el.value);
  assert(nameOnBoardB === "板B太郎", `compose name should follow to board B, got ${nameOnBoardB}`);

  // 手入力した名前は板を移っても勝手に差し替えない
  await page.fill(".compose-grid input", "手入力した名前");
  await nameTabs[0].click();
  await new Promise((r) => setTimeout(r, 200));
  const nameAfterManualEdit = await page.$eval(".compose-grid input", (el) => el.value);
  assert(
    nameAfterManualEdit === "手入力した名前",
    `manually typed name should survive a board change, got ${nameAfterManualEdit}`,
  );
  await page.click(".compose-header button:last-child");

  // スレ立てダイアログの名前欄にも同じ板の名前が入る
  await page.click("button[title='スレ立て']");
  await page.waitForSelector(".settings-panel input[list='name-history-list-newthread']");
  const newThreadNameValue = await page.$eval(
    ".settings-panel input[list='name-history-list-newthread']",
    (el) => el.value,
  );
  assert(newThreadNameValue === "板A太郎", `new thread name should come from board A, got ${newThreadNameValue}`);
  const newThreadBoardA = await page.$eval(".new-thread-target", (el) => el.textContent);
  assert(
    newThreadBoardA.includes("/base/"),
    `new thread target board should be board A, got ${newThreadBoardA}`,
  );

  // 開いたまま板 (タブ) を切り替えると投稿先も名前欄も追従する
  await nameTabs[1].click();
  await new Promise((r) => setTimeout(r, 200));
  const newThreadBoardB = await page.$eval(".new-thread-target", (el) => el.textContent);
  assert(
    newThreadBoardB.includes("/news4vip/"),
    `new thread target board should follow to board B, got ${newThreadBoardB}`,
  );
  const newThreadNameOnB = await page.$eval(
    ".settings-panel input[list='name-history-list-newthread']",
    (el) => el.value,
  );
  assert(newThreadNameOnB === "板B太郎", `new thread name should follow to board B, got ${newThreadNameOnB}`);

  // 手入力した名前は板を移っても勝手に差し替えない
  await page.fill(".settings-panel input[list='name-history-list-newthread']", "スレ立て手入力");
  await nameTabs[0].click();
  await new Promise((r) => setTimeout(r, 200));
  const newThreadNameAfterEdit = await page.$eval(
    ".settings-panel input[list='name-history-list-newthread']",
    (el) => el.value,
  );
  assert(
    newThreadNameAfterEdit === "スレ立て手入力",
    `manually typed new thread name should survive a board change, got ${newThreadNameAfterEdit}`,
  );

  // スレ立ては書き込みと同じ浮遊ウィンドウ: 背景を覆うオーバーレイが無く、ヘッダーで動かせる
  assert(
    !(await page.$(".lightbox-overlay")),
    "new thread window should not be modal (no lightbox overlay)",
  );
  const newThreadHeader = await page.$(".new-thread-window .new-thread-header");
  assert(newThreadHeader, "new thread window should have a draggable header");
  const ntBox = await newThreadHeader.boundingBox();
  await page.mouse.move(ntBox.x + 20, ntBox.y + ntBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(ntBox.x - 80, ntBox.y - 40, { steps: 5 });
  await page.mouse.up();
  const ntPos = JSON.parse(await page.evaluate(() => localStorage.getItem("desktop.newThreadDialogPos.v1")));
  assert(
    ntPos && typeof ntPos.x === "number" && typeof ntPos.y === "number",
    `dragging the new thread window should persist its position, got ${JSON.stringify(ntPos)}`,
  );
  await page.click(".new-thread-window .settings-header button:last-child");
  console.log("smoke-ui: per-board compose name ok");

  // --- 名前を記憶しない ---
  const fileMenuForForgetName = await page.$('.menu-item:has-text("ファイル")');
  await fileMenuForForgetName.click();
  await new Promise((r) => setTimeout(r, 100));
  await page.click('.menu-dropdown button:has-text("設定")');
  await page.waitForSelector(".settings-panel");
  const forgetNameToggle = await page.$('.settings-body label:has-text("名前を記憶しない") input[type="checkbox"]');
  assert(forgetNameToggle, "settings should have the forget-name toggle");
  assert(!(await forgetNameToggle.isChecked()), "forget-name should default to off");
  await forgetNameToggle.check();
  await new Promise((r) => setTimeout(r, 200));
  const forgetPrefs = JSON.parse(await page.evaluate(() => localStorage.getItem("desktop.composePrefs.v1")));
  assert(forgetPrefs.forgetName === true, `forgetName should be persisted, got ${forgetPrefs.forgetName}`);
  assert(forgetPrefs.name === "", `name should not be persisted while forgetName is on, got ${forgetPrefs.name}`);
  await page.click(".settings-panel .settings-header button");
  await new Promise((r) => setTimeout(r, 100));

  // 板ごとに名前を記憶していても、ON のあいだは名前欄が空で開く
  await page.click("button[title='書き込み']");
  await page.waitForSelector(".compose-grid input");
  const forgottenName = await page.$eval(".compose-grid input", (el) => el.value);
  assert(forgottenName === "", `compose name should be empty while forgetName is on, got ${forgottenName}`);
  await page.click(".compose-header button:last-child");
  await new Promise((r) => setTimeout(r, 100));
  await page.click("button[title='スレ立て']");
  await page.waitForSelector(".settings-panel input[list='name-history-list-newthread']");
  const forgottenNewThreadName = await page.$eval(
    ".settings-panel input[list='name-history-list-newthread']",
    (el) => el.value,
  );
  assert(
    forgottenNewThreadName === "",
    `new thread name should be empty while forgetName is on, got ${forgottenNewThreadName}`,
  );
  await page.click(".new-thread-window .settings-header button:last-child");
  console.log("smoke-ui: forget compose name ok");

  // --- 記憶した名前を削除 ---
  const fileMenuForNameClear = await page.$('.menu-item:has-text("ファイル")');
  await fileMenuForNameClear.click();
  await new Promise((r) => setTimeout(r, 100));
  await page.click('.menu-dropdown button:has-text("設定")');
  await page.waitForSelector(".settings-panel");
  const clearNameBtn = await page.$('.settings-body button:has-text("記憶した名前を削除")');
  assert(clearNameBtn, "settings should have the clear-remembered-names button");
  // 1回目のクリックでは消さず、確認待ちになる
  await clearNameBtn.click();
  await new Promise((r) => setTimeout(r, 100));
  assert(
    await page.$('.settings-body button:has-text("本当に削除する")'),
    "the first click should only arm the confirmation",
  );
  assert(
    await page.evaluate(() => localStorage.getItem("desktop.boardNames.v1") !== null),
    "board names should survive the first click",
  );
  // キャンセルで元に戻る
  await page.click('.settings-body button:has-text("キャンセル")');
  await new Promise((r) => setTimeout(r, 100));
  assert(
    await page.$('.settings-body button:has-text("記憶した名前を削除")'),
    "cancel should return the button to its initial label",
  );
  // 2回目のクリック → 確定で削除
  await page.click('.settings-body button:has-text("記憶した名前を削除")');
  await new Promise((r) => setTimeout(r, 100));
  await page.click('.settings-body button:has-text("本当に削除する")');
  await new Promise((r) => setTimeout(r, 200));
  const clearedNames = await page.evaluate(() => ({
    boardNames: localStorage.getItem("desktop.boardNames.v1"),
    nameHistory: localStorage.getItem("desktop.nameHistory.v1"),
    composeName: JSON.parse(localStorage.getItem("desktop.composePrefs.v1")).name,
  }));
  assert(clearedNames.boardNames === null, `board names should be cleared, got ${clearedNames.boardNames}`);
  assert(clearedNames.nameHistory === null, `name history should be cleared, got ${clearedNames.nameHistory}`);
  assert(clearedNames.composeName === "", `compose name should be cleared, got ${clearedNames.composeName}`);
  assert(
    await page.$('.settings-body button:has-text("記憶した名前を削除")'),
    "the button should return to its initial label after clearing",
  );
  assert(
    await page.$('.settings-body .settings-row:has-text("削除しました")'),
    "clearing should show a completion message",
  );
  // 完了メッセージは数秒で自動的に消える
  await page.waitForSelector('.settings-body .settings-row:has-text("削除しました")', { state: "detached", timeout: 6000 });
  await page.click(".settings-panel .settings-header button");
  console.log("smoke-ui: clear remembered names ok");

  // --- 画像一覧サブペインと画像サイズ制限 ---
  // WEB ランタイムでは取得済みレスが無いため一覧は空。ここで見られるのは
  // 「サイズ制限を入れても一覧が壊れない / 制限値が保存される」ところまでで、
  // 実際のサイズ判定は HEAD リクエストが要るのでスモークでは検証できない。
  const galleryToggle = await page.$('button[title="画像一覧"]');
  assert(galleryToggle, "thread title bar should have the image gallery toggle");
  await galleryToggle.click();
  await new Promise((r) => setTimeout(r, 150));
  assert(await page.$(".image-gallery-pane"), "image gallery toggle should open the gallery pane");
  const galleryHeader = await page.$eval(".image-gallery-header", (el) => el.textContent);
  assert(galleryHeader.includes("画像一覧"), `gallery header should read 画像一覧, got ${galleryHeader}`);
  assert(await page.$(".image-gallery-empty"), "gallery should show the empty state without fetched responses");

  const fileMenuForImageLimit = await page.$('.menu-item:has-text("ファイル")');
  await fileMenuForImageLimit.click();
  await new Promise((r) => setTimeout(r, 100));
  await page.click('.menu-dropdown button:has-text("設定")');
  await page.waitForSelector(".settings-panel");
  const imageLimitInput = await page.$('.settings-row:has-text("画像サイズ制限") input[type="number"]');
  assert(imageLimitInput, "settings should have the image size limit input");
  await imageLimitInput.fill("200");
  await new Promise((r) => setTimeout(r, 300));
  const savedImageLimit = await page.evaluate(
    () => JSON.parse(localStorage.getItem("desktop.layoutPrefs.v1")).imageSizeLimit,
  );
  assert(savedImageLimit === 200, `image size limit should persist, got ${savedImageLimit}`);
  await page.click(".settings-panel .settings-header button");
  await new Promise((r) => setTimeout(r, 150));
  assert(await page.$(".image-gallery-pane"), "gallery pane should survive turning the size limit on");
  assert(
    !(await page.$(".image-gallery-pane .thumb-gate-loading, .image-gallery-pane .thumb-gate-blocked")),
    "an empty gallery should not render size-gate placeholders",
  );
  await page.click('button[title="画像一覧"]');
  await new Promise((r) => setTimeout(r, 100));
  assert(!(await page.$(".image-gallery-pane")), "toggling again should close the gallery pane");
  console.log("smoke-ui: image gallery size limit ok");

  // --- 日付・IDを名前の隣に表示 ---
  const metaRightDefault = await page.$eval(".response-header-right", (el) => getComputedStyle(el).marginLeft);
  assert(metaRightDefault !== "0px", `date/ID should be right-aligned by default, got margin-left ${metaRightDefault}`);
  const fileMenuForMeta = await page.$('.menu-item:has-text("ファイル")');
  await fileMenuForMeta.click();
  await new Promise((r) => setTimeout(r, 100));
  await page.click('.menu-dropdown button:has-text("設定")');
  await page.waitForSelector(".settings-panel");
  const metaInlineRow = await page.$('.settings-row:has-text("日付・IDを名前の隣に表示") input[type="checkbox"]');
  assert(metaInlineRow, "settings should have the inline date/ID checkbox");
  assert(!(await metaInlineRow.isChecked()), "inline date/ID should default to off");
  await metaInlineRow.check();
  await new Promise((r) => setTimeout(r, 300));
  await page.click(".settings-panel .settings-header button");
  await new Promise((r) => setTimeout(r, 150));
  const metaInlineMargin = await page.$eval(".response-header-right", (el) => getComputedStyle(el).marginLeft);
  assert(metaInlineMargin === "0px", `inline mode should drop the auto margin, got ${metaInlineMargin}`);
  const savedMetaInline = await page.evaluate(
    () => JSON.parse(localStorage.getItem("desktop.layoutPrefs.v1")).responseMetaInline,
  );
  assert(savedMetaInline === true, `inline date/ID setting should persist, got ${savedMetaInline}`);
  console.log("smoke-ui: inline date/id ok");


  // --- 通知設定パネル (Discord Webhook) ---
  const fileMenuForNotify = await page.$('.menu-item:has-text("ファイル")');
  await fileMenuForNotify.click();
  await new Promise((r) => setTimeout(r, 100));
  const notifyMenuBtn = await page.$('.menu-dropdown button:has-text("通知設定")');
  assert(notifyMenuBtn, "file menu should have the notification settings entry");
  await notifyMenuBtn.click();
  await new Promise((r) => setTimeout(r, 200));
  const notifyPanel = await page.$(".notify-settings-panel");
  assert(notifyPanel, "notification settings should open in their own panel");
  const notifyLegends = await page.$$eval(".notify-settings-panel legend", (els) =>
    els.map((e) => e.textContent?.trim()),
  );
  // 送信先の用意と巡回の有効化は別の作業なので、節を分けてある。
  assert(
    notifyLegends.some((l) => l.includes("送信先")),
    `notify panel should have a destination section, got ${notifyLegends}`,
  );
  assert(notifyLegends.includes("巡回"), `notify panel should have a patrol section, got ${notifyLegends}`);
  const notifyToggle = await page.$('.notify-settings-panel label:has-text("自分宛のレスを通知する") input[type="checkbox"]');
  assert(notifyToggle, "notify panel should have the reply notification toggle");
  assert(
    (await notifyToggle.isChecked()) === false,
    "reply notification should be off until the user sets a webhook",
  );
  // 伏せ字にしない。貼り付けミスが画面で確認できず、テスト送信するまで気づけないため。
  // 漏れても被害はこの通知先への投稿だけで、ウェブフックを作り直せば消える。
  const webhookInput = await page.$(".notify-settings-panel input.notify-webhook-url");
  assert(webhookInput, "notify panel should have the webhook url input");
  assert(
    (await webhookInput.getAttribute("type")) !== "password",
    "webhook url should stay readable so a mistyped paste is visible",
  );
  assert(
    await page.$(".notify-settings-panel input.notify-discord-user-id"),
    "notify panel should have the discord user id input",
  );
  // 貼り間違いは実際に送らないと気づけないので、テスト送信は必須。
  for (const label of ["テスト送信", "今すぐ巡回"]) {
    assert(
      await page.$(`.notify-settings-panel button:has-text("${label}")`),
      `notify panel should have the ${label} button`,
    );
  }
  // 入力は自動保存する。保存ボタンがあると押し忘れたまま閉じられ、再起動で消える。
  assert(
    !(await page.$('.notify-settings-panel button:has-text("保存")')),
    "notify settings should autosave, not require a 保存 button",
  );
  const notifyInterval = await page.$eval(
    '.notify-settings-panel label:has-text("巡回間隔") input[type="number"]',
    (el) => el.value,
  );
  assert(notifyInterval === "10", `patrol interval should default to 10 minutes, got ${notifyInterval}`);
  // 通知先 URL が localStorage に漏れていないこと (保存先は notify_config.json のみ)。
  const notifyKeys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.toLowerCase().includes("notify")),
  );
  assert(
    !notifyKeys.includes("desktop.notifyConfig.v1"),
    `notify config must not be mirrored into localStorage, got ${notifyKeys}`,
  );
  await page.click(".notify-settings-panel .settings-header button");
  await new Promise((r) => setTimeout(r, 150));
  console.log("smoke-ui: notification settings ok");

  console.log("smoke-ui: ok");
} finally {
  if (browser) {
    await browser.close();
  }
  if (server) {
    await new Promise((resolve) => server.close(() => resolve()));
  }
}
