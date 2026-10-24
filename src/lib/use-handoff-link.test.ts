import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useHandoffLink } from "./use-handoff-link";

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("useHandoffLink", () => {
  it("takes the payload a link opened with and strips it from the URL", () => {
    window.history.replaceState(null, "", "/#handoff=sealed-one");
    const { result } = renderHook(() => useHandoffLink());
    expect(result.current[0]).toBe("sealed-one");
    expect(window.location.hash).toBe("");
    act(() => result.current[1]());
    expect(result.current[0]).toBeNull();
  });

  it("takes a payload an open tab switches to", () => {
    const { result } = renderHook(() => useHandoffLink());
    expect(result.current[0]).toBeNull();
    act(() => {
      window.location.hash = "#handoff=sealed-two";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current[0]).toBe("sealed-two");
    expect(window.location.hash).toBe("");
  });
});
