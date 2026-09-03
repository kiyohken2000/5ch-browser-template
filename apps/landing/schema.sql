-- 更新チェック数 (アプリ起動時の /latest.json 取得) の日次カウンタ。
-- date は JST (UTC+9) の 'YYYY-MM-DD'。Workers は UTC 固定なので、
-- functions/latest.json.ts 側で 9 時間ずらした値を渡している。
CREATE TABLE IF NOT EXISTS update_checks (
  date  TEXT    PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
);
