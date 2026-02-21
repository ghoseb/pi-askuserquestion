import { it, expect } from "vitest";
import { Type } from "@sinclair/typebox";
import { Key, matchesKey } from "@mariozechner/pi-tui";

it("peer deps resolve", () => {
  expect(Type.String).toBeDefined();
  expect(Key.enter).toBe("enter");
  expect(matchesKey("\r", Key.enter)).toBe(true);
});
