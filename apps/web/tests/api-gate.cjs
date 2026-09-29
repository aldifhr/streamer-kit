/**
 * Regression tests for the API proxy gate.
 *
 * These exist because the bug they guard was severe, verified against a running
 * deployment, and invisible to every other test in the repo. The API's own token
 * guard passed: writes without a token were rejected at the backend. What nobody
 * checked was the hop in front of it, where the server attached the token on
 * behalf of whoever asked. An unauthenticated POST there created overlays,
 * rewrote configs and pointed a live stream at a different room.
 *
 * So the rule these lock in is narrow and exact: the token is attached if and
 * only if a valid session is present. Not "the session is checked somewhere" —
 * the ordering is the whole security property, since a check that ran after the
 * attach would be decoration.
 *
 * Runs against a real `next start` with the real middleware, because the failure
 * this file exists for was a build that compiled, deployed, and was open.
 */

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

/**
 * A port nobody is using.
 *
 * A fixed port is a trap: a leftover `next start` from an earlier run answers on
 * it, the test silently exercises the wrong build, and the result reads as a
 * bug in the code under test. That happened here — a stale v15 server answered on
 * the hardcoded port and reported 307 for a gate that returns 401. Asking the OS
 * for a free port removes the whole class of problem.
 */
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = require("node:net").createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

let PORT = Number(process.env.GATE_TEST_PORT || 0);
const PASSWORD = "correct-horse";
const SECRET = "test-secret-0123456789abcdef";
const BACKEND = process.env.GATE_TEST_BACKEND || "http://127.0.0.1:9";

const failures = [];
function check(label, cond, detail = "") {
  if (cond) console.log(`  ok   ${label}`);
  else {
    console.log(`  FAIL ${label} ${detail}`);
    failures.push(label);
  }
}

// A function rather than a constant: PORT is not known until the run starts, so
// a value frozen at module load would keep pointing at port 0.
const base = () => `http://127.0.0.1:${PORT}`;

const http = require("node:http");

/**
 * A request that reports what actually came back.
 *
 * `fetch` is not usable here: it follows a 307 before this code ever sees it,
 * so a refused request reads back as the login page's own 200, and the tests
 * would pass by inspecting the page the refusal redirected to. `fetch` also
 * grows a `x-middleware-subrequest` trick that turns out to *trigger* Next's
 * own middleware rather than skip it. The raw http client is the only way to
 * observe the real status and body.
 */
function req(path, { method = "GET", cookie, body, headers = {} } = {}) {
  const payload = body ? JSON.stringify(body) : null;
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${base()}${path}`,
      {
        method,
        headers: {
          ...(payload ? { "content-type": "application/json" } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (text += chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            type: res.headers["content-type"] || "",
            location: res.headers.location,
            setCookie: res.headers["set-cookie"],
            body: text,
          }),
        );
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function startServer(env) {
  // `detached` puts the child in its own process group. `npx` spawns
  // `next-server` as a grandchild, so killing npx alone leaves the server
  // listening: the next suite then answers on the same port and the test reports
  // the previous suite's configuration. Killing the group is the only way to take
  // the whole thing down.
  const child = spawn(
    "npx",
    ["next", "start", "-p", String(PORT)],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        STREAMKIT_API_TOKEN: "backend-token-value",
        STREAMKIT_PASSWORD: PASSWORD,
        STREAMKIT_SESSION_SECRET: SECRET,
        NEXT_PUBLIC_API_URL: BACKEND,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    },
  );
  return child;
}

async function waitForServer(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base()}/login`, { redirect: "manual" });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  return false;
}

/** True while something is still listening on the port. */
function portBusy() {
  return new Promise((resolve) => {
    const srv = require("node:net").createServer();
    srv.once("error", () => resolve(true));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(PORT, "127.0.0.1");
  });
}

/**
 * Kill whatever is listening on the port.
 *
 * The group kill is not always enough: `npx` runs `sh -c 'next' start`, and that
 * shell can be reparented to init before the kill lands, leaving next-server
 * alive and holding the port. Going by the port rather than the pid cannot miss,
 * because the port is the thing the next suite actually collides on.
 */
function killByPort() {
  try {
    const out = require("node:child_process").execSync(
      `ss -tlnp 'sport = :${PORT}' 2>/dev/null || true`,
      { encoding: "utf8" },
    );
    const pids = new Set();
    for (const m of out.matchAll(/pid=(\d+)/g)) pids.add(Number(m[1]));
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    return pids.size;
  } catch {
    return 0;
  }
}

