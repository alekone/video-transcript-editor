import { describe, it, expect } from "vitest";
import { isFiller, normalizeWord, computeStats } from "./transform";
import type { TranscriptWord } from "../types";

const W = (text: string, start: number, end: number, speaker?: string): TranscriptWord => ({
  text, start, end, speaker,
});

describe("filler words", () => {
  it("normalizeWord toglie punteggiatura e maiuscole", () => {
    expect(normalizeWord("Cioè,")).toBe("cioè");
  });
  it("riconosce i filler", () => {
    expect(isFiller("ehm")).toBe(true);
    expect(isFiller("Cioè,")).toBe(true);
    expect(isFiller("tipo")).toBe(true);
    expect(isFiller("casa")).toBe(false);
    expect(isFiller("architettura")).toBe(false);
  });
});

describe("computeStats", () => {
  it("calcola talk-time e percentuali per speaker", () => {
    const words = [
      W("a", 0, 1, "Anna"),
      W("b", 1, 2, "Anna"),
      W("c", 2, 5, "Bea"),
    ];
    const s = computeStats(words);
    expect(s.totalWords).toBe(3);
    expect(s.speakingDuration).toBe(5);
    expect(s.totalDuration).toBe(5);
    expect(s.speakers[0].speaker).toBe("Bea"); // più tempo → primo
    expect(Math.round(s.speakers[0].pct)).toBe(60);
    expect(Math.round(s.speakers[1].pct)).toBe(40);
  });
  it("gestisce input vuoto", () => {
    expect(computeStats([]).totalWords).toBe(0);
  });
});
