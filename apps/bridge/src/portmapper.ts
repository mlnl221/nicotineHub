// SPDX-FileCopyrightText: 2020-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 nicotine-mobile Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Port of pynicotine/portmapper.py (719 lines) to Bun/TS — NAT-PMP (RFC6886) + UPnP (IGDv1/v2)

import { createSocket } from "node:dgram";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { logger } from "./logger.ts";

export class PortmapError extends Error {}

abstract class BaseImplementation {
  port: number | null = null;
  localIpAddress: string | null = null;
  setPort(port: number | null, localIpAddress: string | null) {
    this.port = port;
    this.localIpAddress = localIpAddress;
  }
}

// ── NAT-PMP (RFC6886) ──

export class NATPMP extends BaseImplementation {
  static readonly NAME = "NAT-PMP";
  static readonly REQUEST_PORT = 5351;
  static readonly REQUEST_ATTEMPTS = 2;
  static readonly REQUEST_INIT_TIMEOUT = 0.25; // seconds
  static readonly SUCCESS_RESULT = 0;

  private gatewayAddress: string | null = null;

  private static getGatewayAddress(): string | null {
    // Linux: /proc/net/route
    try {
      if (process.platform === "linux" && existsSync("/proc/net/route")) {
        const raw = readFileSync("/proc/net/route", "utf8");
        const lines = raw.split("\n").slice(1);
        for (const line of lines) {
          const routes = line.trim().split(/\s+/);
          if (routes.length < 3) continue;
          const destHex = routes[1];
          const gateHex = routes[2];
          const dest = ((parseInt(destHex, 16) >>> 0) & 0xffffffff);
          // dest 0.0.0.0 is gateway
          const destIp = `${dest & 0xff}.${(dest >>> 8) & 0xff}.${(dest >>> 16) & 0xff}.${(dest >>> 24) & 0xff}`;
          if (destIp !== "0.0.0.0") continue;
          const gate = parseInt(gateHex, 16) >>> 0;
          const gateIp = `${gate & 0xff}.${(gate >>> 8) & 0xff}.${(gate >>> 16) & 0xff}.${(gate >>> 24) & 0xff}`;
          if (gateIp && gateIp !== "0.0.0.0") return gateIp;
        }
      }
    } catch {}
    // Fallback: netstat -rn
    try {
      const out = spawnSync("netstat", ["-rn"], { encoding: "utf8", timeout: 2000 });
      const text = (out.stdout as string) || "";
      // Linux: default via gateway, macOS/BSD: default gateway, Windows: 0.0.0.0 0.0.0.0 gateway
      const lines = text.split("\n");
      for (const line of lines) {
        if (/^(default|0\.0\.0\.0)/.test(line.trim())) {
          const parts = line.trim().split(/\s+/);
          // gateway is typically 2nd or 3rd field
          for (const p of parts) {
            if (/^\d+\.\d+\.\d+\.\d+$/.test(p) && p !== "0.0.0.0") return p;
          }
        }
      }
      // Windows pattern
      const m = text.match(/0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)/);
      if (m) return m[1];
    } catch {}
    return null;
  }

  private async requestPortMapping(publicPort: number, privatePort: number, leaseDuration: number): Promise<number | null> {
    if (!this.localIpAddress) throw new PortmapError("No local IP");
    if (!this.gatewayAddress) throw new PortmapError("No gateway");
    return new Promise((resolve) => {
      const sock = createSocket("udp4");
      let timeoutMs = NATPMP.REQUEST_INIT_TIMEOUT * 1000;
      let attempt = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const gateway = this.gatewayAddress!;
      const trySend = () => {
        attempt += 1;
        const buf = Buffer.alloc(12);
        buf.writeUInt8(0, 0); // VERSION
        buf.writeUInt8(2, 1); // TCP_OP_CODE
        buf.writeUInt16BE(0, 2); // RESERVED
        buf.writeUInt16BE(privatePort, 4);
        buf.writeUInt16BE(publicPort, 6);
        buf.writeUInt32BE(leaseDuration, 8);
        try { sock.send(buf, NATPMP.REQUEST_PORT, gateway); } catch {}
        logger.debug("bridge", `NAT-PMP: attempt ${attempt}/${NATPMP.REQUEST_ATTEMPTS} to ${gateway}:${NATPMP.REQUEST_PORT}`, { publicPort, privatePort, leaseDuration });
        timer = setTimeout(() => {
          if (attempt >= NATPMP.REQUEST_ATTEMPTS) {
            sock.close();
            logger.debug("bridge", "NAT-PMP: all attempts timed out");
            resolve(null);
          } else {
            timeoutMs *= 2;
            trySend();
          }
        }, timeoutMs);
        // wait for response via sock 'message' handler
      };
      sock.on("message", (msg) => {
        if (timer) clearTimeout(timer);
        if (msg.length < 16) {
          sock.close();
          resolve(null);
          return;
        }
        // unpack !BBHIHHI
        const result = msg.readUInt16BE(2);
        sock.close();
        resolve(result);
      });
      sock.on("error", () => {
        if (timer) clearTimeout(timer);
        sock.close();
        resolve(null);
      });
      try { sock.bind(0, this.localIpAddress ?? undefined, () => trySend()); } catch {
        sock.close();
        resolve(null);
      }
      // safety overall timeout
      setTimeout(() => {
        try { sock.close(); } catch {}
        resolve(null);
      }, 4000);
    });
  }

  async addPortMapping(leaseDuration: number): Promise<void> {
    if (this.port == null || this.localIpAddress == null) throw new PortmapError("No port/ip");
    this.gatewayAddress = NATPMP.getGatewayAddress();
    if (!this.gatewayAddress) throw new PortmapError("No gateway found for NAT-PMP");
    const result = await this.requestPortMapping(this.port, this.port, leaseDuration);
    if (result !== NATPMP.SUCCESS_RESULT) throw new PortmapError(`NAT-PMP error code ${result}`);
  }

  async removePortMapping(): Promise<void> {
    if (this.port == null) return;
    // gateway may be null after earlier failure, rediscover if needed
    if (!this.gatewayAddress) this.gatewayAddress = NATPMP.getGatewayAddress();
    const result = await this.requestPortMapping(0, this.port, 0);
    this.gatewayAddress = null;
    if (result !== NATPMP.SUCCESS_RESULT) throw new PortmapError(`NAT-PMP error code ${result}`);
  }
}

