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
// The suite builds and starts from its own output directory. See ensureBuilt.
const GATE_DIST = ".next-gate-test";

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
  // A string body is sent as written, which is how a native form post arrives
  // (application/x-www-form-urlencoded). Anything else is JSON, so a test can
  // write either without knowing the difference.
  const payload = typeof body === "string" ? body : body ? JSON.stringify(body) : null;
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
  // The build is not reused from `.next`, and that is the whole reason this suite
  // was measuring the wrong thing.
  //
  // `NEXT_PUBLIC_*` is inlined into the client bundle by `next build`, not read at
  // request time, so passing the stub to `next start` changes nothing. The bundle
  // already on disk carried the real API hostname, every proxied request reached
  // the production backend, and the suite read its answers as if they were the
  // gate's: a 200 and a 404 where a 502 was expected. Nothing in the gate was
  // wrong. The suite was pointed at a live server it believed was dead.
  //
  // A dead port therefore cannot be the target either — connection refused is not
  // a 502. So the build is done here, with the stub hostname compiled in, into a
  // directory the test owns and can throw away. Slow, and the only thing that
  // makes the assertions mean what they claim.
  // Started from the suite's own build, not `.next`, so the API hostname in the
  // bundle is the stub and not whatever was compiled in last.
  //
  // `detached` puts the child in its own process group. `npx` spawns
  // `next-server` as a grandchild, so killing npx alone leaves the server
  // listening: the next scenario then answers on the same port and the test
  // reports the previous scenario's configuration. Killing the group is the only
  // way to take the whole thing down.
  const child = spawn(
    "npx",
    ["next", "start", "-p", String(PORT)],
    {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...process.env,
        STREAMKIT_DIST_DIR: GATE_DIST,
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

/**
 * Build once, with the stub hostname compiled in, into a directory of our own.
 *
 * `next start` cannot be pointed at a different API host at runtime, so the
 * build has to carry it. Building into `.next` would overwrite whatever the
 * developer or the deploy had there and be overwritten back, so the suite owns
 * its output and removes it on the way out.
 */
let buildDone = false;

process.on("exit", () => {
  // The suite's build is large and would otherwise sit in the working tree,
  // where it shows up as an untracked change and can be committed by accident.
  try {
    require("node:fs").rmSync(path.resolve(__dirname, "..", GATE_DIST), { recursive: true, force: true });
  } catch {}
});
function ensureBuilt(env) {
  if (buildDone) return;
  const cwd = path.resolve(__dirname, "..");
  require("node:child_process").execFileSync("npx", ["next", "build"], {
    cwd,
    env: {
      ...process.env,
      STREAMKIT_DIST_DIR: GATE_DIST,
      STREAMKIT_API_TOKEN: "backend-token-value",
      STREAMKIT_PASSWORD: PASSWORD,
      STREAMKIT_SESSION_SECRET: SECRET,
      NEXT_PUBLIC_API_URL: BACKEND,
      ...env,
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  buildDone = true;
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

  // Built before the first server starts, and only with the credentials of the
  // first scenario: the password and secret are read at request time, so a later
  // scenario overriding them is a different configuration served from the same
  // bundle.
  ensureBuilt({});
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
    //
    // `POST /api/connect` used to be in this list and it was wrong: the overlay
    // page calls it from OBS, which has no password, so refusing it left the
    // overlay unable to ever reach a room. It is asserted as open further down,
    // with the rest of the paths the overlay needs.
    const writes = [
      ["POST /api/overlays", "/api/overlays", "POST", { name: "x" }],
      ["PATCH /api/overlays/{id}", "/api/overlays/abc", "PATCH", { name: "x" }],
      ["DELETE /api/overlays/{id}", "/api/overlays/abc", "DELETE", undefined],
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

    // The form path is a different bug and was live on the deployed build: the
    // login page is a native post, so a 401 body made the browser navigate to
    // /api/session and display raw JSON, losing the form entirely. The operator
    // saw an API endpoint instead of a login page.
    const formBody = "password=wrong&next=%2Fdashboard";
    const formPost = await req("/api/session", {
      method: "POST",
      body: formBody,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    check("a wrong password by form is a redirect", formPost.status === 303, `got ${formPost.status}`);
    check(
      "the redirect goes back to the login page",
      (formPost.location || "").includes("/login"),
      formPost.location,
    );
    check(
      "the redirect flags the failure",
      (formPost.location || "").includes("error=1"),
      formPost.location,
    );
    check("the redirect keeps the original target", (formPost.location || "").includes("next="), formPost.location);
    check("a wrong password by form sets no cookie", !formPost.setCookie);

    // The target is echoed back, so it has to stay a same-site path — otherwise
    // a wrong password is enough to turn /login into an open redirect.
    const openPost = await req("/api/session", {
      method: "POST",
      body: "password=wrong&next=https%3A%2F%2Fevil.example",
      headers: { "content-type": "application/x-www-form-urlencoded" },
    });
    check(
      "an absolute target is not echoed into the redirect",
      !(openPost.location || "").includes("evil.example"),
      openPost.location,
    );

    // And the page renders that flag.
    const loginPage = await req("/login?error=1");
    check("the login page shows the error", loginPage.body.includes("Password salah"), `status ${loginPage.status}`);
    const quiet = await req("/login");
    check("the login page is clean without it", !quiet.body.includes("Password salah"));

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

  console.log("the poll is reachable without a session, so OBS can vote");
  // The poll widget renders on /overlay/{id}, which OBS loads and which cannot
  // log in. It votes through this proxy, so if the gate covered the poll the vote
  // button would silently do nothing and the backend's open GET /vote would never
  // be reached.
  await withServer({}, async () => {
    // This one is not optional. The overlay fetches its own config from here, and
    // when it was gated the page 401'd, fell back to the sample scene, and the
    // stream showed someone else's goal bar plus a red "Overlay not found".
    const own = await req("/api/overlays/ov1");
    check("an overlay can read its own config", own.status === 502, `got ${own.status}`);

    const read = await req("/api/polls/ov1");
    check("reading a poll needs no session", read.status === 502, `got ${read.status}`);

    const vote = await req("/api/polls/ov1/vote?choice=0");
    check("voting needs no session", vote.status === 502, `got ${vote.status}`);

    // The exemption is for the read and the vote, not for the writes. Creating a
    // poll is how an overlay gets a question, and it stays behind the gate.
    const create = await req("/api/polls/ov1", { method: "POST", body: { question: "Q", options: ["a"] } });
    check("creating a poll still needs a session", create.status === 401, `got ${create.status}`);

    const drop = await req("/api/polls/ov1", { method: "DELETE" });
    check("deleting a poll still needs a session", drop.status === 401, `got ${drop.status}`);

    // And it is scoped: a list of every overlay stays closed, and so does a write
    // to a single overlay even though its read is open.
    const list = await req("/api/overlays");
    check("listing every overlay is still closed", list.status === 401, `got ${list.status}`);

    const write = await req("/api/overlays/ov1", { method: "DELETE" });
    check("deleting an overlay still needs a session", write.status === 401, `got ${write.status}`);

    const save = await req("/api/overlays/ov1/config", { method: "POST", body: { theme: "quiet" } });
    check("saving a config still needs a session", save.status === 401, `got ${save.status}`);

    // The overlay connects from OBS, which has no password, so this one write has
    // to work signed out. Gating it left the overlay unable to ever reach a room,
    // which is why a live stream showed the sample scene.
    const connect = await req("/api/connect", {
      method: "POST",
      body: { username: "chan", overlay_id: "ov1" },
    });
    check("the overlay can connect without a session", connect.status === 502, `got ${connect.status}`);

    // Naming `/api/connect` must not open the rest of the verb on that path, or
    // the next one added would inherit the exemption.
    const stop = await req("/api/connect", { method: "DELETE" });
    check("disconnecting still needs a session", stop.status === 401, `got ${stop.status}`);

    const other = await req("/api/connect/ov1", { method: "POST", body: {} });
    check("a path that merely starts the same is still closed", other.status === 401, `got ${other.status}`);
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
