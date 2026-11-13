import type { NextRequest } from "next/server";

const RELAYER_URL = process.env.RELAYER_URL ?? "https://relayer.testnet.zama.org";
const RELAYER_API_KEY = process.env.RELAYER_API_KEY;
const REQUEST_ALLOW = new Set(["content-type", "accept", "content-length"]);
const RESPONSE_DROP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
]);
const SAFE_SEGMENT = /^[a-zA-Z0-9._-]+$/;

function forwardHeaders(incoming: Headers): Headers {
  const out = new Headers();
  for (const [key, value] of incoming) {
    const name = key.toLowerCase();
    if (REQUEST_ALLOW.has(name) || name.startsWith("x-zama-sdk-")) out.set(key, value);
  }
  if (RELAYER_API_KEY) out.set("x-api-key", RELAYER_API_KEY);
  return out;
}

async function proxy(req: NextRequest, path: string[]) {
  for (const segment of path) {
    if (!SAFE_SEGMENT.test(segment) || segment === "." || segment === "..") {
      return Response.json({ error: "Invalid path" }, { status: 400 });
    }
  }
  const url = new URL(path.join("/"), `${RELAYER_URL}/`);
  url.search = req.nextUrl.search;
  try {
    const resp = await fetch(url, {
      method: req.method,
      headers: forwardHeaders(req.headers),
      body: req.body,
      signal: AbortSignal.timeout(30_000),
      // @ts-expect-error Node fetch streams the request body when duplex is set.
      duplex: "half",
    });
    const headers = new Headers();
    for (const [key, value] of resp.headers) {
      if (!RESPONSE_DROP.has(key.toLowerCase())) headers.set(key, value);
    }
    return new Response(resp.body, { status: resp.status, headers });
  } catch (err) {
    console.error("[relayer-proxy]", url.toString(), err);
    return Response.json({ error: "Relayer unreachable" }, { status: 503 });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function PUT(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxy(req, (await ctx.params).path);
}
