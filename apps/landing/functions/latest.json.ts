interface Env {
  COUNTER: KVNamespace;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
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

  if (env.COUNTER && !isBrowser) {
    // Workers のタイムゾーンは UTC 固定なので、日本時間 (UTC+9) にずらした
    // 時刻から日付を取る。JST は DST がないため固定オフセットで正確。
    const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    waitUntil(
      (async () => {
        // KV の無料枠は write 1,000/日。以前は日次キーと累計キー
        // ("latest:app:total") の両方を更新していたため更新チェック 1 回で
        // 2 write を消費し、上限の半分に達していた。日次キーのみに絞る。
        // 累計は stats.ts が日次キーを合算して返すので、値としては失われない。
        const key = `latest:app:${today}`;
        try {
          const current = parseInt((await env.COUNTER.get(key)) ?? "0", 10);
          await env.COUNTER.put(key, String(current + 1));
        } catch (e) {
          console.warn("kv counter failed", key, e);
        }
      })()
    );
  }

  return next();
};
