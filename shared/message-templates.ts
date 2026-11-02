export const greetingTemplates = [
  {
    id: "thanks",
    label: "Thank you for your interest",
    body: "Hi {name}, greetings from {business}. Thank you for your interest through our Facebook form.",
  },
  {
    id: "welcome",
    label: "A warm welcome",
    body: "Hello {name}, welcome to {business}. We're happy to connect with you.",
  },
  {
    id: "team",
    label: "From our team",
    body: "Hi {name}, this is the {business} team. Thank you for reaching out to us.",
  },
] as const;
export function greetingMessage(id: string, name: string, business: string) {
  const template = greetingTemplates.find((t) => t.id === id);
  return template
    ? template.body.replace(/\{name\}|\{business\}/g, (token) =>
        token === "{name}"
          ? name.trim() || "there"
          : business.trim() || "our team",
      )
    : "";
}
