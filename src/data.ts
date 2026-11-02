export const statuses = [
  "New",
  "Contacted",
  "Interested",
  "Converted",
  "Rejected",
] as const;
export type Status = (typeof statuses)[number];
export type Lead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  form: string;
  campaign: string;
  date: string;
  status: Status;
  answers: { question: string; answer: string }[];
  notes: string;
};
export const forms = [
  "Growth consultation",
  "Property enquiries",
  "Course registration",
];
const people = [
  "Amelia Carter",
  "Noah Williams",
  "Olivia Bennett",
  "Liam Anderson",
  "Isabella Taylor",
  "Ethan Wilson",
  "Sophia Martinez",
  "James Robinson",
  "Charlotte Lee",
  "Lucas Walker",
  "Mia Thompson",
  "Henry Scott",
  "Harper Adams",
  "Alexander Hill",
  "Evelyn Green",
  "Daniel Baker",
  "Aria Nelson",
  "Oliver King",
  "Ella Wright",
  "Benjamin Lewis",
  "Grace Young",
  "Leo Hall",
  "Chloe Allen",
  "Jack Turner",
];
export const demoLeads: Lead[] = people.map((name, i) => ({
  id: `AZ-${String(1048 - i)}`,
  name,
  email: `${name.toLowerCase().replace(" ", ".")}@example.com`,
  phone: `+1 202 555 ${String(100 + i).padStart(4, "0")}`,
  form: forms[i % 3],
  campaign: ["November growth", "Find your next home", "Learn something new"][
    i % 3
  ],
  date: new Date(
    Date.UTC(2026, 10, 1 - Math.floor(i / 3), 10 - (i % 3), 42),
  ).toISOString(),
  status: statuses[i % 5],
  answers: [
    {
      question: [
        "What would you like help with?",
        "What type of property are you looking for?",
        "Which course interests you?",
      ][i % 3],
      answer: [
        "Growing my business with digital marketing",
        "A two-bedroom apartment",
        "Digital marketing fundamentals",
      ][i % 3],
    },
    {
      question: "When would you like to get started?",
      answer: i % 2 ? "Within the next month" : "As soon as possible",
    },
    { question: "Preferred contact method", answer: i % 2 ? "Email" : "Phone" },
  ],
  notes: "",
}));
export function filterLeads(
  leads: Lead[],
  query: string,
  status: string,
  form: string,
  from: string,
  to: string,
) {
  return leads.filter(
    (l) =>
      `${l.name} ${l.email} ${l.phone} ${l.id} ${l.campaign}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (!status || l.status === status) &&
      (!form || l.form === form) &&
      (!from || l.date.slice(0, 10) >= from) &&
      (!to || l.date.slice(0, 10) <= to),
  );
}
export function csv(leads: Lead[]) {
  const cell = (s: string) =>
    `"${(/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(s) ? "'" : "") + s.replaceAll('"', '""')}"`;
  return [
    [
      "ID",
      "Name",
      "Email",
      "Phone",
      "Form",
      "Campaign",
      "Submitted (UTC)",
      "Status",
      "Notes",
    ],
    ...leads.map((l) => [
      l.id,
      l.name,
      l.email,
      l.phone,
      l.form,
      l.campaign,
      l.date,
      l.status,
      l.notes,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