// ── UPnP (IGDv1/v2) ──

type SSDPHeaders = Record<string, string>;

class SSDPResponse {
  headers: SSDPHeaders = {};
  message: string;
  constructor(message: string) {
    this.message = message;
    const lines = message.split("\r\n").slice(1);
    for (const line of lines) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const k = line.slice(0, idx).trim().toUpperCase();
      const v = line.slice(idx + 1).trim();
      if (k) this.headers[k] = v;
    }
  }
}

export class UPnP extends BaseImplementation {
  static readonly NAME = "UPnP";
  static readonly MULTICAST_HOST = "239.255.255.250";
  static readonly MULTICAST_PORT = 1900;
  static readonly MULTICAST_TTL = 2;
  static readonly MX_RESPONSE_DELAY = 1;
  static readonly HTTP_REQUEST_TIMEOUT = 5000;
  static readonly USER_AGENT = `Bun/1.4 UPnP/2.0 nicotine-mobile/0.1`;

  private service: { serviceType: string; controlUrl: string } | null = null;

  private static async getServiceControlUrl(locationUrl: string): Promise<{ serviceType: string | null; controlUrl: string | null }> {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), UPnP.HTTP_REQUEST_TIMEOUT);
      const res = await fetch(locationUrl, { signal: controller.signal });
      clearTimeout(t);
      const body = await res.text();
      logger.debug("bridge", `UPnP: device description from ${locationUrl}`, { body: body.slice(0, 800) });
      // Simple XML parsing via regex (avoid heavy xml parser)
      // Find <service> blocks
      const serviceBlocks = body.match(/<service[\s\S]*?<\/service>/gi) || [];
      for (const block of serviceBlocks) {
        const typeMatch = block.match(/<serviceType>\s*([^<]+)\s*<\/serviceType>/i);
        const urlMatch = block.match(/<controlURL>\s*([^<]+)\s*<\/controlURL>/i);
        if (!typeMatch || !urlMatch) continue;
        const serviceType = typeMatch[1].trim();
        let controlUrl = urlMatch[1].trim();
        if (!["urn:schemas-upnp-org:service:WANIPConnection:2", "urn:schemas-upnp-org:service:WANIPConnection:1", "urn:schemas-upnp-org:service:WANPPPConnection:1"].includes(serviceType)) continue;
        // Resolve relative URL
        if (controlUrl.startsWith("/")) {
          const u = new URL(locationUrl);
          controlUrl = `${u.protocol}//${u.host}${controlUrl}`;
        } else if (!controlUrl.startsWith("http")) {
          // relative without slash
          const u = new URL(locationUrl);
          const base = u.href.slice(0, u.href.lastIndexOf("/") + 1);
          controlUrl = base + controlUrl;
        }
        return { serviceType, controlUrl };
      }
    } catch (e) {
      logger.debug("bridge", `UPnP: invalid device description from ${locationUrl}`, { error: (e as Error).message });
    }
    return { serviceType: null, controlUrl: null };
  }

  private static async getServices(privateIp: string): Promise<Map<string, { serviceType: string; controlUrl: string }>> {
    logger.debug("bridge", `UPnP: discovering, delay=${UPnP.MX_RESPONSE_DELAY}s`);
    const services = new Map<string, { serviceType: string; controlUrl: string }>();
    const locations = new Set<string>();
    return new Promise((resolve) => {
      const sock = createSocket({ type: "udp4", reuseAddr: true });
      const onMessage = async (msg: Buffer) => {
        try {
          const text = msg.toString("utf8");
          const resp = new SSDPResponse(text);
          logger.debug("bridge", "UPnP: M-SEARCH response", { header: text.slice(0, 300) });
          const loc = resp.headers["LOCATION"];
          if (!loc) {
            logger.debug("bridge", "UPnP: no LOCATION header");
            return;
          }
          if (locations.has(loc)) return;
          locations.add(loc);
          const { serviceType, controlUrl } = await UPnP.getServiceControlUrl(loc);
          if (!serviceType || !controlUrl) {
            logger.debug("bridge", "UPnP: no service in response");
            return;
          }
          logger.debug("bridge", `UPnP: found ${serviceType} at ${controlUrl}`);
          if (services.has(serviceType)) return;
          services.set(serviceType, { serviceType, controlUrl });
        } catch {}
      };
      sock.on("message", onMessage);
      sock.on("error", () => {});
      sock.bind(0, privateIp, () => {
        try {
          // set multicast interface and ttl
          try { sock.setMulticastInterface(privateIp); } catch {}
          try { sock.setMulticastTTL(UPnP.MULTICAST_TTL); } catch {}
          try { sock.setBroadcast(true); } catch {}
          const mkRequest = (st: string) => {
            const headers = [
              "M-SEARCH * HTTP/1.1",
              `HOST: ${UPnP.MULTICAST_HOST}:${UPnP.MULTICAST_PORT}`,
              `ST: ${st}`,
              `MAN: "ssdp:discover"`,
              `MX: ${UPnP.MX_RESPONSE_DELAY}`,
              `USER-AGENT: ${UPnP.USER_AGENT}`,
              "", "",
            ].join("\r\n");
            return Buffer.from(headers);
          };
          const targets = [
            "urn:schemas-upnp-org:device:InternetGatewayDevice:2",
            "urn:schemas-upnp-org:service:WANIPConnection:2",
            "urn:schemas-upnp-org:device:InternetGatewayDevice:1",
            "urn:schemas-upnp-org:service:WANIPConnection:1",
            "urn:schemas-upnp-org:service:WANPPPConnection:1",
          ];
          for (const t of targets) {
            try { sock.send(mkRequest(t), UPnP.MULTICAST_PORT, UPnP.MULTICAST_HOST); } catch {}
          }
        } catch {}
      });
      setTimeout(() => {
        try { sock.close(); } catch {}
        logger.debug("bridge", `UPnP: ${services.size} service(s) detected`);
        resolve(services);
      }, (UPnP.MX_RESPONSE_DELAY + 0.5) * 1000 + 500);
      // safety
      setTimeout(() => { try { sock.close(); } catch {} }, 5000);
    });
  }

  private async findService(privateIp: string) {
    const services = await UPnP.getServices(privateIp);
    let s = services.get("urn:schemas-upnp-org:service:WANIPConnection:2");
    if (!s) s = services.get("urn:schemas-upnp-org:service:WANIPConnection:1");
    if (!s) s = services.get("urn:schemas-upnp-org:service:WANPPPConnection:1");
    return s || null;
  }

  private async requestPortMapping(publicPort: number, privateIp: string, privatePort: number, mappingDescription: string, leaseDuration: number): Promise<{ errorCode: string | null; errorDescription: string | null }> {
    if (!this.service) throw new PortmapError("No UPnP service");
    const serviceType = this.service.serviceType;
    const controlUrl = this.service.controlUrl;
    logger.debug("bridge", `UPnP: AddPortMapping ${privateIp}:${privatePort} -> ${publicPort} at ${controlUrl}`);
    const headers: Record<string, string> = {
      Host: new URL(controlUrl).host,
      "Content-Type": "text/xml; charset=utf-8",
      "USER-AGENT": UPnP.USER_AGENT,
      SOAPACTION: `"${serviceType}#AddPortMapping"`,
    };
    const body = (
      '<?xml version="1.0"?>\r\n' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
      "<s:Body>" +
      `<u:AddPortMapping xmlns:u="${serviceType}">` +
      "<NewRemoteHost></NewRemoteHost>" +
      `<NewExternalPort>${publicPort}</NewExternalPort>` +
      "<NewProtocol>TCP</NewProtocol>" +
      `<NewInternalPort>${privatePort}</NewInternalPort>` +
      `<NewInternalClient>${privateIp}</NewInternalClient>` +
      "<NewEnabled>1</NewEnabled>" +
      `<NewPortMappingDescription>${mappingDescription}</NewPortMappingDescription>` +
      `<NewLeaseDuration>${leaseDuration}</NewLeaseDuration>` +
      "</u:AddPortMapping>" +
      "</s:Body>" +
      "</s:Envelope>\r\n"
    );
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), UPnP.HTTP_REQUEST_TIMEOUT);
    try {
      const res = await fetch(controlUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(t);
      const text = await res.text();
      logger.debug("bridge", "UPnP: AddPortMapping response", { text: text.slice(0, 1000) });
      const codeMatch = text.match(/<errorCode>\s*([^<]+)\s*<\/errorCode>/i);
      const descMatch = text.match(/<errorDescription>\s*([^<]+)\s*<\/errorDescription>/i);
      const errorCode = codeMatch ? codeMatch[1].trim() : null;
      const errorDescription = descMatch ? descMatch[1].trim() : null;
      // Also check for missing Body
      if (!text.includes("Body") && !errorCode) throw new PortmapError(`Invalid response: ${text.slice(0, 500)}`);
      return { errorCode, errorDescription };
    } catch (e) {
      clearTimeout(t);
      if ((e as Error).name === "AbortError") throw new PortmapError("UPnP timeout");
      // Try to parse HTTPError body if available
      const msg = (e as Error).message;
      if (msg.includes("errorCode")) {
        const codeMatch = msg.match(/<errorCode>\s*([^<]+)\s*<\/errorCode>/i);
        const descMatch = msg.match(/<errorDescription>\s*([^<]+)\s*<\/errorDescription>/i);
        return { errorCode: codeMatch?.[1] ?? null, errorDescription: descMatch?.[1] ?? msg };
      }
      throw e;
    }
  }

  async addPortMapping(leaseDuration: number): Promise<void> {
    if (this.port == null || this.localIpAddress == null) throw new PortmapError("No port/ip");
    this.service = await this.findService(this.localIpAddress);
    if (!this.service) throw new PortmapError("No UPnP devices found");
    logger.debug("bridge", `UPnP: trying redirect ${this.port} TCP => ${this.localIpAddress}:${this.port}`);
    let { errorCode, errorDescription } = await this.requestPortMapping(this.port, this.localIpAddress, this.port, "NicotinePlus", leaseDuration);
    if (errorCode === "725" && leaseDuration > 0) {
      logger.debug("bridge", "UPnP: router requested permanent lease");
      const ret = await this.requestPortMapping(this.port, this.localIpAddress, this.port, "NicotinePlus", 0);
      errorCode = ret.errorCode;
      errorDescription = ret.errorDescription;
    }
    if (errorCode || errorDescription) throw new PortmapError(`Error code ${errorCode}: ${errorDescription}`);
  }

  async removePortMapping(): Promise<void> {
    if (!this.service || this.port == null) return;
    const serviceType = this.service.serviceType;
    const controlUrl = this.service.controlUrl;
    this.service = null;
    const headers: Record<string, string> = {
      Host: new URL(controlUrl).host,
      "Content-Type": "text/xml; charset=utf-8",
      SOAPACTION: `"${serviceType}#DeletePortMapping"`,
    };
    const body = (
      '<?xml version="1.0"?>\r\n' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
      "<s:Body>" +
      `<u:DeletePortMapping xmlns:u="${serviceType}">` +
      "<NewRemoteHost></NewRemoteHost>" +
      `<NewExternalPort>${this.port}</NewExternalPort>` +
      "<NewProtocol>TCP</NewProtocol>" +
      "</u:DeletePortMapping>" +
      "</s:Body>" +
      "</s:Envelope>\r\n"
    );
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), UPnP.HTTP_REQUEST_TIMEOUT);
    try {
      const res = await fetch(controlUrl, { method: "POST", headers, body, signal: controller.signal });
      clearTimeout(t);
      const text = await res.text();
      logger.debug("bridge", "UPnP: DeletePortMapping response", { text: text.slice(0, 500) });
    } catch {}
    clearTimeout(t);
  }
}

