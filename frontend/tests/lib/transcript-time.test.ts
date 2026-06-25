import { describe, expect, test } from "bun:test";

import { formatRecordingTime, parseCutoffSeconds } from "../../src/lib/transcriptTime";

describe("transcript time parsing", () => {
  test("accepts elapsed minute timestamps beyond one hour", () => {
    expect(parseCutoffSeconds("111:42")).toBe(6702);
    expect(parseCutoffSeconds("163:53")).toBe(9833);
  });

  test("accepts clock-style hour minute second timestamps", () => {
    expect(parseCutoffSeconds("1:51:42")).toBe(6702);
  });

  test("accepts raw seconds", () => {
    expect(parseCutoffSeconds("6702")).toBe(6702);
    expect(parseCutoffSeconds("6702.5")).toBe(6702.5);
  });

  test("rejects malformed timestamps", () => {
    expect(parseCutoffSeconds("")).toBeNull();
    expect(parseCutoffSeconds("1::42")).toBeNull();
    expect(parseCutoffSeconds("1:61:42")).toBeNull();
    expect(parseCutoffSeconds("111:60")).toBeNull();
    expect(parseCutoffSeconds("-1:20")).toBeNull();
    expect(parseCutoffSeconds("1:02:03:04")).toBeNull();
  });
});

describe("transcript time formatting", () => {
  test("formats elapsed meeting minutes instead of rolling into hours", () => {
    expect(formatRecordingTime(6702)).toBe("111:42");
    expect(formatRecordingTime(9833)).toBe("163:53");
  });

  test("formats missing or invalid timestamps", () => {
    expect(formatRecordingTime()).toBe("--:--");
    expect(formatRecordingTime(null)).toBe("--:--");
    expect(formatRecordingTime(Number.NaN)).toBe("--:--");
  });
});
