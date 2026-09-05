import { describe, expect, test } from "bun:test";
import {
  buildRecreatePayload,
  parseHostPorts,
  envListenPort,
  type ContainerInspect,
} from "./docker.ts";

function fakeInspect(): ContainerInspect {
  return {
    Id: "abc123def456abc123def456abc123def456abc123def456abc123def456abcd",
    Name: "/nicotine_mobile-bridge-1",
    Config: {
      Image: "nicotinehub-bridge:latest",
      Env: ["PORT=8787", "LISTEN_PORT=40598", "CONFIG_DIR=/config"],
      Labels: { "com.docker.compose.service": "bridge" },
      ExposedPorts: { "8787/tcp": {}, "40598/tcp": {} },
    },
    HostConfig: {
      Binds: null,
      PortBindings: {
        "40598/tcp": [{ HostIp: "", HostPort: "40598" }],
        "40598/udp": [{ HostIp: "", HostPort: "40598" }],
      },
      RestartPolicy: { Name: "unless-stopped" },
    },
    Mounts: [
      { Type: "volume", Name: "nicotine_mobile_config", Source: "/var/lib/docker/volumes/x/_data", Destination: "/config", RW: true },
      { Type: "bind", Source: "/mnt/c/Users/m/Downloads/DJSplash", Destination: "/data", RW: true },
    ],
    NetworkSettings: { Networks: { nicotine_mobile_default: { IPAddress: "172.18.0.3" } } },
  };
}

describe("parseHostPorts", () => {
  test("reads published host ports", () => {
    expect(parseHostPorts(fakeInspect())).toEqual([40598]);
  });
});

describe("envListenPort", () => {
  test("reads LISTEN_PORT from env", () => {
    expect(envListenPort(fakeInspect())).toBe(40598);
  });
  test("null when absent", () => {
    const i = fakeInspect();
    i.Config.Env = ["PORT=8787"];
    expect(envListenPort(i)).toBeNull();
  });
});

describe("buildRecreatePayload", () => {
  test("swaps env + bindings, preserves volumes/labels/networks", () => {
    const plan = buildRecreatePayload(fakeInspect(), 40598, 39577);
    const body = plan.createBody as {
      Env: string[];
      Labels: Record<string, string>;
      HostConfig: { Binds: string[]; PortBindings: Record<string, Array<{ HostIp?: string; HostPort?: string }>>; RestartPolicy: unknown };
      NetworkingConfig: { EndpointsConfig: Record<string, unknown> };
    };
    expect(body.Env).toContain("LISTEN_PORT=39577");
    expect(body.Env).not.toContain("LISTEN_PORT=40598");
    expect(body.HostConfig.PortBindings["39577/tcp"]).toEqual([{ HostIp: "", HostPort: "39577" }]);
    expect(body.HostConfig.PortBindings["39577/udp"]).toEqual([{ HostIp: "", HostPort: "39577" }]);
    expect(body.HostConfig.PortBindings["40598/tcp"]).toBeUndefined();
    expect(body.HostConfig.PortBindings["40598/udp"]).toBeUndefined();
    // named volume + bind mount preserved
    expect(body.HostConfig.Binds.join("\n")).toContain("nicotine_mobile_config:/config:rw");
    expect(body.HostConfig.Binds.join("\n")).toContain("/mnt/c/Users/m/Downloads/DJSplash:/data:rw");
    expect(body.Labels["com.docker.compose.service"]).toBe("bridge");
    expect(body.NetworkingConfig.EndpointsConfig).toEqual({ nicotine_mobile_default: { Aliases: ["bridge"] } });
    expect(plan.oldName).toBe("nicotine_mobile-bridge-1");
  });

  test("rejects invalid port", () => {
    expect(() => buildRecreatePayload(fakeInspect(), 40598, 80)).toThrow("Invalid listen port");
    expect(() => buildRecreatePayload(fakeInspect(), 40598, 70000)).toThrow("Invalid listen port");
  });

  test("refuses host network (nothing to remap)", () => {
    const i = fakeInspect();
    i.HostConfig.NetworkMode = "host";
    expect(() => buildRecreatePayload(i, 40598, 39577)).toThrow("host network");
  });
});
