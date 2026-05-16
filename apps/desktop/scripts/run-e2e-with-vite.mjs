import { spawn } from "node:child_process";
import { createServer } from "vite";

const args = process.argv.slice(2);
const server = await createServer({
  server: { host: "127.0.0.1", port: 1420, strictPort: true },
  logLevel: "warn",
});

await server.listen();

const child = spawn(
  process.execPath,
  ["node_modules/playwright/cli.js", "test", ...args],
  {
    cwd: process.cwd(),
    env: { ...process.env, AIMD_PLAYWRIGHT_EXTERNAL_SERVER: "1" },
    stdio: "inherit",
  },
);

const code = await new Promise((resolve) => {
  child.on("exit", (code, signal) => {
    if (signal) resolve(1);
    else resolve(code ?? 1);
  });
});

await server.close();
process.exitCode = code;
