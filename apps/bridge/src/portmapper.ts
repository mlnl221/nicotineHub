// SPDX-FileCopyrightText: 2020-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Port of pynicotine/portmapper.py — UPnP only (ponytail: NATPMP removed, UPnP is homelab default; re-add NATPMP if UDP gateway needed)

import { createSocket } from "node:dgram";
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
  static readonly USER_AGENT = `Bun/1.4 UPnP/2.0 nicotineHub/0.1`;

  private service: { serviceType: string; controlUrl: string } | null = null;

  private static async getServiceControlUrl(locationUrl: string): Promise<{ serviceType: string | null; controlUrl: string | null }> {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), UPnP.HTTP_REQUEST_TIMEOUT);
      let res: Response;
      try {
        res = await fetch(locationUrl, { signal: controller.signal });
      } catch (e) {
        clearTimeout(t);
        throw e;
      }
      clearTimeout(t);
      // Read body even on non-2xx (python handles HTTPError body)
      const body = await res.text().catch(() => "");
      logger.debug("bridge", `UPnP: device description from ${locationUrl} status=${res.status}`, { body: body.slice(0, 800) });
      if (!body) return { serviceType: null, controlUrl: null };
      // Mirror python ElementTree namespace handling: look for service blocks, then check serviceType
      // Use regex but also handle XML with namespace prefixes; capture type and controlURL case-insensitively
      const serviceBlocks = body.match(/<service[\s\S]*?<\/service>/gi) || [];
      for (const block of serviceBlocks) {
        const typeMatch = block.match(/<serviceType>\s*([^<]+)\s*<\/serviceType>/i);
        const urlMatch = block.match(/<controlURL>\s*([^<]+)\s*<\/controlURL>/i);
        if (!typeMatch || !urlMatch) continue;
        const serviceType = typeMatch[1].trim();
        let controlUrl = urlMatch[1].trim();
        if (!["urn:schemas-upnp-org:service:WANIPConnection:2", "urn:schemas-upnp-org:service:WANIPConnection:1", "urn:schemas-upnp-org:service:WANPPPConnection:1"].includes(serviceType)) continue;
        // Resolve relative URL — python: location_url_base = scheme://netloc/ ; controlUrl.lstrip("/")
        const locationUrlParts = new URL(locationUrl);
        const locationUrlBase = `${locationUrlParts.protocol}//${locationUrlParts.host}/`;
        if (controlUrl.startsWith("/")) {
          controlUrl = locationUrlBase + controlUrl.slice(1);
        } else if (!controlUrl.startsWith(locationUrlBase)) {
          // Absolute URL allowed only if it starts with base (python check: if not startswith base → invalid)
          if (controlUrl.startsWith("http://") || controlUrl.startsWith("https://")) {
            logger.debug("bridge", `UPnP: Invalid control URL ${controlUrl} for service ${serviceType}, ignoring`);
            continue;
          }
          // relative without slash
          const base = locationUrl.slice(0, locationUrl.lastIndexOf("/") + 1);
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
    logger.debug("bridge", `UPnP: discovering, delay=${UPnP.MX_RESPONSE_DELAY}s via ${privateIp}`);
    const services = new Map<string, { serviceType: string; controlUrl: string }>();
    const locations = new Set<string>();
    return new Promise((resolve) => {
      const sock = createSocket({ type: "udp4", reuseAddr: true });
      let resolved = false;
      const doResolve = () => {
        if (resolved) return;
        resolved = true;
        try { sock.close(); } catch {}
        logger.debug("bridge", `UPnP: ${services.size} service(s) detected`);
        resolve(services);
      };
      const onMessage = async (msg: Buffer) => {
        try {
          const text = msg.toString("utf8");
          const resp = new SSDPResponse(text);
          logger.debug("bridge", "UPnP: M-SEARCH response", { header: text.slice(0, 400) });
          const loc = resp.headers["LOCATION"];
          if (!loc) {
            logger.debug("bridge", "UPnP: no LOCATION header", { headers: text.slice(0, 300) });
            return;
          }
          if (locations.has(loc)) {
            logger.debug("bridge", "UPnP: location already processed", { location: loc });
            return;
          }
          locations.add(loc);
          const { serviceType, controlUrl } = await UPnP.getServiceControlUrl(loc);
          if (!serviceType || !controlUrl) {
            logger.debug("bridge", "UPnP: no service in response", { location: loc });
            return;
          }
          logger.debug("bridge", `UPnP: found ${serviceType} at ${controlUrl}`);
          if (services.has(serviceType)) {
            logger.debug("bridge", "UPnP: service already added, ignoring", { serviceType });
            return;
          }
          services.set(serviceType, { serviceType, controlUrl });
        } catch {}
      };
      (sock as unknown as { on: (e:string, cb:(...a:unknown[])=>void)=>void }).on("message", onMessage as unknown as (...a:unknown[])=>void);
      (sock as unknown as { on: (e:string, cb:(a:unknown)=>void)=>void }).on("error", (e: unknown) => {
        logger.debug("bridge", "UPnP: socket error", { error: (e as Error).message });
      });
      (sock as unknown as { bind: (port:number, addr:string, cb:()=>void)=>void }).bind(0, privateIp, () => {
        try {
          try { (sock as unknown as { setMulticastInterface: (ip:string)=>void }).setMulticastInterface(privateIp); } catch {}
          try { (sock as unknown as { setMulticastTTL: (ttl:number)=>void }).setMulticastTTL(UPnP.MULTICAST_TTL); } catch {}
          try { (sock as unknown as { setBroadcast: (b:boolean)=>void }).setBroadcast(true); } catch {}
          try { (sock as unknown as { setMulticastLoopback?: (b:boolean)=>void }).setMulticastLoopback?.(true); } catch {}
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
      setTimeout(doResolve, (UPnP.MX_RESPONSE_DELAY + 0.5) * 1000 + 500);
      setTimeout(doResolve, 5500);
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
    let resText = "";
    let resStatus = 0;
    try {
      const res = await fetch(controlUrl, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(t);
      resStatus = res.status;
      resText = await res.text();
      logger.debug("bridge", "UPnP: AddPortMapping response", { status: resStatus, text: resText.slice(0, 1000) });
    } catch (e) {
      clearTimeout(t);
      if ((e as Error).name === "AbortError") throw new PortmapError("UPnP timeout");
      // fetch may throw with body in error — try to extract
      const msg = (e as Error).message;
      if (msg.includes("errorCode") || msg.includes("Envelope")) {
        const codeMatch = msg.match(/<errorCode>\s*([^<]+)\s*<\/errorCode>/i);
        const descMatch = msg.match(/<errorDescription>\s*([^<]+)\s*<\/errorDescription>/i);
        return { errorCode: codeMatch?.[1] ?? null, errorDescription: descMatch?.[1] ?? msg };
      }
      throw e;
    }
    // Parse errorCode/errorDescription like python ElementTree findtext with control-1-0 ns
    const codeMatch = resText.match(/<errorCode>\s*([^<]+)\s*<\/errorCode>/i);
    const descMatch = resText.match(/<errorDescription>\s*([^<]+)\s*<\/errorDescription>/i);
    const errorCode = codeMatch ? codeMatch[1].trim() : null;
    const errorDescription = descMatch ? descMatch[1].trim() : null;
    // Validate Body exists like python: xml.find("...Body") is None → PortmapError invalid response
    if (!resText.includes("Body") && !errorCode) throw new PortmapError(`Invalid response: ${resText.slice(0, 500)}`);
    return { errorCode, errorDescription };
  }

  async addPortMapping(leaseDuration: number): Promise<void> {
    if (this.port == null || this.localIpAddress == null) throw new PortmapError("No port/ip");
    if (this.localIpAddress === "0.0.0.0") throw new PortmapError("Local IP is 0.0.0.0, skipping UPnP (container bridge — use host network or set interface)");
    this.service = await this.findService(this.localIpAddress);
    if (!this.service) throw new PortmapError("No UPnP devices found");
    logger.debug("bridge", `UPnP: trying redirect ${this.port} TCP => ${this.localIpAddress}:${this.port}`);
    let { errorCode, errorDescription } = await this.requestPortMapping(this.port, this.localIpAddress, this.port, "NicotinePlus", leaseDuration);
    // MikroTik permanent lease workaround (error 725) — python recurses with lease 0
    if (errorCode === "725" && leaseDuration > 0) {
      logger.debug("bridge", "UPnP: router requested permanent lease, retrying with 0");
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
    // Null service before request like python (self._service = None before)
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
      logger.debug("bridge", "UPnP: DeletePortMapping response", { status: res.status, text: text.slice(0, 500) });
    } catch (e) {
      clearTimeout(t);
      logger.debug("bridge", "UPnP: DeletePortMapping failed (ignored)", { error: (e as Error).message });
    }
  }
}

// ── PortMapper orchestrator (mirrors pynicotine/portmapper.py PortMapper) ──

export class PortMapper {
  private activeImplementation: UPnP | null = null;
  private hasPort = false;
  private isMappingPort = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private upnp = new UPnP();
  private currentPort: number | null = null;
  private currentIp: string | null = null;
  private lastError: string | null = null;
  private lastSuccessAt: number | null = null;
  private lastAttemptAt: number | null = null;

  static readonly RENEWAL_INTERVAL = 7200 * 1000; // 2h ms
  static readonly LEASE_DURATION = 43200; // 12h seconds

  private async waitUntilReady() {
    while (this.isMappingPort) await new Promise((r) => setTimeout(r, 100));
  }

  private async addPortMappingInternal(): Promise<void> {
    await this.waitUntilReady();
    this.isMappingPort = true;
    this.lastAttemptAt = Date.now();
    logger.debug("bridge", "Creating Port Mapping rule… (UPnP)");
    try {
      this.activeImplementation = this.upnp;
      await this.upnp.addPortMapping(PortMapper.LEASE_DURATION);
      this.lastError = null;
      this.lastSuccessAt = Date.now();
    } catch (upnpErr) {
      const msg = (upnpErr as Error).message;
      logger.warn("bridge", `${this.activeImplementation?.constructor.name || "UPnP"}: Failed to forward external port ${this.activeImplementation?.port}: ${msg}`, { error: msg });
      if (msg !== "No UPnP devices found" && !msg.includes("0.0.0.0")) {
        logger.debug("bridge", (upnpErr as Error).stack || msg);
      }
      this.lastError = msg;
      this.activeImplementation = null;
      this.isMappingPort = false;
      return;
    }
    const impl = this.activeImplementation;
    logger.info("bridge", `${(impl as unknown as { constructor: { NAME: string } })?.constructor?.NAME || impl?.constructor.name}: External port ${impl?.port} successfully forwarded to local IP ${impl?.localIpAddress} port ${impl?.port}`, {
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
      logger.info("bridge", "Port mapping removed", { port: this.activeImplementation.port, protocol: (this.activeImplementation as unknown as { constructor: { NAME: string } }).constructor.NAME });
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
    try { (this.timer as unknown as { unref?: () => void }).unref?.(); } catch {}
  }

  private cancelRenewalTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  setPort(port: number | null, localIpAddress: string | null) {
    this.upnp.setPort(port, localIpAddress);
    this.currentPort = port;
    this.currentIp = localIpAddress;
    this.hasPort = port != null;
    if (port != null) this.lastError = null;
  }

  /**
   * Add port mapping (NAT-PMP → UPnP fallback). If config upnp disabled, caller should not call.
   * @param blocking if true, await completion; else fire-and-forget
   */
  async addPortMapping(blocking = false): Promise<void> {
    if (!this.hasPort) return;
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
  get status(): { active: string | null; port: number | null; ip: string | null; error: string | null; lastSuccessAt: number | null; lastAttemptAt: number | null; hasPort: boolean } {
    return {
      active: this.activeName,
      port: this.mappedPort,
      ip: this.mappedIp,
      error: this.lastError,
      lastSuccessAt: this.lastSuccessAt,
      lastAttemptAt: this.lastAttemptAt,
      hasPort: this.hasPort,
    };
  }
  get lastErrorMessage(): string | null { return this.lastError; }
}
