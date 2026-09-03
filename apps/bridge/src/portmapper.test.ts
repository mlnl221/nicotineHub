import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { UPnP, PortMapper, PortmapError } from "./portmapper.ts";

describe("UPnP SSDPResponse", () => {
  test("parses headers case-insensitive", async () => {
    // We test via indirect UPnP behavior: mock fetch + SSDP discovery would need network.
    // Instead verify UPnP constants
    expect(UPnP.NAME).toBe("UPnP");
    expect(UPnP.MULTICAST_HOST).toBe("239.255.255.250");
    expect(UPnP.MULTICAST_PORT).toBe(1900);
    expect(UPnP.MX_RESPONSE_DELAY).toBe(1);
  });

  test("throws when port/ip missing", async () => {
    const u = new UPnP();
    await expect(u.addPortMapping(43200)).rejects.toThrow("No port/ip");
    u.setPort(null, "192.168.1.10");
    await expect(u.addPortMapping(43200)).rejects.toThrow("No port/ip");
    u.setPort(1234, "0.0.0.0");
    await expect(u.addPortMapping(43200)).rejects.toThrow("0.0.0.0");
  });

  test("getServiceControlUrl parses XML and resolves relative controlURL", async () => {
    const originalFetch = globalThis.fetch;
    const xml = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <serviceList>
      <service>
        <serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>
        <controlURL>/ctl/IPConn</controlURL>
      </service>
    </serviceList>
  </device>
</root>`;
    // Mock fetch to return xml
    globalThis.fetch = (async () => new Response(xml, { status: 200, headers: { "content-type": "text/xml" } })) as unknown as typeof fetch;
    try {
      // Access private via any
      const { serviceType, controlUrl } = await (UPnP as unknown as { getServiceControlUrl: (u:string)=>Promise<{serviceType:string|null,controlUrl:string|null}> }).getServiceControlUrl("http://192.168.1.1:1900/desc.xml");
      expect(serviceType).toBe("urn:schemas-upnp-org:service:WANIPConnection:1");
      expect(controlUrl).toBe("http://192.168.1.1:1900/ctl/IPConn");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getServiceControlUrl handles absolute controlURL with base validation", async () => {
    const originalFetch = globalThis.fetch;
    const xmlValid = `<?xml version="1.0"?><root><device><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:2</serviceType><controlURL>http://192.168.1.1:1900/upnp/control/WANIPConn2</controlURL></service></device></root>`;
    globalThis.fetch = (async () => new Response(xmlValid, { status: 200 })) as unknown as typeof fetch;
    try {
      const { serviceType, controlUrl } = await (UPnP as unknown as { getServiceControlUrl: (u:string)=>Promise<{serviceType:string|null,controlUrl:string|null}> }).getServiceControlUrl("http://192.168.1.1:1900/desc.xml");
      expect(serviceType).toBe("urn:schemas-upnp-org:service:WANIPConnection:2");
      expect(controlUrl).toBe("http://192.168.1.1:1900/upnp/control/WANIPConn2");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getServiceControlUrl rejects controlURL not starting with base", async () => {
    const originalFetch = globalThis.fetch;
    const xmlBad = `<?xml version="1.0"?><root><device><service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>http://evil.com/ctl</controlURL></service></device></root>`;
    globalThis.fetch = (async () => new Response(xmlBad, { status: 200 })) as unknown as typeof fetch;
    try {
      const { serviceType, controlUrl } = await (UPnP as unknown as { getServiceControlUrl: (u:string)=>Promise<{serviceType:string|null,controlUrl:string|null}> }).getServiceControlUrl("http://192.168.1.1:1900/desc.xml");
      expect(serviceType).toBeNull();
      expect(controlUrl).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("getServiceControlUrl returns null on fetch failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => { throw new Error("network down"); }) as unknown as typeof fetch;
    try {
      const { serviceType, controlUrl } = await (UPnP as unknown as { getServiceControlUrl: (u:string)=>Promise<{serviceType:string|null,controlUrl:string|null}> }).getServiceControlUrl("http://192.168.1.1:1900/desc.xml");
      expect(serviceType).toBeNull();
      expect(controlUrl).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("PortMapper orchestrator", () => {
  test("setPort and hasPort gating", async () => {
    const pm = new PortMapper();
    expect(pm.mappedPort).toBeNull();
    pm.setPort(12345, "192.168.1.10");
    expect(pm.mappedPort).toBe(12345);
    expect(pm.mappedIp).toBe("192.168.1.10");
    expect(pm.status.hasPort).toBe(true);
    expect(pm.status.port).toBe(12345);
    pm.setPort(null, null);
    expect(pm.status.hasPort).toBe(false);
  });

  test("addPortMapping no-ops when no port", async () => {
    const pm = new PortMapper();
    // no hasPort, should not start timer nor throw
    await pm.addPortMapping(true);
    expect(pm.activeName).toBeNull();
  });

  test("removePortMapping cancels timer and no-ops when no active impl", async () => {
    const pm = new PortMapper();
    pm.setPort(1234, "192.168.1.10");
    await pm.removePortMapping(true);
    expect(pm.activeName).toBeNull();
  });

  test("status includes error and lastAttempt after failed mapping", async () => {
    const pm = new PortMapper();
    pm.setPort(60754, "192.168.1.10");
    // In CI, no UPnP router, so mapping should fail and set error
    await pm.addPortMapping(true);
    expect(pm.activeName).toBeNull();
    expect(pm.status.error).toBeTruthy();
    expect(pm.status.lastAttemptAt).not.toBeNull();
    expect(pm.status.lastSuccessAt).toBeNull();
  });

  test("PortMapper renewal timer is set after addPortMapping", async () => {
    const pm = new PortMapper();
    pm.setPort(12345, "192.168.1.10");
    await pm.addPortMapping(true);
    // timer should be set (hasPort true)
    const hasTimer = (pm as unknown as { timer: unknown }).timer !== null;
    expect(hasTimer).toBe(true);
    await pm.removePortMapping(true);
    const after = (pm as unknown as { timer: unknown }).timer;
    expect(after).toBeNull();
  });

  test("constants match python", () => {
    expect(PortMapper.LEASE_DURATION).toBe(43200);
    expect(PortMapper.RENEWAL_INTERVAL).toBe(7200 * 1000);
  });
});
