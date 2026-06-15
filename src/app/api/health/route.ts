import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { prisma } from "@/lib/db";

const execFileAsync = promisify(execFile);

interface HealthStatus {
  status: "ok" | "degraded" | "error";
  uptime: number;
  timestamp: string;
  checks: Record<string, { status: string; message?: string; latencyMs?: number }>;
}

/**
 * GET /api/health
 *
 * Returns system health status for Docker/K8s liveness/readiness probes.
 * Checks: database connectivity, ffmpeg availability, memory usage.
 */
export async function GET(): Promise<NextResponse> {
  const checks: HealthStatus["checks"] = {};
  let overall: HealthStatus["status"] = "ok";

  // 1. Database check
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { status: "ok", latencyMs: Date.now() - dbStart };
  } catch (err) {
    checks.database = {
      status: "error",
      message: err instanceof Error ? err.message : "db connection failed",
    };
    overall = "error";
  }

  // 2. ffmpeg check
  const ffStart = Date.now();
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5000 });
    checks.ffmpeg = { status: "ok", latencyMs: Date.now() - ffStart };
  } catch (err) {
    checks.ffmpeg = {
      status: "error",
      message: err instanceof Error ? err.message : "ffmpeg not found",
    };
    overall = "degraded";
  }

  // 3. Memory check
  const used = process.memoryUsage();
  const heapUsedMB = Math.round(used.heapUsed / 1024 / 1024);
  const heapTotalMB = Math.round(used.heapTotal / 1024 / 1024);
  const rssMB = Math.round(used.rss / 1024 / 1024);
  checks.memory = {
    status: heapUsedMB / heapTotalMB > 0.9 ? "degraded" : "ok",
    message: `heap: ${heapUsedMB}/${heapTotalMB}MB, rss: ${rssMB}MB`,
  };

  return NextResponse.json(
    {
      status: overall,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      checks,
    },
    { status: overall === "error" ? 503 : 200 }
  );
}