async function withServer(env, fn) {
  // A fresh port per suite. Sharing one meant a suite whose server outlived its
  // kill answered the next suite's requests, so a test of "no password set"
  // silently ran against the "password set" configuration and reported the wrong
  // status. Distinct ports make that impossible.
  PORT = await freePort();
  while (await portBusy()) PORT = await freePort();

  const child = startServer(env);
  try {
    if (!(await waitForServer())) throw new Error("server did not start");
    await fn();
  } finally {
    // Negative pid kills the whole process group, which is the only way to reach
    // the next-server grandchild.
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
    let deadline = Date.now() + 6000;
    while (Date.now() < deadline && (await portBusy())) {
      await new Promise((r) => setTimeout(r, 200));
    }
    // Anything still there outlived the group kill, so take the port itself.
    if (await portBusy()) {
      killByPort();
      deadline = Date.now() + 6000;
      while (Date.now() < deadline && (await portBusy())) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    if (await portBusy()) throw new Error(`port ${PORT} is still busy after the run`);
  }
}

/** Extract the session cookie from a login response. */
function sessionFrom(setCookie) {
  if (!setCookie) return undefined;
  const m = /streamkit_session=([^;]+)/.exec(setCookie);
  return m ? `streamkit_session=${m[1]}` : undefined;
}

async function main() {
  console.log("the gate, exercised against a real Next server");
  console.log("signed out, the proxy is closed");
  await withServer({}, async () => {
    // Every one of these returned 200 before the gate existed. The body is
    // checked as well as the status: a 401 carrying HTML would be a redirect
    // wearing a 401's status, which an XHR in the editor cannot act on.
    const writes = [
      ["POST /api/overlays", "/api/overlays", "POST", { name: "x" }],
      ["PATCH /api/overlays/{id}", "/api/overlays/abc", "PATCH", { name: "x" }],
      ["DELETE /api/overlays/{id}", "/api/overlays/abc", "DELETE", undefined],
      ["POST /api/connect", "/api/connect", "POST", { username: "x" }],
      ["POST .../trigger", "/api/overlays/abc/trigger", "POST", {}],
      ["POST .../config", "/api/overlays/abc/config", "POST", { config: {} }],
    ];
    for (const [label, path, method, body] of writes) {
      const r = await req(path, { method, body });
      check(`${label} is refused`, r.status === 401, `got ${r.status}`);
      check(`${label} answers in JSON`, r.type.includes("json"), r.type);
    }
    const read = await req("/api/overlays");
    check("GET /api/overlays is refused at the proxy", read.status === 401, `got ${read.status}`);

    console.log("the page paths redirect to a login screen");
    check("/dashboard redirects", (await req("/dashboard")).status === 307);
    check("the redirect targets /login", (await req("/dashboard")).location.endsWith("/login"));

    console.log("a forged session is refused");
    for (const [label, value] of [
      ["an expiry far in the future", "99999999999999.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
      ["an expiry in the past", "1577836800000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
      ["a bare token", "garbage"],
      ["an empty value", ""],
    ]) {
      check(`${label} is refused`, (await req("/api/overlays", { cookie: `streamkit_session=${value}` })).status === 401, value);
    }
  });

  console.log("signed in, the proxy works");
  await withServer({}, async () => {
    const bad = await req("/api/session", { method: "POST", body: { password: "wrong" } });
    check("a wrong password is 401", bad.status === 401);
    check("a wrong password sets no cookie", !bad.setCookie);

    const good = await req("/api/session", { method: "POST", body: { password: PASSWORD } });
    check("the right password is 200", good.status === 200, String(good.status));
    const cookie = sessionFrom(good.setCookie);
    check("a session cookie is issued", !!cookie, String(good.setCookie));
    check("the cookie is HttpOnly", /httponly/i.test(good.setCookie || ""), good.setCookie);
    check("the cookie is scoped to the path", /path=\//i.test(good.setCookie || ""), good.setCookie);

    // The backend is deliberately unreachable in this suite, so a 502 here is
    // proof the request was proxied rather than refused at the gate. That
    // distinction is the whole point: 401 means no, 502 means yes and the
    // upstream is simply not there.
    const got = await req("/api/overlays", { cookie });
    check("a session gets past the gate", got.status === 502, `got ${got.status}`);
    const wrote = await req("/api/overlays", { method: "POST", cookie, body: { name: "x" } });
    check("a signed-in write gets past the gate", wrote.status === 502, `got ${wrote.status}`);

    check("a session is a week long", /max-age=604800/i.test(good.setCookie || ""), good.setCookie);
  });

  console.log("the gate fails closed when no password is configured");
  // Otherwise a deploy that forgot the env var would be as open as it was before
  // the gate, while looking protected in every other respect.
  await withServer({ STREAMKIT_PASSWORD: "" }, async () => {
    const anon = await req("/api/overlays", { method: "POST", body: { name: "x" } });
    check("an unconfigured gate refuses writes", anon.status === 503, `got ${anon.status}`);
  });

  console.log("the overlay stays reachable without a login");
  // OBS loads this page on the streamer's machine and cannot log in. If this
  // were gated the browser source would sit on a login screen forever, which is
  // the failure mode the whole exemption exists to avoid.
  await withServer({}, async () => {
    // A synthetic id, not a real one. What is under test is the exemption in
    // middleware.ts, which matches on the path shape and never looks the overlay
    // up — so a made-up uuid exercises the same branch without putting a
    // production overlay id in a tracked file.
    const overlay = await req("/overlay/00000000-0000-0000-0000-000000000000");
    check("/overlay/{id} is not redirected", overlay.status === 200, `got ${overlay.status}`);
    check("/login is reachable", (await req("/login")).status === 200);
  });

  console.log();
  if (failures.length) {
    console.log(`${failures.length} FAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
