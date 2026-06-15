#!/usr/bin/env node
/**
 * TTS Health Check Script
 * Verifies all TTS providers are functional before production deployment.
 *
 * Run: node scripts/check-tts.mjs
 *
 * Checks:
 * 1. Python + edge_tts availability (Edge TTS)
 * 2. MiMo API key and endpoint reachability
 * 3. Runtime TTS generation test (generates a sample audio file)
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

const TEST_TEXT = "这是一条测试语音";
const TEST_VOICE = "zh-CN-YunxiNeural";

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  message: string;
}

const results: CheckResult[] = [];

function log(level: string, msg: string) {
  const icons: Record<string, string> = { ok: "✅", warn: "⚠️", fail: "❌", info: "ℹ️" };
  console.log(`${icons[level] || "  "} ${msg}`);
}

async function checkPython(): Promise<boolean> {
  for (const cmd of ["python3", "python"]) {
    try {
      const { stdout } = await execFileAsync(cmd, ["--version"], { timeout: 5000 });
      log("ok", `Python found: ${stdout.trim()} (${cmd})`);
      return true;
    } catch {}
  }
  results.push({ name: "Python", status: "fail", message: "Neither python3 nor python found" });
  log("fail", "Python not found in PATH");
  return false;
}

async function checkEdgeTTS(): Promise<void> {
  const id = randomUUID();
  const outputFile = join(tmpdir(), `tts-health-${id}.mp3`);

  try {
    await execFileAsync("python3", [
      "-m", "edge_tts",
      "--voice", TEST_VOICE,
      "--rate", "+0%",
      "--text", TEST_TEXT,
      "--write-media", outputFile,
    ], { timeout: 30000 });

    const st = await stat(outputFile);
    if (st.size > 1000) {
      log("ok", `edge_tts working — generated ${(st.size / 1024).toFixed(1)} KB`);
      results.push({ name: "Edge TTS", status: "ok", message: `${(st.size / 1024).toFixed(1)} KB sample` });
    } else {
      throw new Error(`File too small: ${st.size} bytes`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    log("fail", `edge_tts failed: ${msg}`);
    results.push({ name: "Edge TTS", status: "fail", message: msg });
  } finally {
    await unlink(outputFile).catch(() => {});
  }
}

async function checkMiMo(): Promise<void> {
  const apiKey = process.env.MIMO_API_KEY;
  if (!apiKey) {
    results.push({ name: "MiMo TTS", status: "warn", message: "MIMO_API_KEY not set (optional)" });
    log("warn", "MiMo TTS: MIMO_API_KEY not set — skipping (optional)");
    return;
  }

  const baseUrl = process.env.MIMO_BASE_URL || "https://token-plan-cn.xiaomimimo.com/v1";
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "mimo-v2.5-tts",
        messages: [{ role: "assistant", content: TEST_TEXT }],
        audio: { format: "wav", voice: "冰糖" },
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.choices?.[0]?.message?.audio?.data) {
        log("ok", `MiMo TTS working — ${baseUrl}`);
        results.push({ name: "MiMo TTS", status: "ok", message: baseUrl });
      } else {
        throw new Error("No audio data in response");
      }
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    log("fail", `MiMo TTS failed: ${msg}`);
    results.push({ name: "MiMo TTS", status: "fail", message: msg });
  }
}

async function main() {
  console.log("\n🔊 TTS Health Check\n");

  const hasPython = await checkPython();
  if (hasPython) {
    await checkEdgeTTS();
  }

  await checkMiMo();

  console.log("\n── Summary ──");
  let allOk = true;
  for (const r of results) {
    const icon = r.status === "ok" ? "✅" : r.status === "warn" ? "⚠️" : "❌";
    console.log(`  ${icon} ${r.name}: ${r.message}`);
    if (r.status === "fail") allOk = false;
  }

  const passing = results.filter((r) => r.status === "ok").length;
  const total = results.length;
  console.log(`\n${passing}/${total} checks passing`);

  // Exit 1 if any critical failure, 0 otherwise
  const hasCritical = results.some((r) => r.status === "fail");
  process.exit(hasCritical ? 1 : 0);
}

main().catch((err) => {
  console.error("Health check crashed:", err);
  process.exit(1);
});