// ── PortMapper orchestrator (mirrors pynicotine/portmapper.py PortMapper) ──

export class PortMapper {
  private activeImplementation: NATPMP | UPnP | null = null;
  private hasPort = false;
  private isMappingPort = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private natpmp = new NATPMP();
  private upnp = new UPnP();
  // Keep instance port/ip for renewal
  private currentPort: number | null = null;
  private currentIp: string | null = null;

  static readonly RENEWAL_INTERVAL = 7200 * 1000; // 2h ms
  static readonly LEASE_DURATION = 43200; // 12h seconds

  private async waitUntilReady() {
    while (this.isMappingPort) await new Promise((r) => setTimeout(r, 100));
  }

  private async addPortMappingInternal(): Promise<void> {
    await this.waitUntilReady();
    // Check upnp enabled via caller config; we assume caller checks config
    this.isMappingPort = true;
    logger.debug("bridge", "Creating Port Mapping rule…");
    try {
      this.activeImplementation = this.natpmp;
      await this.natpmp.addPortMapping(PortMapper.LEASE_DURATION);
    } catch (natErr) {
      logger.debug("bridge", `NAT-PMP failed, falling back to UPnP: ${natErr}`);
      try {
        this.activeImplementation = this.upnp;
        await this.upnp.addPortMapping(PortMapper.LEASE_DURATION);
      } catch (upnpErr) {
        const msg = (upnpErr as Error).message;
        logger.warn("bridge", `${this.activeImplementation?.constructor.name || "UPnP"}: Failed to forward external port ${this.activeImplementation?.port}: ${msg}`, { error: msg });
        if (msg !== "No UPnP devices found") {
          logger.debug("bridge", (upnpErr as Error).stack || msg);
        }
        this.activeImplementation = null;
        this.isMappingPort = false;
        return;
      }
    }
    const impl = this.activeImplementation;
    logger.info("bridge", `${impl?.constructor.name}: External port ${impl?.port} successfully forwarded to local IP ${impl?.localIpAddress} port ${impl?.port}`, {
      protocol: (impl as unknown as { constructor: { NAME: string } })?.constructor?.NAME || impl?.constructor.name,
      external_port: impl?.port,
      ip_address: impl?.localIpAddress,
      local_port: impl?.port,
    });
    this.isMappingPort = false;
  }

