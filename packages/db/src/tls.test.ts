import { describe, expect, it } from "vitest";
import { withVerifiedTls } from "./index";

describe("withVerifiedTls", () => {
  it.each([
    ["postgres://u:p@h/db?sslmode=require", "postgres://u:p@h/db?sslmode=verify-full"],
    [
      "postgres://u:p@h/db?sslmode=require&channel_binding=require",
      "postgres://u:p@h/db?sslmode=verify-full&channel_binding=require",
    ],
    ["postgres://u:p@h/db?a=1&sslmode=prefer", "postgres://u:p@h/db?a=1&sslmode=verify-full"],
    ["postgres://u:p@h/db?sslmode=verify-full", "postgres://u:p@h/db?sslmode=verify-full"],
    ["postgres://u:p@localhost:5432/db", "postgres://u:p@localhost:5432/db"],
    ["postgres://u:p@h/db?sslmode=disable", "postgres://u:p@h/db?sslmode=disable"],
  ])("%s", (input, expected) => {
    expect(withVerifiedTls(input)).toBe(expected);
  });
});
