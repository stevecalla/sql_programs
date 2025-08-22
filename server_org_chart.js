// server_org_chart.js — Root proxy that prefers the venv next to app.py
const dotenv = require("dotenv");
dotenv.config();

const os = require("os");
const fs = require("fs");
const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const { spawn } = require("child_process");
const { createProxyMiddleware } = require("http-proxy-middleware");

// ------------------ Config ------------------
const ORG_CHART_PORT = Number(process.env.ORG_CHART_PORT || 8011);
const STREAMLIT_PORT = Number(process.env.STREAMLIT_PORT || 8501);
const MAX_UPLOAD_MB = process.env.MAX_UPLOAD_MB || "200";

// ------------------ Helpers ------------------
function getPlatformKey() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "mac";
  return "linux";
}
function getLanIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === "IPv4" && !net.internal) return net.address;
    }
  }
  return null;
}
function firstExisting(paths) {
  for (const p of paths) {
    if (!p) continue;
    try {
      const norm = path.normalize(p);
      if (fs.existsSync(norm)) return norm;
    } catch (_) {}
  }
  return null;
}

async function tryHelperDerivedApp() {
  try {
    const { determineOSPath } = require("./utilities/determine_os_path");
    let base = determineOSPath();
    if (base && typeof base.then === "function") base = await base;
    if (!base) return null;
    return path.resolve(base, "..", "sql_programs", "utilities", "org_chart", "src", "app.py");
  } catch {
    return null;
  }
}

// ------------------ Resolve APP_PATH ------------------
async function resolveAppPath() {
  const plat = getPlatformKey();
  const user = os.userInfo().username.toLowerCase();

  const envGeneric = process.env.STREAMLIT_APP;
  const envOS = {
    windows: process.env.STREAMLIT_APP_WINDOWS,
    mac: process.env.STREAMLIT_APP_MAC,
    linux: process.env.STREAMLIT_APP_LINUX,
  }[plat];
  const helperCandidate = await tryHelperDerivedApp();

  const known = [];
  if (plat === "windows") {
    known.push("C:/Users/calla/development/usat/sql_programs/utilities/org_chart/src/app.py");
  } else if (plat === "mac") {
    known.push("/Users/teamkwsc/development/usat/sql_programs/utilities/org_chart/src/app.py");
  } else {
    known.push(`/home/${user}/development/usat/sql_programs/utilities/org_chart/src/app.py`);
    known.push("/home/steve-calla/development/usat/sql_programs/utilities/org_chart/src/app.py");
    known.push("/home/usat-server/development/usat/sql_programs/utilities/org_chart/src/app.py");
  }

  const localFallback = path.join(__dirname, "app.py");
  const candidates = [envGeneric, envOS, helperCandidate, ...known, localFallback].filter(Boolean);

  const found = firstExisting(candidates);
  if (!found) {
    console.error("[launcher] Could not locate app.py. Tried:");
    candidates.forEach((c) => console.error("  -", c));
    console.error("Set STREAMLIT_APP (or OS-specific var) or place app.py next to this server.");
    process.exit(1);
  }
  return found;
}

// ------------------ Prefer venv near app.py ------------------
function resolveVenvNear(appPath) {
  const plat = getPlatformKey();
  const appDir = path.dirname(appPath);

  const streamlitCandidates =
    plat === "windows"
      ? [
          path.join(appDir, ".venv", "Scripts", "streamlit.exe"),
          path.join(appDir, "venv", "Scripts", "streamlit.exe"),
          path.join(appDir, "..", ".venv", "Scripts", "streamlit.exe"),
          path.join(appDir, "..", "venv", "Scripts", "streamlit.exe"),
        ]
      : [
          path.join(appDir, ".venv", "bin", "streamlit"),
          path.join(appDir, "venv", "bin", "streamlit"),
          path.join(appDir, "..", ".venv", "bin", "streamlit"),
          path.join(appDir, "..", "venv", "bin", "streamlit"),
        ];

  const pythonCandidates =
    plat === "windows"
      ? [
          path.join(appDir, ".venv", "Scripts", "python.exe"),
          path.join(appDir, "venv", "Scripts", "python.exe"),
          path.join(appDir, "..", ".venv", "Scripts", "python.exe"),
          path.join(appDir, "..", "venv", "Scripts", "python.exe"),
        ]
      : [
          path.join(appDir, ".venv", "bin", "python"),
          path.join(appDir, "venv", "bin", "python"),
          path.join(appDir, "..", ".venv", "bin", "python"),
          path.join(appDir, "..", "venv", "bin", "python"),
        ];

  return {
    streamlitBin: firstExisting(streamlitCandidates),
    pythonBin: firstExisting(pythonCandidates),
  };
}

// ------------------ Resolve Streamlit binary (fallbacks) ------------------
function resolveStreamlitCmdGeneric() {
  const plat = getPlatformKey();
  const envGeneric = process.env.STREAMLIT_BIN;
  const envOS = {
    windows: process.env.STREAMLIT_BIN_WINDOWS,
    mac: process.env.STREAMLIT_BIN_MAC,
    linux: process.env.STREAMLIT_BIN_LINUX,
  }[plat];
  const cwdVenv =
    plat === "windows"
      ? path.join(process.cwd(), ".venv", "Scripts", "streamlit.exe")
      : path.join(process.cwd(), ".venv", "bin", "streamlit");
  const defaultCmd = "streamlit";
  return { cmd: firstExisting([envGeneric, envOS, cwdVenv]) || defaultCmd, prefix: [] };
}
function fallbackPythonModuleCmd() {
  const plat = getPlatformKey();
  return plat === "windows"
    ? { cmd: "py", prefix: ["-m", "streamlit"] }
    : { cmd: "python3", prefix: ["-m", "streamlit"] };
}

