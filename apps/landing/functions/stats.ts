interface D1Result<T> {
  results: T[];
}

interface D1PreparedStatement {
  all<T>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  STATS_DB: D1Database;
}

type PagesFunction<E = unknown> = (ctx: {
  env: E;
}) => Response | Promise<Response>;

const TOTAL_KEY = "latest:app:total";

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.STATS_DB) {
    return new Response("counter not configured", { status: 503 });
  }

  // KV 時代は list + 日数ぶんの get (1 訪問あたり 80 read 超、しかも日数と
  // ともに増える) だったが、D1 では 1 クエリで済む。
  const { results } = await env.STATS_DB.prepare(
    "SELECT date, count FROM update_checks ORDER BY date ASC"
  ).all<{ date: string; count: number }>();

  // レスポンス形状は KV 時代と互換 ("latest:app:<日付>" と累計キー)。
  // ランディング (src/App.tsx) がこのキー形式でパースしている。
  const result: Record<string, number> = {};
  let total = 0;
  for (const row of results) {
    result[`latest:app:${row.date}`] = row.count;
    total += row.count;
  }
  result[TOTAL_KEY] = total;

  return new Response(JSON.stringify(result, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
};
