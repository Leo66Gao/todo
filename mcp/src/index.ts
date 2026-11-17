// A remote MCP server for the Todo app, on Cloudflare Workers.
//
// Claude (or another MCP client) connects with OAuth. This Worker is the
// authorization server: /authorize asks the user to approve the client, then
// sends them to the Todo web app's Connect page, where they are already
// signed in. That page hands this Worker the user's Firebase sign-in, through
// a one-time code (POST /handoff, then back to /callback), and the client is
// issued its tokens. The Firebase sign-in is kept only inside the grant,
// encrypted with a key held by the token's owner. Tools then act as the
// user, under the same Firestore security rules as the apps.
//
// Only the account in ALLOWED_UID can connect.

import { OAuthProvider, AuthorizationError, CimdFetchError, type ConsentDescription, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { idToken, SignInExpired } from "./firestore";
import { createServer } from "./tools";

interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  /** This Worker's own URL, e.g. https://todo-mcp.example.workers.dev */
  PUBLIC_URL: string;
  /** The Todo web app, whose Connect page signs the user in. */
  WEB_APP_ORIGIN: string;
  FIREBASE_PROJECT_ID: string;
  FIRESTORE_DATABASE: string;
  /** Secrets. */
  FIREBASE_API_KEY: string;
  ALLOWED_UID: string;
}

interface Props extends Record<string, unknown> {
  uid: string;
  refreshToken: string;
}

const SCOPE = "todo";
const HANDOFF_SECONDS = 120;

