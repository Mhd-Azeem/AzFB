import { expect, it } from "vitest";
import { greetingMessage, greetingTemplates } from "./message-templates";
it("personalizes greetings for each Page without interpreting contact placeholders", () => {
  expect(greetingMessage("thanks", "Asha", "JobMarketing")).toBe(
    "Hi Asha, greetings from JobMarketing. Thank you for your interest through our Facebook form.",
  );
  expect(greetingMessage("team", "{business}", "Other Page")).toContain(
    "Hi {business}, this is the Other Page team.",
  );
  expect(greetingMessage("missing", "Asha", "JobMarketing")).toBe("");
  for (const template of greetingTemplates)
    expect(template.body).not.toContain("?");
});
