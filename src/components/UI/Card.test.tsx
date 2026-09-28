import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CardTitle } from "./Card";

describe("CardTitle", () => {
  afterEach(cleanup);

  it("lets an unbroken address wrap inside the card", () => {
    render(<CardTitle>Q0a2869f4...B33CBe63...1eC3580f</CardTitle>);

    expect(screen.getByRole("heading")).toHaveClass("[overflow-wrap:anywhere]");
  });
});
