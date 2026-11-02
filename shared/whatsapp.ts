/** Accept explicit international numbers; never guess a country from a local number. */
export function whatsappNumber(value: string): string | null {
  const input = value.trim();
  if (!/^(?:\+|00)?[\d\s().-]+$/.test(input)) return null;
  const digits = input.replace(/\D/g, "").replace(/^00/, "");
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}
