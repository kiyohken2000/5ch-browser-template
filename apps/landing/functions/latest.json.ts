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
    const today = new Date().toISOString().slice(0, 10);
    waitUntil(
      (async () => {
        const keys = ["latest:app:total", `latest:app:${today}`];
        for (const key of keys) {
          try {
            const current = parseInt((await env.COUNTER.get(key)) ?? "0", 10);
            await env.COUNTER.put(key, String(current + 1));
          } catch (e) {
            console.warn("kv counter failed", key, e);
          }
        }
      })()
    );
  }

  return next();
};
