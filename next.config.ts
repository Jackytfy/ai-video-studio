import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "better-sqlite3",
    "bindings",
    "file-uri-to-path",
    "@prisma/adapter-better-sqlite3",
    "@prisma/client",
    ".prisma/client",
    "puppeteer-core",
  ],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        child_process: false,
        fs: false,
        path: false,
        os: false,
        crypto: false,
        stream: false,
      };
    } else {
      // Exclude all Node.js builtins from server-side bundling
      const nodeBuiltins = new Set([
        "assert", "async_hooks", "buffer", "child_process", "cluster",
        "console", "constants", "crypto", "dgram", "dns", "domain",
        "events", "fs", "fs/promises", "http", "http2", "https",
        "inspector", "module", "net", "os", "path", "perf_hooks",
        "process", "punycode", "querystring", "readline", "repl",
        "stream", "stream/promises", "string_decoder", "sys", "timers",
        "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi",
        "worker_threads", "zlib",
      ]);
      config.externals = [
        ...((Array.isArray(config.externals) ? config.externals : config.externals ? [config.externals] : []) as any[]),
        ({ request }: { request: string }, callback: any) => {
          const mod = request.replace(/^node:/, "").split("/")[0];
          if (nodeBuiltins.has(mod)) {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        },
      ];
    }
    return config;
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
