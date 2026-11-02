import { useEffect, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { whatsappNumber } from "../../shared/whatsapp";
import {
  greetingTemplates,
  greetingMessage,
} from "../../shared/message-templates";
import { refresh, write } from "../api";
interface Props {
  leadId: string;
  name: string;
  phone: string;
  business?: string;
  disabled?: boolean;
  compact?: boolean;
  onError: (message: string) => void;
}
export function WhatsAppButton(props: Props) {
  const [composing, setComposing] = useState(false);
  const valid = Boolean(whatsappNumber(props.phone));
  return (
    <>
      <button
        type="button"
        className="button secondary whatsapp-button"
        disabled={props.disabled || !valid}
        aria-label={`WhatsApp ${props.name}`}
        title={
          valid
            ? "Choose a greeting or open a blank chat"
            : "Open lead details and enter a phone number with its country code"
        }
        onClick={(e) => {
          e.stopPropagation();
          setComposing(true);
        }}
      >
        <MessageCircle size={16} aria-hidden="true" />
        {props.compact ? "WhatsApp" : "Open WhatsApp"}
      </button>
      {composing && (
        <DraftDialog {...props} onClose={() => setComposing(false)} />
      )}
    </>
  );
}
function DraftDialog({
  leadId,
  name,
  phone,
  business = "our team",
  onClose,
  onError,
}: Props & { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [template, setTemplate] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const opener = document.activeElement as HTMLElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      opener?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
      aria-labelledby={`draft-${leadId}`}
      className="whatsapp-dialog"
    >
      <div className="detail">
        <div className="detail-top">
          <span className="eyebrow">WHATSAPP DRAFT</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Close WhatsApp draft"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>
        <h2 id={`draft-${leadId}`}>Message {name}</h2>
        <p className="settings-hint">To: {phone}</p>
        <label className="field-label">
          Greeting template
          <select
            value={template}
            disabled={busy}
            onChange={(e) => {
              setTemplate(e.target.value);
              setMessage(greetingMessage(e.target.value, name, business));
            }}
          >
            <option value="">No template / blank chat</option>
            {greetingTemplates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          Message preview (editable)
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
            rows={6}
            disabled={busy}
            placeholder="Select a greeting, write your own, or leave blank."
          />
        </label>
        <small className="settings-hint">
          {message.length}/2000 characters. WhatsApp opens with this draft.
          Review and tap Send there yourself. Opening changes New to Contacted;
          it does not confirm message delivery.
        </small>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="contact-links">
          <button
            type="button"
            className="button primary"
            disabled={busy}
            onClick={async () => {
              const target = window.open("about:blank", "_blank");
              if (!target) {
                setError(
                  "Allow pop-ups for this CRM, then try again. No status was changed.",
                );
                return;
              }
              target.opener = null;
              setBusy(true);
              setError("");
              onError("");
              try {
                const result = await write<{ url: string }>(
                  `/leads/${leadId}/whatsapp`,
                  { phone, message },
                );
                target.location.replace(result.url);
                refresh();
                onClose();
              } catch (e) {
                target.close();
                const detail = (e as Error).message;
                setError(detail);
                onError(detail);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Opening..." : "Open WhatsApp & mark contacted"}
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </dialog>
  );
}
