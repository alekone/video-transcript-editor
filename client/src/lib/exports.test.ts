import { describe, it, expect } from "vitest";
import {
  formatTc,
  buildSegments,
  buildEDL,
  buildCues,
  cuesToSRT,
  cuesToVTT,
  wordsToPlainText,
  buildFCPXML,
} from "./exports";
import type { TranscriptWord } from "../types";

const W = (text: string, start: number, end: number, speaker?: string): TranscriptWord => ({
  text, start, end, speaker,
});

describe("formatTc", () => {
  it("formatta HH:MM:SS.mmm", () => {
    expect(formatTc(0)).toBe("00:00:00.000");
    expect(formatTc(3661.5)).toBe("01:01:01.500");
  });
});

describe("buildSegments", () => {
  const orig = [W("Ciao", 0, 0.3), W("questa", 0.4, 0.7), W("è", 0.8, 0.9), W("una", 0.9, 1.1), W("prova", 1.2, 1.5)];
  it("separa tenuti e tagliati", () => {
    const kept = [orig[0], orig[1], orig[4]];
    const { keep, cut } = buildSegments(orig, kept);
    expect(keep).toEqual([
      { start: 0, end: 0.7, text: "Ciao questa" },
      { start: 1.2, end: 1.5, text: "prova" },
    ]);
    expect(cut).toEqual([{ start: 0.8, end: 1.1, text: "è una" }]);
  });
  it("maxGap spezza i segmenti tenuti sulle pause lunghe", () => {
    const words = [W("a", 0, 1), W("b", 5, 6)]; // gap di 4s
    const { keep } = buildSegments(words, words, { maxGap: 2 });
    expect(keep).toHaveLength(2);
  });
});

describe("buildEDL", () => {
  it("genera CMX3600 video+audio frame-accurate", () => {
    const edl = buildEDL([{ start: 5, end: 10, text: "a" }, { start: 20, end: 25.4, text: "b" }], {
      fps: 25, source: "V0.mp4", title: "x",
    });
    expect(edl).toContain("TITLE: x");
    expect(edl).toContain("001  AX       B     C        00:00:05:00 00:00:10:00 00:00:00:00 00:00:05:00");
    expect(edl).toContain("00:00:20:00 00:00:25:10 00:00:05:00 00:00:10:10");
    expect((edl.match(/FROM CLIP NAME/g) || []).length).toBe(2);
  });
});

describe("sottotitoli", () => {
  const words = [W("Ciao", 0, 0.5), W("a", 0.5, 0.7), W("tutti.", 0.7, 1.0), W("Benvenuti", 2.0, 2.6)];
  it("buildCues spezza su punteggiatura e pause", () => {
    const cues = buildCues(words);
    expect(cues.length).toBe(2);
    expect(cues[0].text).toBe("Ciao a tutti.");
    expect(cues[1].text).toBe("Benvenuti");
  });
  it("SRT usa la virgola nei ms e indici progressivi", () => {
    const srt = cuesToSRT(buildCues(words));
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,000");
  });
  it("VTT inizia con WEBVTT e usa il punto", () => {
    const vtt = cuesToVTT(buildCues(words));
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:01.000");
  });
});

describe("testo/markdown", () => {
  const words = [W("Ciao", 0, 0.3, "Anna"), W("ciao", 0.4, 0.7, "Bea")];
  it("plain text etichetta gli speaker", () => {
    expect(wordsToPlainText(words)).toContain("Anna: Ciao");
  });
  it("markdown usa il grassetto", () => {
    expect(wordsToPlainText(words, true)).toContain("**Anna:** Ciao");
  });
});

describe("buildFCPXML", () => {
  it("produce XML valido con un asset-clip per segmento", () => {
    const xml = buildFCPXML([{ start: 5, end: 10, text: "a" }, { start: 20, end: 25, text: "b" }], {
      fps: 25, source: "V0.mp4",
    });
    expect(xml).toContain("<?xml");
    expect(xml).toContain('<fcpxml version="1.10">');
    expect((xml.match(/<asset-clip/g) || []).length).toBe(2);
    expect(xml).toContain('start="125/25s"');
  });
});
