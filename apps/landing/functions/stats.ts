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

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  if (!env.COUNTER) {
    return new Response("counter not configured", { status: 503 });
  }

  const result: Record<string, number> = {};
  let cursor: string | undefined;
  do {
    const page = await env.COUNTER.list({ prefix: "latest:", cursor });
    for (const k of page.keys) {
      const v = await env.COUNTER.get(k.name);
      if (v !== null) result[k.name] = parseInt(v, 10);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  return new Response(JSON.stringify(result, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
};