  private async removePortMappingInternal(): Promise<void> {
    await this.waitUntilReady();
    if (!this.activeImplementation) return;
    this.isMappingPort = true;
    try {
      await this.activeImplementation.removePortMapping();
      logger.info("bridge", "Port mapping removed", { port: this.activeImplementation.port });
    } catch (e) {
      logger.debug("bridge", `${this.activeImplementation.constructor.name}: Failed to remove port mapping: ${e}`);
    }
    this.activeImplementation = null;
    this.isMappingPort = false;
  }

  private startRenewalTimer() {
    this.cancelRenewalTimer();
    this.timer = setTimeout(() => {
      this.addPortMapping().catch(() => {});
    }, PortMapper.RENEWAL_INTERVAL);
    // Allow process to exit even if timer pending
    try { (this.timer as unknown as { unref?: () => void }).unref?.(); } catch {}
  }

  private cancelRenewalTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  setPort(port: number | null, localIpAddress: string | null) {
    this.natpmp.setPort(port, localIpAddress);
    this.upnp.setPort(port, localIpAddress);
    this.currentPort = port;
    this.currentIp = localIpAddress;
    this.hasPort = port != null;
  }

  /**
   * Add port mapping (NAT-PMP → UPnP fallback). If config upnp disabled, caller should not call.
   * @param blocking if true, await completion; else fire-and-forget
   */
  async addPortMapping(blocking = false): Promise<void> {
    if (!this.hasPort) return;
    // Caller should check upnp enabled; we also guard via hasPort
    if (blocking) {
      await this.addPortMappingInternal();
    } else {
      this.addPortMappingInternal().catch(() => {});
    }
    this.startRenewalTimer();
  }

  async removePortMapping(blocking = false): Promise<void> {
    this.cancelRenewalTimer();
    if (blocking) {
      await this.removePortMappingInternal();
    } else {
      this.removePortMappingInternal().catch(() => {});
    }
  }

  /** For diagnostics: current mapped port/ip */
  get mappedPort(): number | null { return this.currentPort; }
  get mappedIp(): string | null { return this.currentIp; }
  get activeName(): string | null { return this.activeImplementation ? (this.activeImplementation as unknown as { constructor: { NAME: string } }).constructor.NAME : null; }
}
