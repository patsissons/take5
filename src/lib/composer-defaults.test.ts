import { describe, expect, it } from "vitest";
import { customModel } from "./use-settings";
import {
  defaultAspectRatio,
  defaultDuration,
  defaultResolution,
  imageRoles,
} from "./composer-defaults";

const base = customModel("openrouter", "m");

describe("composer defaults", () => {
  it("picks the supported duration nearest five seconds", () => {
    expect(defaultDuration(base)).toBe(5);
    expect(defaultDuration({ ...base, durations: [4, 6, 8] })).toBe(4);
    expect(defaultDuration({ ...base, durations: [8, 6] })).toBe(6);
    expect(defaultDuration({ ...base, durations: [] })).toBe(5);
  });

  it("prefers 720p and 16:9 when offered", () => {
    expect(defaultResolution(base)).toBeUndefined();
    expect(defaultResolution({ ...base, resolutions: ["480p", "720p"] })).toBe(
      "720p",
    );
    expect(defaultResolution({ ...base, resolutions: ["1080p"] })).toBe(
      "1080p",
    );
    expect(
      defaultAspectRatio({ ...base, aspectRatios: ["9:16", "16:9"] }),
    ).toBe("16:9");
    expect(defaultAspectRatio({ ...base, aspectRatios: ["1:1"] })).toBe("1:1");
  });

  it("lists the image roles the model accepts", () => {
    expect(imageRoles(base)).toEqual(["first_frame", "reference"]);
    expect(
      imageRoles({ ...base, frameImages: [], referenceImages: false }),
    ).toEqual([]);
    expect(
      imageRoles({ ...base, frameImages: ["first_frame", "last_frame"] }),
    ).toEqual(["first_frame", "last_frame", "reference"]);
  });
});
