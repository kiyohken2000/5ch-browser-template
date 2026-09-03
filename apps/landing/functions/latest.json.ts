interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface Env {
  STATS_DB: D1Database;
}

type PagesFunction<E = unknown> = (ctx: {
  env: E;
  request: Request;
  next: () => Promise<Response>;
  waitUntil: (p: Promise<unknown>) => void;
}) => Response | Promise<Response>;

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  const { env, request, next, waitUntil } = ctx;
  const ua = request.headers.get("user-agent") ?? "";
  const isBrowser = /^Mozilla\//i.test(ua);

  if (env.STATS_DB && !isBrowser) {
    // Workers のタイムゾーンは UTC 固定なので、日本時間 (UTC+9) にずらした
    // 時刻から日付を取る。JST は DST がないため固定オフセットで正確。
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    waitUntil(
      (async () => {
        // 以前は KV で get → +1 → put していたが、(1) 無料枠の write 1,000/日
        // に対して 500/日 を超えた (2) KV は結果整合なので同時起動が重なると
        // 増分が消える、の 2 点から D1 に移した。UPSERT 1 文なのでアトミック。
        try {
          await env.STATS_DB.prepare(
            "INSERT INTO update_checks (date, count) VALUES (?1, 1) " +
              "ON CONFLICT(date) DO UPDATE SET count = count + 1"
          )
            .bind(today)
            .run();
        } catch (e) {
          console.warn("d1 counter failed", today, e);
        }
      })()
    );
  }

  return next();
};
