import { describe, expect, test } from "bun:test";
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PORT, restoreServerHost, restoreServerPort } from "./defaults";

describe("restoreServerHost", () => {
  test("empty or blank snaps back to default", () => {
    expect(restoreServerHost("")).toBe(DEFAULT_SERVER_HOST);
    expect(restoreServerHost("   ")).toBe(DEFAULT_SERVER_HOST);
  });
  test("custom value passes through untouched", () => {
    expect(restoreServerHost("soulfind-e2e")).toBe("soulfind-e2e");
    expect(restoreServerHost("server.slsknet.org ")).toBe("server.slsknet.org ");
  });
  test("default is the real server", () => {
    expect(DEFAULT_SERVER_HOST).toBe("server.slsknet.org");
  });
});

describe("restoreServerPort", () => {
  test("empty or blank snaps back to default", () => {
    expect(restoreServerPort("")).toBe(String(DEFAULT_SERVER_PORT));
    expect(restoreServerPort("   ")).toBe(String(DEFAULT_SERVER_PORT));
  });
  test("custom value passes through untouched", () => {
    expect(restoreServerPort("2243")).toBe("2243");
  });
  test("default is 2242", () => {
    expect(DEFAULT_SERVER_PORT).toBe(2242);
  });
});
