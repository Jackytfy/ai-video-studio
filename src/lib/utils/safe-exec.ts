/**
 * safeExec — subprocess execution with guaranteed cleanup on timeout.
 *
 * Problem: Node's `execFile` timeout option only rejects the Promise;
 * the child process keeps running in the background, consuming CPU/memory.
 * On Windows, a plain `.kill()` does not terminate the process tree.
 *
 * This wrapper sends SIGKILL (Unix) or `taskkill /F /T` (Windows) when
 * the timeout fires, and collects stderr for error diagnostics.
 */

import { spawn, execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SafeExecResult {
  stdout: string;
  stderr: string;
}

export interface SafeExecOptions {
  /** Timeout in milliseconds. After this, the process is force-killed. */
  timeoutMs?: number;
  /** Max output buffer size in bytes (per stream). Default: 1MB. */
  maxBuffer?: number;
  /** Working directory for the child process. */
  cwd?: string;
}

function killProcessTree(pid: number, signal: string): void {
  if (process.platform === "win32") {
    // Windows: /T kills the entire process tree, /F forces termination
    try {
      spawn("taskkill", ["/PID", String(pid), "/F", "/T"], {
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // Best-effort
    }
  } else {
    try {
      // Negative PID sends signal to the entire process group
      process.kill(-pid, signal);
    } catch {
      // Process may have already exited
    }
  }
}

/**
 * Execute a command with guaranteed cleanup on timeout.
 *
 * Unlike the built-in `execFile` timeout, this wrapper:
 * 1. Waits for the specified timeout
 * 2. Sends SIGKILL (or taskkill /F /T on Windows) if the process is still running
 * 3. Collects stderr for error diagnostics
 * 4. Returns both stdout and stderr
 */
export async function safeExecFile(
  command: string,
  args: string[] = [],
  options: SafeExecOptions = {}
): Promise<SafeExecResult> {
  const {
    timeoutMs = 60000,
    maxBuffer = 1024 * 1024,
    cwd,
  } = options;

  return new Promise<SafeExecResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // Detached + process group so we can kill the whole tree on Unix
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let killed = false;

    const killTimer = setTimeout(() => {
      killed = true;
      if (child.pid) {
        killProcessTree(child.pid, "SIGKILL");
      }
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > maxBuffer) {
        clearTimeout(killTimer);
        killed = true;
        if (child.pid) killProcessTree(child.pid, "SIGKILL");
        reject(new Error(`stdout exceeded maxBuffer (${maxBuffer} bytes)`));
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > maxBuffer) {
        clearTimeout(killTimer);
        killed = true;
        if (child.pid) killProcessTree(child.pid, "SIGKILL");
        reject(new Error(`stderr exceeded maxBuffer (${maxBuffer} bytes)`));
      }
    });

    child.on("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      if (killed) {
        reject(
          new Error(
            `Process "${command} ${args.join(" ")}" killed after ${timeoutMs}ms timeout`
          )
        );
      } else if (code !== 0) {
        reject(
          new Error(
            `Process "${command} ${args.join(" ")}" exited with code ${code}, signal ${signal}. stderr: ${stderr.slice(0, 1000)}`
          )
        );
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Convenience wrapper that uses `execFile` with `safeExecFile`'s kill logic
 * when timeout is provided. Keeps backward compatibility with existing code.
 */
export async function safeExecFileSimple(
  command: string,
  args: string[] = [],
  options: { timeout?: number; maxBuffer?: number; cwd?: string } = {}
): Promise<SafeExecResult> {
  const { timeout, maxBuffer = 1024 * 1024, cwd } = options;

  if (!timeout) {
    // No timeout → use the built-in execFile (simpler, no overhead)
    const { stdout, stderr } = await execFileAsync(command, args, {
      maxBuffer,
      cwd,
    });
    return { stdout, stderr };
  }

  return safeExecFile(command, args, { timeoutMs: timeout, maxBuffer, cwd });
}
