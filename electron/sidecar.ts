import { ChildProcessByStdio, spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { Readable } from "node:stream";
import { app } from "electron";

export type SidecarStatus = {
  backendVersion: string;
  protocolVersion: number;
  schemaVersion: number;
  dataDir: string;
  ortoolsVersion: string;
};

export type Sidecar = {
  process: ChildProcessByStdio<null, Readable, Readable>;
  port: number;
  token: string;
  stderrTail: () => string;
};

const wait = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate loopback port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

export async function startSidecar(
  token: string,
  dataDir: string,
): Promise<Sidecar> {
  const port = await freePort();
  const projectRoot = path.resolve(__dirname, "../..");
  const production = app.isPackaged;
  const command = production
    ? path.join(
        process.resourcesPath,
        "sidecar",
        process.platform === "win32" ? "classowl.exe" : "classowl",
      )
    : "uv";
  const args = production
    ? ["--port", String(port), "--data-dir", dataDir]
    : [
        "run",
        "python",
        "backend/classowl/__main__.py",
        "--port",
        String(port),
        "--data-dir",
        dataDir,
      ];
  // 令牌走环境变量，不走 argv：命令行参数对本机任何进程都可见（`ps aux`）。
  const child = spawn(command, args, {
    cwd: production ? undefined : projectRoot,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, CLASSOWL_TOKEN: token },
  });
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-8000);
  });
  return { process: child, port, token, stderrTail: () => stderr };
}

export async function waitUntilReady(
  sidecar: Sidecar,
  timeoutMs = 15_000,
): Promise<SidecarStatus> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (hasExited(sidecar.process)) {
      throw new Error(`Backend exited during startup.\n${sidecar.stderrTail()}`);
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${sidecar.port}/api/v1/system/status`,
        { headers: { "X-ClassOwl-Token": sidecar.token } },
      );
      if (response.ok) return (await response.json()) as SidecarStatus;
    } catch {
      // The process is still starting.
    }
    await wait(100);
  }
  throw new Error(`Backend startup timed out.\n${sidecar.stderrTail()}`);
}

/** 被信号杀死的进程 exitCode 为 null、signalCode 才有值，两者都要判。 */
export function hasExited(
  child: ChildProcessByStdio<null, Readable, Readable>,
): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export async function stopSidecar(sidecar: Sidecar): Promise<void> {
  if (hasExited(sidecar.process)) return;
  try {
    await fetch(`http://127.0.0.1:${sidecar.port}/api/v1/system/exit`, {
      method: "POST",
      headers: { "X-ClassOwl-Token": sidecar.token },
      signal: AbortSignal.timeout(2_000),
    });
  } catch {
    // Fall through to process signals.
  }
  if (await waitForExit(sidecar.process, 3_000)) return;
  sidecar.process.kill("SIGTERM");
  if (await waitForExit(sidecar.process, 2_000)) return;
  sidecar.process.kill("SIGKILL");
  await waitForExit(sidecar.process, 1_000);
}

function waitForExit(
  child: ChildProcessByStdio<null, Readable, Readable>,
  timeoutMs: number,
): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}
