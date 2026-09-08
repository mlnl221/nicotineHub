import { describe, expect, test } from "bun:test";
import { defaults, migrateLogDir, migrateLoggingDirsToConfig } from "./defaults";

describe("logging dirs", () => {
  test("defaults point at CONFIG_DIR", () => {
    expect(defaults.logging.privatelogsdir).toBe("${CONFIG_DIR}/logs/private");
    expect(defaults.logging.roomlogsdir).toBe("${CONFIG_DIR}/logs/rooms");
    expect(defaults.logging.transferslogsdir).toBe("${CONFIG_DIR}/logs/transfers");
    expect(defaults.logging.debuglogsdir).toBe("${CONFIG_DIR}/logs/debug");
  });

  test("migrates old DATA_DIR values to CONFIG_DIR", () => {
    expect(migrateLogDir("${DATA_DIR}/logs/private")).toBe("${CONFIG_DIR}/logs/private");
    expect(migrateLogDir("/data/logs/rooms")).toBe("${CONFIG_DIR}/logs/rooms");
  });

  test("leaves custom paths alone", () => {
    const s = { logging: { ...defaults.logging, privatelogsdir: "/custom/logs" } };
    expect(migrateLoggingDirsToConfig(s).logging.privatelogsdir).toBe("/custom/logs");
    const old = { logging: { ...defaults.logging, roomlogsdir: "${DATA_DIR}/logs/rooms" } };
    expect(migrateLoggingDirsToConfig(old).logging.roomlogsdir).toBe("${CONFIG_DIR}/logs/rooms");
  });
});
