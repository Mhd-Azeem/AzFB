import { expect, it } from "vitest";
import { whatsappNumber } from "./whatsapp";
it("normalizes international numbers without guessing local country codes", () => {
  expect(whatsappNumber("+94 (77) 123-4567")).toBe("94771234567");
  expect(whatsappNumber("0094771234567")).toBe("94771234567");
  for (const bad of [
    "",
    "0771234567",
    "123",
    "+1234567890123456",
    "+94771234567 ext 4",
    "https://example.com",
    "+94+771234567",
  ])
    expect(whatsappNumber(bad)).toBeNull();
});
