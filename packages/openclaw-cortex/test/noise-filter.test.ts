import { describe, it, expect } from "vitest";
import { isNoiseTopic } from "../src/patterns.js";

describe("isNoiseTopic", () => {
  it("rejects short strings", () => {
    expect(isNoiseTopic("foo")).toBe(true);
    expect(isNoiseTopic("ab")).toBe(true);
    expect(isNoiseTopic("")).toBe(true);
  });

  it("rejects single blacklisted words", () => {
    expect(isNoiseTopic("that")).toBe(true);
    expect(isNoiseTopic("this")).toBe(true);
    expect(isNoiseTopic("nichts")).toBe(true);
    expect(isNoiseTopic("alles")).toBe(true);
  });

  it("rejects all-blacklisted multi-word", () => {
    expect(isNoiseTopic("das was es")).toBe(true);
    expect(isNoiseTopic("the that it")).toBe(true);
  });

  it("rejects sentence fragments starting with pronouns", () => {
    expect(isNoiseTopic("ich habe nichts gepostet")).toBe(true);
    expect(isNoiseTopic("we should do something")).toBe(true);
    expect(isNoiseTopic("er hat gesagt")).toBe(true);
    expect(isNoiseTopic("I think maybe")).toBe(true);
  });

  it("rejects topics with newlines", () => {
    expect(isNoiseTopic("line one\nline two")).toBe(true);
  });

  it("rejects topics longer than 60 chars", () => {
    const long = "a".repeat(61);
    expect(isNoiseTopic(long)).toBe(true);
  });

  it("accepts valid topic names", () => {
    expect(isNoiseTopic("Auth Migration")).toBe(false);
    expect(isNoiseTopic("Plugin-Repo Setup")).toBe(false);
    expect(isNoiseTopic("NATS Event Store")).toBe(false);
    expect(isNoiseTopic("Cortex Demo")).toBe(false);
    expect(isNoiseTopic("Security Audit")).toBe(false);
    expect(isNoiseTopic("Deployment Pipeline")).toBe(false);
  });

  it("accepts german topic names", () => {
    expect(isNoiseTopic("Darkplex Analyse")).toBe(false);
    expect(isNoiseTopic("Credential Rotation")).toBe(false);
    expect(isNoiseTopic("Thread Tracking Qualität")).toBe(false);
  });

  it("rejects 'nichts gepostet habe' (real-world noise)", () => {
    expect(isNoiseTopic("nichts gepostet habe")).toBe(true);
  });
});
