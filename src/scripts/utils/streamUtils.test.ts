import { describe, expect, it } from "vitest";
import { isPrematureClose } from "./streamUtils";

describe("isPrematureClose", () => {
  it("matches the error a pipeline reports when its port closes", () => {
    expect(isPrematureClose(new Error("Premature close"))).toBe(true);
    const coded = Object.assign(new Error("stream ended"), {
      code: "ERR_STREAM_PREMATURE_CLOSE",
    });
    expect(isPrematureClose(coded)).toBe(true);
  });

  it("leaves every other error to be logged", () => {
    expect(isPrematureClose(new Error("write after end"))).toBe(false);
    expect(
      isPrematureClose(new Error("Premature close while reading the body")),
    ).toBe(false);
    expect(isPrematureClose(undefined)).toBe(false);
    expect(isPrematureClose("Premature close")).toBe(false);
  });
});
