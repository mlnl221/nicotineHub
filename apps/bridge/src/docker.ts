// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Opt-in self-recreate via the Docker Engine socket.
//
// Context: the Soulseek side of a port change needs no restart (session.ts
// setListenPort hot-swaps Bun.listen + reconnects with a new SetWaitPort).
// But a container's published host ports are immutable at runtime — only a
// container *recreate* applies a new mapping. When enabled (socket mounted +
// ALLOW_CONTAINER_RESTART=1), the bridge recreates itself after a UI port
// change so Settings → Network actually updates the whole bridge.
//
// Socket access is host-root-equivalent: never enabled by default, always
// behind BRIDGE_TOKEN auth at the HTTP layer (see server.ts).

import { existsSync, readFileSync } from "node:fs";
import { diagLog } from "./logger.ts";

export const DOCKER_SOCKET = process.env.DOCKER_SOCKET || "/var/run/docker.sock";

export function isContainerRestartEnabled(): boolean {
  return process.env.ALLOW_CONTAINER_RESTART === "1";
}

export function dockerSocketAvailable(): boolean {
  try {
    return existsSync(DOCKER_SOCKET);
  } catch {
    return false;
  }
}

// ponytail: cgroup parse covers cgroupv1+v2; HOSTNAME fallback covers plain `docker run`
export function getSelfContainerId(): string | null {
  if (process.env.CONTAINER_ID && /^[0-9a-f]{12,64}$/i.test(process.env.CONTAINER_ID)) {
    return process.env.CONTAINER_ID;
  }
  try {
    const cgroup = readFileSync("/proc/self/cgroup", "utf8");
    const m = cgroup.match(/[0-9a-f]{64}/) || cgroup.match(/docker[/-]([0-9a-f]{12,64})/);
    if (m) return m[1] ?? m[0];
  } catch {}
  const host = (process.env.HOSTNAME || "").trim();
  if (/^[0-9a-f]{12,64}$/i.test(host)) return host;
  return null;
}

type PortBinding = { HostIp?: string; HostPort?: string };
export type ContainerInspect = {
  Id: string;
  Name: string;
  Config: {
    Hostname?: string;
    Image: string;
    Env?: string[];
    Cmd?: string[] | null;
    Entrypoint?: string[] | null;
    Labels?: Record<string, string>;
    ExposedPorts?: Record<string, Record<string, never>>;
  };
  HostConfig: {
    Binds?: string[] | null;
    PortBindings?: Record<string, PortBinding[] | null> | null;
    RestartPolicy?: { Name?: string; MaximumRetryCount?: number };
    NetworkMode?: string;
  };
  Mounts?: Array<{ Type: string; Name?: string; Source: string; Destination: string; RW?: boolean }>;
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string }> };
  State?: { Running?: boolean };
};

function validPort(p: number): boolean {
  return Number.isInteger(p) && p >= 1024 && p <= 65535;
}

function dockerApi<T>(method: string, path: string, body?: unknown, timeoutMs = 15000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // ponytail: node:http + socketPath instead of a docker client dep
    const { request } = require("node:http") as typeof import("node:http");
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath: DOCKER_SOCKET,
        path,
        method,
        timeout: timeoutMs,
        headers: payload
          ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) }
          : {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          if (status >= 200 && status < 300) {
            if (!raw) return resolve(undefined as T);
            try {
              resolve(JSON.parse(raw) as T);
            } catch {
              resolve(raw as unknown as T);
            }
            return;
          }
          reject(new Error(`docker ${method} ${path} → ${status}: ${raw.slice(0, 300)}`));
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error(`docker ${method} ${path} timed out`)));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function inspectContainer(id: string): Promise<ContainerInspect> {
  return dockerApi<ContainerInspect>("GET", `/containers/${id}/json`);
}

/** Inspect this container via the socket (null outside a container / without socket). */
export async function inspectSelfContainer(): Promise<ContainerInspect | null> {
  const id = getSelfContainerId();
  if (!id || !dockerSocketAvailable()) return null;
  return inspectContainer(id);
}

/** Host ports currently published by this container (from its PortBindings). */
export function parseHostPorts(inspect: ContainerInspect): number[] {
  const out = new Set<number>();
  for (const [containerPort, bindings] of Object.entries(inspect.HostConfig?.PortBindings ?? {})) {
    for (const b of bindings ?? []) {
      const n = Number(b?.HostPort);
      if (Number.isInteger(n)) out.add(n);
    }
    void containerPort;
  }
  return [...out];
}

export function envListenPort(inspect: ContainerInspect): number | null {
  for (const e of inspect.Config?.Env ?? []) {
    const m = e.match(/^LISTEN_PORT=(\d+)$/);
    if (m) {
      const n = Number(m[1]);
      if (validPort(n)) return n;
    }
  }
  return null;
}

