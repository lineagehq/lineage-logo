import { spawn } from "node:child_process";
import process from "node:process";

const forwardedArgs = process.argv.slice(2);
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const portIndex = forwardedArgs.indexOf("--port");
const apiPort = portIndex >= 0 ? forwardedArgs[portIndex + 1] : "4173";
const environment = { ...process.env, LINEAGE_LOGO_PORT: apiPort };

const children = [
  spawn(command, ["vite"], { env: environment, stdio: "inherit" }),
  spawn(command, ["tsx", "src/server/index.ts", ...forwardedArgs], {
    env: environment,
    stdio: "inherit",
  }),
];

const stop = (signal: NodeJS.Signals) => {
  for (const child of children) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

const exitCodes = await Promise.all(
  children.map(
    (child) =>
      new Promise<number>((resolve) => {
        child.on("exit", (code) => resolve(code ?? 1));
      }),
  ),
);

process.exitCode = exitCodes.find((code) => code !== 0) ?? 0;
