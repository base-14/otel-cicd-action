import { Buffer } from "node:buffer";
import { jest } from "@jest/globals";
import * as core from "./__fixtures__/core";

jest.unstable_mockModule("@actions/core", () => core);

const { parseJobLogByTimestamps, parseLogsZip } = await import("./logs");

// Helper to create a minimal zip file in memory
function createTestZip(entries: Record<string, string>): Buffer {
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name, "utf-8");
    const contentBuffer = Buffer.from(content, "utf-8");

    const local = Buffer.alloc(30 + nameBuffer.length + contentBuffer.length);
    local.writeUInt32LE(0x04_03_4b_50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(contentBuffer.length, 18);
    local.writeUInt32LE(contentBuffer.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    local.set(nameBuffer, 30);
    local.set(contentBuffer, 30 + nameBuffer.length);

    const central = Buffer.alloc(46 + nameBuffer.length);
    central.writeUInt32LE(0x02_01_4b_50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(contentBuffer.length, 20);
    central.writeUInt32LE(contentBuffer.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    central.set(nameBuffer, 46);

    localHeaders.push(local as unknown as Uint8Array);
    centralHeaders.push(central as unknown as Uint8Array);
    offset += local.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06_05_4b_50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(centralHeaders.length, 8);
  eocd.writeUInt16LE(centralHeaders.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, ...centralHeaders, eocd as unknown as Uint8Array]);
}

describe("parseLogsZip", () => {
  it("parses a zip with multiple jobs and steps", () => {
    const zip = createTestZip({
      "Build/1_Set up job.txt": "Setting up...\n",
      "Build/2_Run build.txt": "Building...\nDone.\n",
      "Test/1_Set up job.txt": "Setting up test...\n",
      "Test/3_Run tests.txt": "FAIL: expected 1 got 2\n",
    });

    const result = parseLogsZip(zip);

    expect(result.get("Build")?.get(1)).toBe("Setting up...\n");
    expect(result.get("Build")?.get(2)).toBe("Building...\nDone.\n");
    expect(result.get("Test")?.get(1)).toBe("Setting up test...\n");
    expect(result.get("Test")?.get(3)).toBe("FAIL: expected 1 got 2\n");
  });

  it("returns empty map for empty zip", () => {
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06_05_4b_50, 0);
    const result = parseLogsZip(eocd);
    expect(result.size).toBe(0);
  });

  it("truncates log content exceeding 64KB to keep the tail", () => {
    const bigContent = "x".repeat(128 * 1024);
    const zip = createTestZip({
      "Job/1_Step.txt": bigContent,
    });

    const result = parseLogsZip(zip);
    const content = result.get("Job")?.get(1);

    expect(content).toBeDefined();
    expect(content?.length).toBeLessThanOrEqual(64 * 1024);
    expect(content).toBe(bigContent.slice(-64 * 1024));
  });

  it("skips entries that don't match the expected naming pattern", () => {
    const zip = createTestZip({
      "Build/1_Set up job.txt": "Setting up...\n",
      "some-other-file.txt": "ignored\n",
    });

    const result = parseLogsZip(zip);
    expect(result.size).toBe(1);
    expect(result.get("Build")?.get(1)).toBe("Setting up...\n");
  });
});

describe("parseJobLogByTimestamps", () => {
  const makeStep = (number: number, startedAt: string, completedAt: string) => ({
    name: `Step ${number}`,
    number,
    status: "completed" as const,
    conclusion: "success" as const,
    started_at: startedAt,
    completed_at: completedAt,
  });

  it("splits log lines into per-step sections by timestamp range", () => {
    const logText = [
      "2026-03-25T07:00:00.0000000Z Setting up...",
      "2026-03-25T07:00:01.0000000Z Ready.",
      "2026-03-25T07:00:05.0000000Z Running build...",
      "2026-03-25T07:00:06.0000000Z Build done.",
    ].join("\n");

    const steps = [
      makeStep(1, "2026-03-25T07:00:00Z", "2026-03-25T07:00:02Z"),
      makeStep(2, "2026-03-25T07:00:04Z", "2026-03-25T07:00:07Z"),
    ];

    const result = parseJobLogByTimestamps(logText, steps);

    expect(result.size).toBe(2);
    expect(result.get(1)).toContain("Setting up...");
    expect(result.get(1)).toContain("Ready.");
    expect(result.get(2)).toContain("Running build...");
    expect(result.get(2)).toContain("Build done.");
  });

  it("returns empty map when log has no timestamps", () => {
    const logText = "no timestamps here\njust plain text\n";
    const steps = [makeStep(1, "2026-03-25T07:00:00Z", "2026-03-25T07:00:01Z")];

    const result = parseJobLogByTimestamps(logText, steps);
    expect(result.size).toBe(0);
  });

  it("skips steps without started_at or completed_at", () => {
    const logText = "2026-03-25T07:00:00.0000000Z Some log line";
    const steps = [
      {
        name: "Incomplete",
        number: 1,
        status: "completed" as const,
        conclusion: "success" as const,
        started_at: null,
        completed_at: null,
      },
    ];

    const result = parseJobLogByTimestamps(logText, steps);
    expect(result.size).toBe(0);
  });

  it("excludes lines outside any step time range", () => {
    const logText = ["2026-03-25T07:00:00.0000000Z In range", "2026-03-25T08:00:00.0000000Z Way later"].join("\n");

    const steps = [makeStep(1, "2026-03-25T07:00:00Z", "2026-03-25T07:00:01Z")];

    const result = parseJobLogByTimestamps(logText, steps);
    expect(result.size).toBe(1);
    expect(result.get(1)).toContain("In range");
    expect(result.get(1)).not.toContain("Way later");
  });

  it("truncates step content exceeding 64KB to keep the tail", () => {
    const lines: string[] = [];
    for (let i = 0; i < 5000; i++) {
      lines.push(`2026-03-25T07:00:00.0000000Z ${"x".repeat(50)}`);
    }
    const logText = lines.join("\n");

    const steps = [makeStep(1, "2026-03-25T07:00:00Z", "2026-03-25T07:00:01Z")];

    const result = parseJobLogByTimestamps(logText, steps);
    const content = result.get(1);

    expect(content).toBeDefined();
    expect(content?.length).toBeLessThanOrEqual(64 * 1024);
  });

  it("returns empty map when steps array is empty", () => {
    const logText = "2026-03-25T07:00:00.0000000Z Some line";
    const result = parseJobLogByTimestamps(logText, []);
    expect(result.size).toBe(0);
  });
});