export type RecreatePlan = {
  oldId: string;
  oldName: string;
  newName: string;
  createBody: Record<string, unknown>;
  networks: string[];
};

/** Pure builder — unit-tested, no socket needed. Throws on invalid port. */
export function buildRecreatePayload(inspect: ContainerInspect, oldPort: number, newPort: number): RecreatePlan {
  if (!validPort(newPort)) throw new Error(`Invalid listen port ${newPort}: must be 1024-65535`);
  if ((inspect.HostConfig?.NetworkMode || "").toLowerCase() === "host") {
    throw new Error("host network: no port mapping to recreate (hot-swap already applies)");
  }
  const base = (inspect.Name || "").replace(/^\//, "") || "bridge";
  const newName = `${base}-port-${Date.now()}`.replace(/[^a-zA-Z0-9_.-]/g, "-");

  // Env: swap LISTEN_PORT so the new container boots on the new port
  const env = [...(inspect.Config?.Env ?? [])];
  const idx = env.findIndex((e) => e.startsWith("LISTEN_PORT="));
  if (idx >= 0) env[idx] = `LISTEN_PORT=${newPort}`;
  else env.push(`LISTEN_PORT=${newPort}`);

  // Binds: rebuild from resolved mounts (named volumes live in Mounts, not Binds)
  const binds: string[] = [];
  for (const m of inspect.Mounts ?? []) {
    if (!m.Destination) continue;
    const src = m.Type === "volume" ? m.Name || m.Source : m.Source;
    if (!src) continue;
    binds.push(`${src}:${m.Destination}:${m.RW === false ? "ro" : "rw"}`);
  }
  for (const b of inspect.HostConfig?.Binds ?? []) {
    if (!binds.includes(b)) binds.push(b);
  }

  // PortBindings: drop old listen-port mappings, add new TCP+UDP
  const bindings: Record<string, PortBinding[]> = {};
  for (const [cport, arr] of Object.entries(inspect.HostConfig?.PortBindings ?? {})) {
    const num = Number(cport.split("/")[0]);
    if (num === oldPort) continue;
    if (arr) bindings[cport] = arr;
  }
  bindings[`${newPort}/tcp`] = [{ HostIp: "", HostPort: String(newPort) }];
  bindings[`${newPort}/udp`] = [{ HostIp: "", HostPort: String(newPort) }];

  const exposed: Record<string, Record<string, never>> = { ...(inspect.Config?.ExposedPorts ?? {}) };
  for (const k of Object.keys(exposed)) {
    if (Number(k.split("/")[0]) === oldPort) delete exposed[k];
  }
  exposed[`${newPort}/tcp`] = {};

  const networks = Object.keys(inspect.NetworkSettings?.Networks ?? {});
  const endpoints: Record<string, Record<string, unknown>> = {};
  // Keep the compose service alias so same-origin web traffic (http://bridge:8787)
  // keeps resolving during the overlap and after the old container is removed.
  // Duplicate aliases on one network are allowed (DNS round-robins while both live).
  for (const n of networks) endpoints[n] = { Aliases: ["bridge"] };

  return {
    oldId: inspect.Id,
    oldName: base,
    newName,
    networks,
    createBody: {
      Hostname: inspect.Config?.Hostname || undefined,
      Image: inspect.Config.Image,
      Env: env,
      Cmd: inspect.Config?.Cmd ?? undefined,
      Entrypoint: inspect.Config?.Entrypoint ?? undefined,
      Labels: inspect.Config?.Labels ?? {},
      ExposedPorts: exposed,
      HostConfig: {
        Binds: binds.length ? binds : undefined,
        PortBindings: bindings,
        RestartPolicy: inspect.HostConfig?.RestartPolicy ?? { Name: "unless-stopped" },
      },
      NetworkingConfig: networks.length ? { EndpointsConfig: endpoints } : undefined,
    },
  };
}

let recreateInProgress = false;
let lastRecreate: { at: number; port: number; ok: boolean; error?: string } | null = null;

export function recreateStatus() {
  return {
    enabled: isContainerRestartEnabled(),
    socket: dockerSocketAvailable(),
    socketPath: DOCKER_SOCKET,
    inProgress: recreateInProgress,
    last: lastRecreate,
  };
}

async function waitForHealthy(containerId: string, inspect: ContainerInspect): Promise<void> {
  const deadline = Date.now() + 25000;
  // 1. wait for Running
  while (Date.now() < deadline) {
    try {
      const cur = await inspectContainer(containerId);
      if (cur.State?.Running) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  // 2. try its /health over the compose network, else time-based grace
  const nets = Object.values(inspect.NetworkSettings?.Networks ?? {});
  const ip = nets.map((n) => n.IPAddress).find(Boolean);
  if (ip) {
    const port = Number(process.env.PORT || 8787);
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://${ip}:${port}/health`, { signal: AbortSignal.timeout(2000) });
        if (res.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 1000));
    }
  } else {
    await new Promise((r) => setTimeout(r, 6000));
  }
}

/**
 * Recreate this container with a new LISTEN_PORT mapping. Fire-and-forget
 * friendly: resolves after the old container is stopped (WS drops here).
 */
export async function recreateSelfWithPort(
  newPort: number,
  oldPort?: number
): Promise<{ recreated: boolean; reason: string; container?: string }> {
  if (!isContainerRestartEnabled()) return { recreated: false, reason: "disabled (ALLOW_CONTAINER_RESTART!=1)" };
  if (!dockerSocketAvailable()) return { recreated: false, reason: `no socket at ${DOCKER_SOCKET}` };
  if (!validPort(newPort)) throw new Error(`Invalid listen port ${newPort}: must be 1024-65535`);
  if (recreateInProgress) return { recreated: false, reason: "recreate already in progress" };
  const selfId = getSelfContainerId();
  if (!selfId) return { recreated: false, reason: "not running in a container (no id found)" };

  recreateInProgress = true;
  try {
    const inspect = await inspectContainer(selfId);
    const prev = oldPort ?? envListenPort(inspect) ?? newPort;
    if (parseHostPorts(inspect).includes(newPort) && envListenPort(inspect) === newPort) {
      return { recreated: false, reason: `already mapped to ${newPort}` };
    }
    const plan = buildRecreatePayload(inspect, prev, newPort);
    diagLog("info", "bridge", `recreating container for port ${newPort}`, { old: plan.oldName, new: plan.newName });
    const created = await dockerApi<{ Id: string }>("POST", `/containers/create?name=${encodeURIComponent(plan.newName)}`, plan.createBody, 30000);
    await dockerApi("POST", `/containers/${created.Id}/start`, undefined, 30000);
    try {
      await waitForHealthy(created.Id, inspect);
    } catch (e) {
      diagLog("warn", "bridge", "new container health wait failed, proceeding to swap anyway", { error: (e as Error).message });
    }
    // Swap while this container is still alive: a container cannot orchestrate
    // its own stop-and-continue (POST stop SIGKILLs us mid-await, so anything
    // after it never runs). Rename the old container away first (frees the
    // service name), claim it for the new one, and force-remove the old last —
    // dying during that final call is fine, all real work is already done.
    const staleName = `${plan.oldName}-old`;
    try {
      await dockerApi("POST", `/containers/${plan.oldId}/rename?name=${encodeURIComponent(staleName)}`, undefined, 15000);
    } catch (e) {
      diagLog("warn", "bridge", "rename old container failed", { error: (e as Error).message });
    }
    // Claim the service name for the new container (retry: name release is async).
    // Routing already works via the service alias; this just keeps `docker ps` clean.
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        await dockerApi("POST", `/containers/${created.Id}/rename?name=${encodeURIComponent(plan.oldName)}`, undefined, 15000);
        break;
      } catch (e) {
        if (attempt === 4) {
          diagLog("warn", "bridge", "rename new container failed (service alias already routes traffic)", { error: (e as Error).message });
        } else {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
    // Best-effort and last: force-remove the (possibly still running) old
    // container. If this kills us mid-await, the swap is already complete.
    try {
      await dockerApi("DELETE", `/containers/${plan.oldId}?force=true&v=false`, undefined, 30000);
    } catch (e) {
      diagLog("warn", "bridge", "old container force-remove failed (leftover -old container is cosmetic)", { error: (e as Error).message });
    }
    lastRecreate = { at: Date.now(), port: newPort, ok: true };
    // This process dies with the old container from here.
    return { recreated: true, reason: `recreated as ${plan.newName}`, container: created.Id.slice(0, 12) };
  } catch (e) {
    const msg = (e as Error).message;
    lastRecreate = { at: Date.now(), port: newPort, ok: false, error: msg };
    throw e;
  } finally {
    recreateInProgress = false;
  }
}

/** Called after a successful UI port change — no-op unless socket mode applies. */
export async function maybeRecreateContainerForPort(newPort: number, oldPort: number): Promise<string> {
  if (!isContainerRestartEnabled() || !dockerSocketAvailable()) return "disabled";
  if (getSelfContainerId() === null) return "not-in-container";
  try {
    const r = await recreateSelfWithPort(newPort, oldPort);
    return r.recreated ? "started" : r.reason;
  } catch (e) {
    diagLog("warn", "bridge", "container recreate failed", { port: newPort, error: (e as Error).message });
    return `failed: ${(e as Error).message.slice(0, 160)}`;
  }
}