// ------------------ Spawn Streamlit ------------------
let shuttingDown = false;
let streamlitProc = null;
let APP_PATH = null;

function prettyPrintStreamlit(buf) {
  const lines = buf.toString().split(/\r?\n/);
  for (let line of lines) {
    if (!line) continue;
    if (/URL:\s*http:\/\/0\.0\.0\.0:(\d+)/i.test(line)) {
      line = line.replace(/URL:\s*http:\/\/0\.0\.0\.0:(\d+)/i, (_, p) => `URL: http://localhost:${p}`);
    }
    console.log(`[streamlit] ${line}`);
  }
}
function spawnOnce(cmd, prefixArgs) {
  const tailArgs = [
    "run",
    APP_PATH,
    "--server.port",
    String(STREAMLIT_PORT),
    "--server.address",
    "0.0.0.0",
    "--server.headless",
    "true",
    "--server.enableCORS",
    "false",
    "--server.enableXsrfProtection",
    "false",
    "--browser.gatherUsageStats",
    "false",
    "--server.maxUploadSize",
    String(MAX_UPLOAD_MB),
  ];
  const fullArgs = [...(prefixArgs || []), ...tailArgs];
  console.log(`[launcher] Spawning: ${cmd} ${fullArgs.join(" ")}`);

  const proc = spawn(cmd, fullArgs, { stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.on("data", prettyPrintStreamlit);
  proc.stderr.on("data", (d) => process.stderr.write(`[streamlit] ${d}`));

  return new Promise((resolve) => {
    let started = false,
      errored = false;
    proc.on("error", (err) => {
      errored = true;
      resolve({ ok: false, err });
    });
    proc.stdout.once("data", () => {
      started = true;
      resolve({ ok: true, proc });
    });
    setTimeout(() => {
      if (!started && !errored) resolve({ ok: true, proc });
    }, 500);
  });
}

async function startStreamlit() {
  // 1) Prefer venv next to app.py
  const v = resolveVenvNear(APP_PATH);
  let primary;
  if (v.streamlitBin) {
    console.log(`[launcher] Using venv streamlit: ${v.streamlitBin}`);
    primary = { cmd: v.streamlitBin, prefix: [] };
  } else if (v.pythonBin) {
    console.log(`[launcher] Using venv python: ${v.pythonBin} -m streamlit`);
    primary = { cmd: v.pythonBin, prefix: ["-m", "streamlit"] };
  } else {
    // 2) Fall back to env/cwd/default streamlit
    primary = resolveStreamlitCmdGeneric();
  }

  let res = await spawnOnce(primary.cmd, primary.prefix);
  if (!res.ok) {
    console.log("[launcher] Primary command failed, falling back to system python -m streamlit");
    const fb = fallbackPythonModuleCmd();
    res = await spawnOnce(fb.cmd, fb.prefix);
    if (!res.ok) {
      console.error("[launcher] Failed to start Streamlit with available methods.", res.err || "");
      process.exit(1);
    }
  }
  streamlitProc = res.proc;
  streamlitProc.on("exit", (code) => {
    console.log(`[launcher] Streamlit exited with code ${code}`);
    if (!shuttingDown) setTimeout(startStreamlit, 2000);
  });
}

// ------------------ Express + proxy ------------------
const app = express();
app.set("trust proxy", true);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Health
app.get("/healthz", (req, res) =>
  res.json({ ok: true, app: APP_PATH, proxy: ORG_CHART_PORT, streamlit: STREAMLIT_PORT })
);

// Root-mounted proxy; everything (except /healthz) goes to Streamlit
const proxyOpts = {
  target: `http://127.0.0.1:${STREAMLIT_PORT}`,
  changeOrigin: true,
  ws: true,
  logLevel: "warn",
  timeout: 120000,
  proxyTimeout: 120000,
  xfwd: true,
};
app.use("/", createProxyMiddleware(proxyOpts));

// ------------------ Start ------------------
function cleanup() {
  shuttingDown = true;
  console.log("\n[launcher] Shutting down…");
  if (streamlitProc && !streamlitProc.killed) {
    try {
      streamlitProc.kill("SIGTERM");
    } catch (_) {}
  }
  process.exit(0);
}
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

(async () => {
  APP_PATH = await resolveAppPath();

  app.listen(ORG_CHART_PORT, () => {
    const lan = getLanIp();
    console.log(`\n[launcher] Using app: ${APP_PATH}`);
    console.log(`[launcher] Open locally:  http://localhost:${ORG_CHART_PORT}/`);
    if (lan) console.log(`[launcher] Open on LAN: http://${lan}:${ORG_CHART_PORT}/`);
    console.log(`[launcher] (Proxying to Streamlit on 127.0.0.1:${STREAMLIT_PORT})`);
    startStreamlit();
  });
})();
