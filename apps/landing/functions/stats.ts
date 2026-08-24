interface Env {
  COUNTER: KVNamespace;
}

interface KVNamespace {
  get(key: string): Promise<string | null>;
  list(opts: { prefix?: string; limit?: number; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

type PagesFunction<E = unknown> = (ctx: {
  env: E;
}) => Response | Promise<Response>;

const TOTAL_KEY = "latest:app:total";
const DAILY_KEY_RE = /^latest:app:[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.COUNTER) {
    return new Response("counter not configured", { status: 503 });
  }

  const result: Record<string, number> = {};
  let cursor: string | undefined;
  let total = 0;
  do {
    const page = await env.COUNTER.list({ prefix: "latest:", cursor });
    for (const k of page.keys) {
      // 旧・累計キーは latest.json.ts が更新しなくなった (KV write 削減) ので
      // 読まずに捨て、下で日次キーの合算に差し替える。
      if (k.name === TOTAL_KEY) continue;
      const v = await env.COUNTER.get(k.name);
      if (v === null) continue;
      const n = parseInt(v, 10);
      if (!Number.isFinite(n)) continue;
      result[k.name] = n;
      if (DAILY_KEY_RE.test(k.name)) total += n;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  // KV list は辞書順に返るため、日付キー ("latest:app:2026-..") はすべて
  // "latest:app:total" より前に来る。最後に足せば従来と同じ並びの JSON になる。
  result[TOTAL_KEY] = total;

  return new Response(JSON.stringify(result, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
};
