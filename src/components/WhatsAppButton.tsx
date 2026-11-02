import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { whatsappNumber } from "../../shared/whatsapp";
import { refresh, write } from "../api";
export function WhatsAppButton({
  leadId,
  name,
  phone,
  disabled = false,
  compact = false,
  onError,
}: {
  leadId: string;
  name: string;
  phone: string;
  disabled?: boolean;
  compact?: boolean;
  onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const valid = Boolean(whatsappNumber(phone));
  return (
    <button
      type="button"
      className="button secondary whatsapp-button"
      disabled={disabled || busy || !valid}
      aria-label={`Open WhatsApp for ${name} and mark new lead contacted`}
      title={
        valid
          ? "Open WhatsApp; New leads become Contacted"
          : "Open lead details and enter a phone number with its country code"
      }
      onClick={async (event) => {
        event.stopPropagation();
        const target = window.open("about:blank", "_blank");
        if (!target) {
          onError(
            "Allow pop-ups for this CRM, then try WhatsApp again. No status was changed.",
          );
          return;
        }
        target.opener = null;
        setBusy(true);
        onError("");
        try {
          const result = await write<{ url: string }>(
            `/leads/${leadId}/whatsapp`,
            { phone },
          );
          target.location.replace(result.url);
          refresh();
        } catch (error) {
          target.close();
          onError((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <MessageCircle size={16} aria-hidden="true" />
      {busy
        ? "Opening�"
        : compact
          ? "WhatsApp"
          : "Open WhatsApp & mark contacted"}
    </button>
  );
}
