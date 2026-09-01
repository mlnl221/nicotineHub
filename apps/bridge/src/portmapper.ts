// SPDX-FileCopyrightText: 2020-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// ponytail: simplified PortMapper — NAT-PMP/UPnP auto-forward stubbed, manual forward via docs

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

export class NATPMP extends BaseImplementation {
  static readonly NAME = "NAT-PMP";
  static readonly REQUEST_PORT = 5351;
  static readonly REQUEST_ATTEMPTS = 2;
  static readonly REQUEST_INIT_TIMEOUT = 0.25;
  static readonly SUCCESS_RESULT = 0;
  private gatewayAddress: string | null = null;
  private static getGatewayAddress(): string | null {
    // ponytail: gateway detection removed — return null (manual forward)
    return null;
  }
  static _testGetGatewayAddress = NATPMP.getGatewayAddress;
  private async requestPortMapping(publicPort: number, privatePort: number, leaseDuration: number): Promise<number | null> {
    throw new PortmapError("NATPMP stubbed — manual port forward required");
  }
  async addPortMapping(leaseDuration: number): Promise<void> {
    if (this.port == null || this.localIpAddress == null) throw new PortmapError("No port/ip");
    if (this.localIpAddress === "0.0.0.0") throw new PortmapError("Local IP is 0.0.0.0, skipping NAT-PMP (use host network or set interface)");
    this.gatewayAddress = NATPMP.getGatewayAddress();
    if (!this.gatewayAddress) throw new PortmapError("No gateway found for NAT-PMP");
    const result = await this.requestPortMapping(this.port, this.port, leaseDuration);
    if (result !== NATPMP.SUCCESS_RESULT) throw new PortmapError(`NAT-PMP error code ${result}`);
  }
  async removePortMapping(): Promise<void> {
    if (this.port == null) return;
    if (this.localIpAddress === "0.0.0.0") { this.gatewayAddress = null; return; }
    if (!this.gatewayAddress) this.gatewayAddress = NATPMP.getGatewayAddress();
    if (!this.gatewayAddress) { this.gatewayAddress = null; return; }
    const result = await this.requestPortMapping(0, this.port, 0);
    this.gatewayAddress = null;
    if (result !== NATPMP.SUCCESS_RESULT) throw new PortmapError(`NAT-PMP error code ${result}`);
  }
}

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
      try { res = await fetch(locationUrl, { signal: controller.signal }); } catch (e) { clearTimeout(t); throw e; }
      clearTimeout(t);
      const body = await res.text().catch(() => "");
      logger.debug("bridge", `UPnP: device description from ${locationUrl} status=${res.status}`, { body: body.slice(0, 800) });
      if (!body) return { serviceType: null, controlUrl: null };
      const serviceBlocks = body.match(/<service[\s\S]*?<\/service>/gi) || [];
      for (const block of serviceBlocks) {
        const typeMatch = block.match(/<serviceType>\s*([^<]+)\s*<\/serviceType>/i);
        const urlMatch = block.match(/<controlURL>\s*([^<]+)\s*<\/controlURL>/i);
        if (!typeMatch || !urlMatch) continue;
        const serviceType = typeMatch[1].trim();
        let controlUrl = urlMatch[1].trim();
        if (!["urn:schemas-upnp-org:service:WANIPConnection:2", "urn:schemas-upnp-org:service:WANIPConnection:1", "urn:schemas-upnp-org:service:WANPPPConnection:1"].includes(serviceType)) continue;
        const locationUrlParts = new URL(locationUrl);
        const locationUrlBase = `${locationUrlParts.protocol}//${locationUrlParts.host}/`;
        if (controlUrl.startsWith("/")) { controlUrl = locationUrlBase + controlUrl.slice(1); }
        else if (!controlUrl.startsWith(locationUrlBase)) {
          if (controlUrl.startsWith("http://") || controlUrl.startsWith("https://")) { logger.debug("bridge", `UPnP: Invalid control URL ${controlUrl} for service ${serviceType}, ignoring`); continue; }
          const base = locationUrl.slice(0, locationUrl.lastIndexOf("/") + 1);
          controlUrl = base + controlUrl;
        }
        return { serviceType, controlUrl };
      }
    } catch (e) { logger.debug("bridge", `UPnP: invalid device description from ${locationUrl}`, { error: (e as Error).message }); }
    return { serviceType: null, controlUrl: null };
  }
  private static async getServices(privateIp: string): Promise<Map<string, { serviceType: string; controlUrl: string }>> {
    // ponytail: SSDP discovery stubbed — no multicast, return empty
    logger.debug("bridge", `UPnP: discovery stubbed via ${privateIp}`);
    return new Map();
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
    throw new PortmapError("UPnP request stubbed");
  }
  async addPortMapping(leaseDuration: number): Promise<void> {
    if (this.port == null || this.localIpAddress == null) throw new PortmapError("No port/ip");
    if (this.localIpAddress === "0.0.0.0") throw new PortmapError("Local IP is 0.0.0.0, skipping UPnP (container bridge — use host network or set interface)");
    this.service = await this.findService(this.localIpAddress);
    if (!this.service) throw new PortmapError("No UPnP devices found");
    let { errorCode, errorDescription } = await this.requestPortMapping(this.port, this.localIpAddress, this.port, "NicotinePlus", leaseDuration);
    if (errorCode === "725" && leaseDuration > 0) {
      const ret = await this.requestPortMapping(this.port, this.localIpAddress, this.port, "NicotinePlus", 0);
      errorCode = ret.errorCode; errorDescription = ret.errorDescription;
    }
    if (errorCode || errorDescription) throw new PortmapError(`Error code ${errorCode}: ${errorDescription}`);
  }
  async removePortMapping(): Promise<void> {
    if (!this.service || this.port == null) return;
    const serviceType = this.service.serviceType;
    const controlUrl = this.service.controlUrl;
    this.service = null;
    try {
      const headers: Record<string, string> = { Host: new URL(controlUrl).host, "Content-Type": "text/xml; charset=utf-8", SOAPACTION: `"${serviceType}#DeletePortMapping"` };
      const body = '<?xml version="1.0"?>' + '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:DeletePortMapping xmlns:u="' + serviceType + '"><NewRemoteHost></NewRemoteHost><NewExternalPort>' + this.port + '</NewExternalPort><NewProtocol>TCP</NewProtocol></u:DeletePortMapping></s:Body></s:Envelope>\r\n';
      const controller = new AbortController(); const t = setTimeout(() => controller.abort(), UPnP.HTTP_REQUEST_TIMEOUT);
      try { const res = await fetch(controlUrl, { method: "POST", headers, body, signal: controller.signal }); clearTimeout(t); const text = await res.text(); logger.debug("bridge", "UPnP: DeletePortMapping response", { status: res.status, text: text.slice(0, 500) }); } catch (e) { clearTimeout(t); logger.debug("bridge", "UPnP: DeletePortMapping failed (ignored)", { error: (e as Error).message }); }
    } catch {}
  }
}