const escape = (value: string) => value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const page = (title: string, body: string, status = 200, headers = new Headers()) => {
  headers.set("Content-Type", "text/html; charset=utf-8");
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(title)}</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; }
  body { max-width: 30rem; margin: 12vh auto; padding: 0 20px; line-height: 1.5; }
  h1 { font-size: 1.4rem; margin-bottom: .5rem; }
  .muted { opacity: .7; font-size: .92rem; }
  ul { padding-left: 1.2rem; }
  button { font: inherit; padding: .6rem 1.2rem; border-radius: 999px; border: 1px solid #8884; cursor: pointer; }
  button[value="approve"] { background: #111; color: #fff; border-color: #111; }
  @media (prefers-color-scheme: dark) { button[value="approve"] { background: #f2f2f2; color: #111; border-color: #f2f2f2; } }
  .warn { padding: .6rem .8rem; border-radius: 10px; background: #f5a62322; }
</style>
${body}`,
    { status, headers },
  );
};

function consentPage(d: ConsentDescription, handle: string) {
  const who = d.clientDomain
    ? `Published by <strong>${escape(d.clientDomain)}</strong>.`
    : "This app registered itself, so its name isn't verified.";
  return `<h1>Let ${escape(d.clientName)} use your Todo?</h1>
<p>${who} Access goes to <strong>${escape(d.redirectHost)}</strong>.</p>
${d.redirectIsLoopback ? '<p class="warn">This sends access to an app on your computer. Continue only if you just started connecting from it.</p>' : ""}
<p>It will be able to:</p>
<ul><li>See your tasks, assignments and subjects</li><li>Move tasks to other days and times, change them, and add new ones</li></ul>
<p class="muted">It can't delete anything. Next, your Todo app asks you to confirm while signed in.</p>
<form method="post">
  <input type="hidden" name="handle" value="${escape(handle)}">
  <p><button name="decision" value="approve">Continue</button> <button name="decision" value="deny">Cancel</button></p>
</form>`;
}

// --- One-time hand-off of the Firebase sign-in from the web app ------------

async function handoffKey(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`handoff:${code}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function handoffId(code: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)));
  return `handoff:${[...digest].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Stores the sign-in, encrypted with the code (only its hash is a KV key), and returns the code. */
async function storeHandoff(env: Env, props: Props): Promise<string> {
  const code = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await handoffKey(code), new TextEncoder().encode(JSON.stringify(props)));
  const stored = btoa(String.fromCharCode(...iv, ...new Uint8Array(sealed)));
  await env.OAUTH_KV.put(await handoffId(code), stored, { expirationTtl: HANDOFF_SECONDS });
  return code;
}

async function takeHandoff(env: Env, code: string): Promise<Props | null> {
  const id = await handoffId(code);
  const stored = await env.OAUTH_KV.get(id);
  if (!stored) return null;
  await env.OAUTH_KV.delete(id);
  const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await handoffKey(code), bytes.slice(12));
  return JSON.parse(new TextDecoder().decode(plain)) as Props;
}

const cors = (env: Env) => ({
  "Access-Control-Allow-Origin": env.WEB_APP_ORIGIN,
  "Access-Control-Allow-Methods": "POST",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
  Vary: "Origin",
});

/** POST /handoff, from the web app's Connect page: { refreshToken } → { code }. */
async function handoff(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors(env) });
  if (request.method !== "POST" || request.headers.get("Origin") !== env.WEB_APP_ORIGIN) return json({ error: "Not allowed" }, 403);
  const { refreshToken } = (await request.json().catch(() => ({}))) as { refreshToken?: unknown };
  if (typeof refreshToken !== "string" || !refreshToken) return json({ error: "Missing sign-in" }, 400);
  try {
    const { uid } = await idToken(env, refreshToken);
    if (uid !== env.ALLOWED_UID) return json({ error: "This connector belongs to another account." }, 403);
    return json({ code: await storeHandoff(env, { uid, refreshToken }) });
  } catch (error) {
    return json({ error: error instanceof SignInExpired ? "Your sign-in has expired; sign in again." : "Could not check your sign-in." }, 401);
  }
}

// --- /authorize and /callback --------------------------------------------

async function authorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  if (request.method === "GET") {
    const authRequest = await oauth.parseAuthRequest(request);
    const details = await oauth.describeConsent(authRequest);
    const consent = await oauth.beginConsent(authRequest);
    return page(`Connect ${details.clientName} to Todo`, consentPage(details, consent.handle), 200, consent.headers);
  }
  const form = await request.formData();
  const handle = String(form.get("handle"));
  if (form.get("decision") !== "approve") {
    const denied = await oauth.denyConsent(request, handle);
    return new Response(null, { status: 302, headers: denied.headers });
  }
  const approved = await oauth.approveConsent(request, handle, { scope: [SCOPE] });
  const { state, headers } = await oauth.beginUpstream(approved.request, { headers: approved.headers });
  const connect = new URL("/connect", env.WEB_APP_ORIGIN);
  connect.searchParams.set("state", state);
  headers.set("Location", connect.toString());
  return new Response(null, { status: 302, headers });
}

async function callback(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER;
  const { request: original, headers } = await oauth.finishUpstream(request);
  const code = new URL(request.url).searchParams.get("code");
  const props = code ? await takeHandoff(env, code) : null;
  if (!props || props.uid !== env.ALLOWED_UID) {
    return page("Couldn't connect", "<h1>Couldn't connect</h1><p>The sign-in from your Todo app expired or didn't match. Start connecting again from Claude.</p>", 400, headers);
  }
  const { redirectTo } = await oauth.completeAuthorization({
    request: original,
    userId: props.uid,
    metadata: { connectedAt: new Date().toISOString() },
    scope: original.scope.length ? original.scope : [SCOPE],
    props,
  });
  headers.set("Location", redirectTo);
  return new Response(null, { status: 302, headers });
}

const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/authorize") return await authorize(request, env);
      if (pathname === "/callback") return await callback(request, env);
      if (pathname === "/handoff") return await handoff(request, env);
      if (pathname === "/") return page("Todo for Claude", "<h1>Todo for Claude</h1><p>An MCP server for the Todo app. Add <code>/mcp</code> on this address as a custom connector in Claude.</p>");
      return new Response("Not found", { status: 404 });
    } catch (error) {
      if (error instanceof AuthorizationError && error.redirectTo) return Response.redirect(error.redirectTo, 302);
      if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
        const message = error instanceof AuthorizationError ? error.description : "This app could not be verified.";
        return page("Couldn't connect", `<h1>Couldn't connect</h1><p>${escape(message ?? "Start connecting again from Claude.")}</p>`, 400);
      }
      throw error;
    }
  },
};

// --- The MCP endpoint -------------------------------------------------------

const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props: Props }): Promise<Response> {
    if (ctx.props.uid !== env.ALLOWED_UID) return new Response("Forbidden", { status: 403 });
    // Stateless: a fresh server and transport per request.
    const server = createServer(env, ctx.props.refreshToken);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};

let provider: { url: string; instance: OAuthProvider<Env> } | null = null;

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (!provider || provider.url !== env.PUBLIC_URL) {
      provider = {
        url: env.PUBLIC_URL,
        instance: new OAuthProvider<Env>({
          apiRoute: "/mcp",
          apiHandler: mcpHandler as never,
          defaultHandler,
          authorizeEndpoint: "/authorize",
          tokenEndpoint: "/oauth/token",
          clientRegistrationEndpoint: "/oauth/register",
          clientIdMetadataDocumentEnabled: true,
          scopesSupported: [SCOPE, "offline_access"],
          requiredScopes: [SCOPE],
          resourceMetadata: { resource: `${env.PUBLIC_URL}/mcp`, authorization_servers: [env.PUBLIC_URL] },
          // A month while unused; every refresh pushes it out again.
          refreshTokenIdleTTL: 30 * 24 * 3600,
        }),
      };
    }
    return provider.instance.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
