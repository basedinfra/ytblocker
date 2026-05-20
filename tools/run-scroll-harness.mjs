import { createServer } from "node:http";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const ROOT = new URL("../", import.meta.url);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, "http://localhost").pathname;
      const relativePath = pathname === "/" ? "tools/scroll-harness.html" : pathname.slice(1);
      const file = await readFile(new URL(relativePath, ROOT));
      res.writeHead(200, {
        "content-type": relativePath.endsWith(".html") ? "text/html" : "text/plain",
      });
      res.end(file);
    } catch (error) {
      res.writeHead(404);
      res.end(String(error));
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function waitForJson(url, timeoutMs = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function createCdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let id = 0;
  const callbacks = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;

    const callback = callbacks.get(message.id);
    if (!callback) return;
    callbacks.delete(message.id);

    if (message.error) {
      callback.reject(new Error(JSON.stringify(message.error)));
    } else {
      callback.resolve(message.result);
    }
  });

  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}, sessionId = undefined) {
          id += 1;
          const payload = { id, method, params };
          if (sessionId) payload.sessionId = sessionId;
          socket.send(JSON.stringify(payload));
          return new Promise((resolveCommand, rejectCommand) => {
            callbacks.set(id, {
              resolve: resolveCommand,
              reject: rejectCommand,
            });
          });
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(cdp, sessionId, expression, awaitPromise = true) {
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise,
      returnByValue: true,
    },
    sessionId
  );

  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails));
  }

  return result.result.value;
}

async function runScenario(cdp, sessionId, scenario) {
  const contentScript = await readFile(new URL("content/content.js", ROOT), "utf8");

  await evaluate(cdp, sessionId, "window.__ytbHarness.resetFeed()");
  await evaluate(
    cdp,
    sessionId,
    `window.__ytbHarness.setChromeSettings(${JSON.stringify(scenario.settings)})`
  );
  const before = await evaluate(cdp, sessionId, "window.__ytbHarness.snapshot()");
  await evaluate(cdp, sessionId, contentScript, false);

  if (scenario.wheelAtMs) {
    await wait(scenario.wheelAtMs);
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: 400,
      y: 400,
      deltaX: 0,
      deltaY: 160,
    }, sessionId);
    await wait(Math.max(0, 4500 - scenario.wheelAtMs));
  } else {
    await wait(4500);
  }

  const after = await evaluate(cdp, sessionId, "window.__ytbHarness.snapshot()");
  const delta = after.scrollY - before.scrollY;
  const expectedDelta = scenario.expectedDelta || 0;
  const passed = Math.abs(delta - expectedDelta) <= 2;

  return { name: scenario.name, passed, before, after, delta, expectedDelta };
}

async function removeWithRetry(path) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await wait(250);
    }
  }
}

const server = await createStaticServer();
const port = server.address().port;
const userDataDir = await mkdtemp(join(tmpdir(), "ytblocker-scroll-harness-"));
const debugPort = 9333 + Math.floor(Math.random() * 1000);
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  `http://127.0.0.1:${port}/`,
], {
  stdio: "ignore",
});

try {
  const version = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`);
  const cdp = await createCdpClient(version.webSocketDebuggerUrl);
  const { targetId } = await cdp.send("Target.createTarget", {
    url: `http://127.0.0.1:${port}/`,
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });

  await cdp.send("Runtime.enable", {}, sessionId);
  await wait(500);
  await evaluate(cdp, sessionId, "document.readyState");

  const scenarios = [
    {
      name: "keyword offscreen safe remove",
      settings: {
        keywordDismissalEnabled: true,
        keywords: [{ text: "BLOCKME", caseSensitive: false }],
        dismissalDelayMinSeconds: 1,
        dismissalDelayMaxSeconds: 1,
      },
    },
    {
      name: "keyword offscreen safe remove while user wheels",
      wheelAtMs: 900,
      expectedDelta: 160,
      settings: {
        keywordDismissalEnabled: true,
        keywords: [{ text: "BLOCKME", caseSensitive: false }],
        dismissalDelayMinSeconds: 1,
        dismissalDelayMaxSeconds: 1,
      },
    },
    {
      name: "duration offscreen remove",
      settings: {
        videoDurationMaxSeconds: 3600,
        dismissalDelayMinSeconds: 1,
        dismissalDelayMaxSeconds: 1,
      },
    },
    {
      name: "age offscreen remove",
      settings: {
        videoAgeMaxDays: 365,
        dismissalDelayMinSeconds: 1,
        dismissalDelayMaxSeconds: 1,
      },
    },
  ];

  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(cdp, sessionId, scenario));
  }

  cdp.close();

  for (const result of results) {
    const status = result.passed ? "PASS" : "FAIL";
    console.log(
      `${status} ${result.name}: scroll delta=${result.delta} expected=${result.expectedDelta}`
    );
    console.log(
      `  before=${result.before.scrollY} after=${result.after.scrollY} ` +
      `menuClicks=${result.after.menuClicks} notInterestedClicks=${result.after.notInterestedClicks} ` +
      `cardCount=${result.after.cardCount}`
    );
  }

  if (results.some((result) => !result.passed)) {
    process.exitCode = 1;
  }
} finally {
  chrome.kill();
  server.close();
  await wait(500);
  await removeWithRetry(userDataDir);
}
