import { describe, expect, it } from "vitest";
import {
  dataUrlBytes,
  fitWithin,
  imageFromTransfer,
  isImageFile,
} from "./image";

describe("fitWithin", () => {
  it("never upscales and keeps the ratio", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 });
    expect(fitWithin(300, 4000, 1000)).toEqual({ width: 75, height: 1000 });
  });
});

describe("imageFromTransfer", () => {
  it("finds the first image among dropped files", () => {
    const text = new File(["x"], "a.txt", { type: "text/plain" });
    const png = new File(["x"], "a.png", { type: "image/png" });
    const transfer = {
      items: [],
      files: [text, png],
    } as unknown as DataTransfer;
    expect(imageFromTransfer(transfer)).toBe(png);
    expect(imageFromTransfer(null)).toBeNull();
    expect(isImageFile(text)).toBe(false);
  });
});

describe("dataUrlBytes", () => {
  it("estimates the decoded size", () => {
    expect(dataUrlBytes("data:image/png;base64,AAAAAAAA")).toBe(6);
  });
});
