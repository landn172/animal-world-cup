// Dev launcher for LAN play: runs the Next dev server (port 13000) and the
// LAN relay (port 13001) together, so one command (`pnpm dev:lan`) brings up
// everything a local-versus session needs. Plain `pnpm dev` still works for
// solo / watch use — the relay is only required for 局域网联机.
import { spawn } from "node:child_process";
import os from "node:os";

function lanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === "IPv4" && !ni.internal &&
          /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ni.address)) {
        return ni.address;
      }
    }
  }
  return "localhost";
}

const procs = [];
function run(cmd, args, name, color) {
  const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => stream.on("data", (b) => {
    for (const line of String(b).split("\n")) if (line) out.write(tag + line + "\n");
  });
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on("exit", (code) => {
    process.stdout.write(tag + `exited (${code})\n`);
    shutdown();
  });
  procs.push(p);
}

function shutdown() {
  for (const p of procs) { try { p.kill(); } catch {} }
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

run("node", ["script/lan-server.mjs"], "lan", "36");
run("npx", ["next", "dev", "-p", "13000", "-H", "0.0.0.0"], "next", "32");

const ip = lanIP();
console.log(`\n\x1b[1m  Animal Cup — LAN ready\x1b[0m`);
console.log(`  Big screen / 主机:  http://localhost:13000/lobby`);
console.log(`  Phones / 手机加入:  http://${ip}:13000/pad   (or scan the QR in the lobby)\n`);
