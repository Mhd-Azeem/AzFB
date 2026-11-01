import { describe, expect, it } from "vitest";
import { csv, demoLeads, filterLeads } from "./data";
describe("lead filtering", () => {
  it("combines search, status, form and inclusive dates", () => {
    const l = demoLeads[0];
    expect(
      filterLeads(
        demoLeads,
        "AMELIA",
        l.status,
        l.form,
        "2026-11-01",
        "2026-11-01",
      ),
    ).toEqual([l]);
    expect(filterLeads(demoLeads, "Amelia", "Converted", "", "", "")).toEqual(
      [],
    );
  });
  it("searches campaigns and returns empty results for inverted dates", () => {
    expect(
      filterLeads(demoLeads, "November growth", "", "", "", ""),
    ).toHaveLength(8);
    expect(
      filterLeads(demoLeads, "", "", "", "2026-11-02", "2026-10-25"),
    ).toEqual([]);
  });
});
describe("CSV export", () => {
  it("escapes quotes, separators and line breaks and neutralizes spreadsheet formulas", () => {
    const value = csv([
      {
        ...demoLeads[0],
        name: '=HYPERLINK("bad")',
        notes: 'one, two\nthree "four"',
      },
    ]);
    expect(value).toContain('"\'=HYPERLINK(""bad"")"');
    expect(value).toContain('"one, two\nthree ""four"""');
    expect(value).toContain("\"'+1 202");
  });
  it("exports only the selected records with a header", () => {
    expect(csv([]).split("\r\n")).toHaveLength(1);
    expect(csv(demoLeads.slice(0, 2)).split("\r\n")).toHaveLength(3);
  });
});
