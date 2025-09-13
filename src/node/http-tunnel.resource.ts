import { defineResource } from "../define";
import type { TunnelRunner } from "../globals/resources/tunnel/types";
import { globalResources } from "../globals/globalResources";
import type { Logger } from "../models/Logger";
import * as http from "http";
import * as https from "https";

export interface NodeHttpTunnelAuthConfig {
  header?: string; // default: x-runner-token
  token: string;
}

export interface NodeHttpTunnelConfig {
  baseUrl: string; // ex: http://localhost:7070/__runner
  auth?: NodeHttpTunnelAuthConfig;
  timeoutMs?: number; // optional request timeout
}

function postJson<T = any>(
  urlString: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  timeoutMs?: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const url = new URL(urlString);
    const lib = url.protocol === "https:" ? https : http;

    const data = Buffer.from(JSON.stringify(body));
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port ? Number(url.port) : undefined,
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-length": String(data.length),
          ...headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          try {
            const parsed = raw ? JSON.parse(raw) : undefined;
            resolve(parsed as T);
          } catch (e) {
            reject(new Error("Invalid JSON response"));
          }
        });
      },
    );

    req.on("error", reject);
    if (timeoutMs && timeoutMs > 0) {
      req.setTimeout(timeoutMs, () => {
        try {
          req.destroy(new Error("Request timeout"));
        } catch (_) {}
      });
    }
    req.write(data);
    req.end();
  });
}

export const nodeHttpTunnel = defineResource<
  NodeHttpTunnelConfig,
  Promise<TunnelRunner>,
  { logger: typeof globalResources.logger }
>({
  id: "platform.node.resources.httpTunnel",
  meta: {
    title: "Node HTTP Tunnel",
    description:
      "Client-side tunnel runner that calls a remote nodeExposure over HTTP JSON (POST-only).",
  },
  dependencies: { logger: globalResources.logger },
  async init(cfg, { logger }) {
    const baseUrl = (cfg?.baseUrl ?? "").replace(/\/$/, "");
    if (!baseUrl) throw new Error("nodeHttpTunnel requires baseUrl");

    const headerName = (cfg?.auth?.header ?? "x-runner-token").toLowerCase();
    const buildHeaders = () => {
      const headers: Record<string, string> = {};
      if (cfg?.auth?.token) headers[headerName] = cfg.auth.token;
      return headers;
    };

    return {
      run: async (t, input) => {
        const url = `${baseUrl}/task/${encodeURIComponent(t.id)}`;
        const r: any = await postJson(url, { input }, buildHeaders(), cfg?.timeoutMs);
        if (!r?.ok) {
          const msg = r?.error?.message ?? "Tunnel task error";
          try {
            (logger as Logger).error("tunnel.task.error", { id: t.id, message: msg });
          } catch (_) {}
          throw new Error(msg);
        }
        return r.result;
      },
      emit: async (emission) => {
        const url = `${baseUrl}/event/${encodeURIComponent(emission.id)}`;
        const r: any = await postJson(url, { payload: emission.data }, buildHeaders(), cfg?.timeoutMs);
        if (!r?.ok) {
          const msg = r?.error?.message ?? "Tunnel event error";
          try {
            (logger as Logger).error("tunnel.event.error", { id: emission.id, message: msg });
          } catch (_) {}
          throw new Error(msg);
        }
      },
    } satisfies TunnelRunner;
  },
});
