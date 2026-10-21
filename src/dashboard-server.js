const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const dashboard = require("./dashboard");

// `foreman dashboard serve`: a foreground, read-only web server for one Foreman home, bound to 127.0.0.1.
// It serves the static dashboard and one snapshot, and pushes a new snapshot over Server-Sent Events when the
// home's fingerprint changes. It polls only while a browser holds the event stream, sends nothing to workers or the
// Foreman session, and never writes the home or takes its lock, so stopping it loses nothing.

const DEFAULT_PORT = 18789;
const BIND = "127.0.0.1";
const POLL_MS = 1000;
const KEEPALIVE_MS = 15000;
const CHECKOUT = path.resolve(__dirname, "..");
const WEB = path.join(CHECKOUT, "dashboard");
const DESIGN = path.join(CHECKOUT, "design", "dashboard", "design-system");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".woff2": "font/woff2", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".txt": "text/plain; charset=utf-8" };

// Published paths and the directory each one is served from; nothing outside them is reachable.
const ROUTES = [
  { prefix: "/app/", dir: path.join(WEB, "app") },
  { prefix: "/fonts/", dir: path.join(WEB, "fonts") },
  { prefix: "/ds/vendor/", dir: path.join(DESIGN, "vendor") },
];
const DESIGN_FILES = { "/ds/bundle.js": "bundle.js", "/ds/bundle.css": "bundle.css", "/ds/tokens.css": "tokens.css" };

const HEADERS = {
  "Cache-Control": "no-cache",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
};

function staticFile(urlPath) {
  if (urlPath === "/" || urlPath === "/index.html") return path.join(WEB, "index.html");
  if (DESIGN_FILES[urlPath]) return path.join(DESIGN, DESIGN_FILES[urlPath]);
  const route = ROUTES.find((item) => urlPath.startsWith(item.prefix));
  if (!route) return null;
  const file = path.resolve(route.dir, `.${urlPath.slice(route.prefix.length - 1)}`);
  return file.startsWith(`${route.dir}${path.sep}`) ? file : null;
}

// The design bundle loads its fonts from Google; the dashboard must work offline, so it uses the copies in dashboard/fonts.
function fileBody(file) {
  const body = fs.readFileSync(file);
  return path.basename(file) === "bundle.css" ? body.toString("utf8").replace(/^@import url\("https:\/\/fonts\.googleapis\.com[^\n]*\n/, "") : body;
}

function createDashboardServer({ roots, port = DEFAULT_PORT, pollMs = POLL_MS, now = () => Date.now() }) {
  const titles = new Map();
  const clients = new Set();
  let current = null;
  let currentPrint = null;
  let timings = { fingerprintMs: null, rebuildMs: null };
  let timer = null;
  let keepalive = null;

  const info = () => ({ bind: BIND, port: server.address()?.port ?? port, clients: clients.size, pollMs, ...timings });

  // Rebuilds the snapshot only when the home changed; returns true when it did.
  function refresh() {
    const started = performance.now();
    const print = dashboard.fingerprint({ roots });
    const printed = performance.now();
    timings = { ...timings, fingerprintMs: Math.round((printed - started) * 100) / 100 };
    if (current && print === currentPrint) return false;
    current = dashboard.buildSnapshot({ roots, now: now(), titles });
    currentPrint = print;
    timings = { ...timings, rebuildMs: Math.round((performance.now() - printed) * 100) / 100 };
    return true;
  }
  const payload = () => JSON.stringify({ ...current, server: info() });

  function push() {
    if (!clients.size) return;
    let changed;
    try { changed = refresh(); } catch (_) { return; }
    if (!changed) return;
    const data = payload();
    for (const response of clients) response.write(`event: snapshot\ndata: ${data}\n\n`);
  }

  function startPolling() {
    if (timer) return;
    timer = setInterval(push, pollMs);
    keepalive = setInterval(() => { for (const response of clients) response.write(": keepalive\n\n"); }, KEEPALIVE_MS);
  }
  function stopPolling() {
    clearInterval(timer); clearInterval(keepalive);
    timer = null; keepalive = null;
  }

  function send(response, status, body, type) {
    response.writeHead(status, { ...HEADERS, "Content-Type": type || "text/plain; charset=utf-8" });
    response.end(body);
  }

  const server = http.createServer((request, response) => {
    // A page on another site cannot reach the home through DNS rebinding: only this server's own host names are answered.
    const host = String(request.headers.host || "");
    const ownPort = server.address()?.port;
    if (![`${BIND}:${ownPort}`, `localhost:${ownPort}`].includes(host)) return send(response, 421, "Misdirected request\n");
    if (request.method !== "GET" && request.method !== "HEAD") return send(response, 405, "The dashboard is read-only\n");
    const url = new URL(request.url, `http://${host}`);
    if (url.pathname === "/api/snapshot") {
      try { refresh(); } catch (error) { return send(response, 500, JSON.stringify({ state: "error", error: error.message }), TYPES[".json"]); }
      return send(response, 200, payload(), TYPES[".json"]);
    }
    if (url.pathname === "/api/events") {
      response.writeHead(200, { ...HEADERS, "Content-Type": "text/event-stream; charset=utf-8", Connection: "keep-alive" });
      try { refresh(); } catch (_) {}
      clients.add(response);
      response.write(`retry: 3000\nevent: snapshot\ndata: ${current ? payload() : "{}"}\n\n`);
      startPolling();
      request.on("close", () => { clients.delete(response); if (!clients.size) stopPolling(); });
      return undefined;
    }
    const file = staticFile(url.pathname);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(response, 404, "Not found\n");
    return send(response, 200, request.method === "HEAD" ? undefined : fileBody(file), TYPES[path.extname(file)] || "application/octet-stream");
  });

  server.on("close", () => { stopPolling(); for (const response of clients) response.end(); clients.clear(); });
  return {
    server,
    listen: () => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, BIND, () => { server.off("error", reject); resolve(`http://${BIND}:${server.address().port}/`); });
    }),
    close: () => new Promise((resolve) => { for (const response of clients) response.end(); server.close(() => resolve()); }),
  };
}

module.exports = { DEFAULT_PORT, BIND, createDashboardServer };