export class PortMapper {
  private activeImplementation: NATPMP | UPnP | null = null;
  private hasPort = false;
  private isMappingPort = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private natpmp = new NATPMP();
  private upnp = new UPnP();
  private currentPort: number | null = null;
  private currentIp: string | null = null;
  private lastError: string | null = null;
  private lastSuccessAt: number | null = null;
  private lastAttemptAt: number | null = null;
  static readonly RENEWAL_INTERVAL = 7200 * 1000;
  static readonly LEASE_DURATION = 43200;
  private async waitUntilReady() { while (this.isMappingPort) await new Promise((r) => setTimeout(r, 100)); }
  private async addPortMappingInternal(): Promise<void> {
    await this.waitUntilReady(); this.isMappingPort = true; this.lastAttemptAt = Date.now(); logger.debug("bridge", "Creating Port Mapping rule… (stubbed)");
    try { this.activeImplementation = this.natpmp; await this.natpmp.addPortMapping(PortMapper.LEASE_DURATION); this.lastError = null; this.lastSuccessAt = Date.now(); }
    catch (natErr) {
      logger.debug("bridge", `NAT-PMP not available, falling back to UPnP: ${natErr}`);
      try { this.activeImplementation = this.upnp; await this.upnp.addPortMapping(PortMapper.LEASE_DURATION); this.lastError = null; this.lastSuccessAt = Date.now(); }
      catch (upnpErr) {
        const msg = (upnpErr as Error).message; logger.warn("bridge", `${this.activeImplementation?.constructor.name || "UPnP"}: Failed to forward external port ${this.activeImplementation?.port}: ${msg}`, { error: msg });
        if (msg !== "No UPnP devices found" && !msg.includes("0.0.0.0")) logger.debug("bridge", (upnpErr as Error).stack || msg);
        this.lastError = msg; this.activeImplementation = null; this.isMappingPort = false; return;
      }
    }
    const impl = this.activeImplementation; logger.info("bridge", `${(impl as unknown as { constructor: { NAME: string } })?.constructor?.NAME || impl?.constructor.name}: External port ${impl?.port} successfully forwarded to local IP ${impl?.localIpAddress} port ${impl?.port} (stub)`, { protocol: (impl as unknown as { constructor: { NAME: string } }).constructor.NAME || impl?.constructor.name, external_port: impl?.port, ip_address: impl?.localIpAddress, local_port: impl?.port }); this.isMappingPort = false;
  }
  private async removePortMappingInternal(): Promise<void> { await this.waitUntilReady(); if (!this.activeImplementation) return; this.isMappingPort = true; try { await this.activeImplementation.removePortMapping(); logger.info("bridge", "Port mapping removed (stub)", { port: this.activeImplementation.port, protocol: (this.activeImplementation as unknown as { constructor: { NAME: string } }).constructor.NAME }); } catch (e) { logger.debug("bridge", `${this.activeImplementation.constructor.name}: Failed to remove port mapping: ${e}`); } this.activeImplementation = null; this.isMappingPort = false; }
  private startRenewalTimer() { this.cancelRenewalTimer(); this.timer = setTimeout(() => { this.addPortMapping().catch(() => {}); }, PortMapper.RENEWAL_INTERVAL); try { (this.timer as unknown as { unref?: () => void }).unref?.(); } catch {} }
  private cancelRenewalTimer() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  setPort(port: number | null, localIpAddress: string | null) { this.natpmp.setPort(port, localIpAddress); this.upnp.setPort(port, localIpAddress); this.currentPort = port; this.currentIp = localIpAddress; this.hasPort = port != null; if (port != null) this.lastError = null; }
  async addPortMapping(blocking = false): Promise<void> { if (!this.hasPort) return; if (blocking) { await this.addPortMappingInternal(); } else { this.addPortMappingInternal().catch(() => {}); } this.startRenewalTimer(); }
  async removePortMapping(blocking = false): Promise<void> { this.cancelRenewalTimer(); if (blocking) { await this.removePortMappingInternal(); } else { this.removePortMappingInternal().catch(() => {}); } }
  get mappedPort(): number | null { return this.currentPort; }
  get mappedIp(): string | null { return this.currentIp; }
  get activeName(): string | null { return this.activeImplementation ? (this.activeImplementation as unknown as { constructor: { NAME: string } }).constructor.NAME : null; }
  get status(): { active: string | null; port: number | null; ip: string | null; error: string | null; lastSuccessAt: number | null; lastAttemptAt: number | null; hasPort: boolean } { return { active: this.activeName, port: this.mappedPort, ip: this.mappedIp, error: this.lastError, lastSuccessAt: this.lastSuccessAt, lastAttemptAt: this.lastAttemptAt, hasPort: this.hasPort, }; }
  get lastErrorMessage(): string | null { return this.lastError; }
}
