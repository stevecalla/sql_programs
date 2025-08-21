const dotenv = require('dotenv');
dotenv.config();

// server.js
const os = require("os");
const express = require("express");
const bodyParser = require("body-parser");
const { spawn } = require("child_process");
const { createProxyMiddleware } = require("http-proxy-middleware");
const path = require("path");

// console.log(process.env.STREAMLIT_APP);

const PORT = process.env.PORT || 8011;                // public port (Cloudflare points here)
const STREAMLIT_PORT = process.env.STREAMLIT_PORT || 8501; // internal Streamlit port
const STREAMLIT_BIN = process.env.STREAMLIT_BIN || "streamlit";
// const APP_PATH = process.env.STREALIT_APP || path.join(__dirname, "app.py");
const APP_PATH = process.env.STREAMLIT_APP || path.join(__dirname, "app.py");

// Optional: serve at a subpath like "/orgchart". Leave blank for root.
const BASE_PATH = (process.env.BASE_PATH || "").replace(/^\/+|\/+$/g, "");
const MOUNT_PATH = BASE_PATH ? `/${BASE_PATH}` : "/";

// Optional: upload limit in MB for Streamlit
const MAX_UPLOAD_MB = process.env.MAX_UPLOAD_MB || "200";

const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

let shuttingDown = false;
let streamlitProc = null;

function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}

function startStreamlit() {
  const args = [
    "run", APP_PATH,
    "--server.port", String(STREAMLIT_PORT),
    "--server.address", "0.0.0.0",
    "--server.headless", "true",
    "--server.enableCORS", "false",
    "--server.enableXsrfProtection", "false",
    "--browser.gatherUsageStats", "false",
    "--server.maxUploadSize", String(MAX_UPLOAD_MB),
  ];

  if (BASE_PATH) {
    args.push("--server.baseUrlPath", BASE_PATH);
  }

  console.log(`[launcher] Spawning: ${STREAMLIT_BIN} ${args.join(" ")}`);
  streamlitProc = spawn(STREAMLIT_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });

  streamlitProc.stdout.on("data", (d) => process.stdout.write(`[streamlit] ${d}`));
  streamlitProc.stderr.on("data", (d) => process.stderr.write(`[streamlit] ${d}`));
  streamlitProc.on("exit", (code) => {
    console.log(`[launcher] Streamlit exited with code ${code}`);
    if (!shuttingDown) setTimeout(startStreamlit, 2000); // auto-restart
  });
}

// simple health check (kept outside the proxy)
app.get("/healthz", (req, res) => res.json({ ok: true, mountPath: MOUNT_PATH }));

// proxy Streamlit (HTTP + WebSocket) at the mount path
app.use(
  MOUNT_PATH,
  createProxyMiddleware({
    target: `http://127.0.0.1:${STREAMLIT_PORT}`,
    changeOrigin: true,
    ws: true,
    // When mounted on /orgchart, strip the prefix before proxying:
    pathRewrite: BASE_PATH ? { [`^/${BASE_PATH}`]: "" } : undefined,
    onProxyReq: (proxyReq) => {
      // no-op; hook available if you need headers
    },
  })
);

// graceful shutdown
function cleanup() {
  shuttingDown = true;
  console.log("\n[launcher] Shutting down…");
  if (streamlitProc && !streamlitProc.killed) {
    streamlitProc.kill("SIGTERM");
  }
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

app.listen(PORT, () => {
  const lan = getLanIp();
  console.log(`\n[launcher] Open locally:  http://localhost:${PORT}${MOUNT_PATH}`);
  if (lan) console.log(`\n[launcher] Open on LAN: http://${lan}:${PORT}${MOUNT_PATH}`);
  console.log(`[launcher] (Proxying to Streamlit on 127.0.0.1:${STREAMLIT_PORT})`);
  startStreamlit();
});
