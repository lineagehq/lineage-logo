import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";

const forwardedArgs = process.argv.slice(2);
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const portIndex = forwardedArgs.indexOf("--port");
const requestedPort = Number(portIndex >= 0 ? forwardedArgs[portIndex + 1] : "4173");
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65535) {
  throw new Error("Port must be an integer between 1024 and 65535.");
}

async function portIsAvailable(port: number): Promise<boolean> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") resolve(false);
      else reject(error);
    });
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

async function availablePort(start: number): Promise<number> {
  for (let port = start; port <= Math.min(65535, start + 100); port += 1) {
    if (await portIsAvailable(port)) return port;
  }
  throw new Error(`No available local API port between ${start} and ${Math.min(65535, start + 100)}.`);
}

const apiPort = await availablePort(requestedPort);
if (apiPort !== requestedPort) {
  console.log(`Local API port ${requestedPort} is occupied; using ${apiPort}.`);
}
const clientPort = await availablePort(5173);
if (clientPort !== 5173) {
  console.log(`Editor port 5173 is occupied; using ${clientPort}.`);
}
const environment = {
  ...process.env,
  LINEAGE_LOGO_CLIENT_PORT: String(clientPort),
  LINEAGE_LOGO_PORT: String(apiPort),
};
const serverArgs = portIndex >= 0
  ? forwardedArgs.filter((_argument, index) => index !== portIndex && index !== portIndex + 1)
  : [...forwardedArgs];
serverArgs.push("--port", String(apiPort));
const detached = process.platform !== "win32";

const children = [
  spawn(command, ["vite"], { detached, env: environment, stdio: "inherit" }),
  spawn(command, ["tsx", "src/server/index.ts", ...serverArgs], {
    detached,
    env: environment,
    stdio: "inherit",
  }),
];

let stopping = false;
const stop = (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    if (detached) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    } else {
      child.kill(signal);
    }
  }
};

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));
if (process.platform !== "win32") {
  process.on("SIGHUP", () => stop("SIGTERM"));
  process.on("SIGQUIT", () => stop("SIGTERM"));
}
process.on("exit", () => {
  if (!stopping) stop("SIGTERM");
});

const exits = children.map((child) => new Promise<number>((resolve) => {
  child.once("error", () => resolve(1));
  child.once("exit", (code, signal) => resolve(code ?? (signal ? 0 : 1)));
}));

const firstExitCode = await Promise.race(exits);
stop("SIGTERM");
const exitCodes = await Promise.all(exits);
process.exitCode = firstExitCode || exitCodes.find((code) => code !== 0) || 0;
