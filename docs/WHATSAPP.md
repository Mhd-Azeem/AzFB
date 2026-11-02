# WhatsApp contact attempts

The live Leads table includes a WhatsApp button beside every submission, with an Add / fix number shortcut when the phone is missing or invalid. The list and profile share the same contact component and backend workflow.

Open a live lead profile, verify the international phone number, then choose **Open WhatsApp & mark contacted**. The number input allows a correction for this attempt only; it does not overwrite the original Meta answer. Numbers require a country code (for example +94771234567); local numbers starting with zero and extensions are rejected rather than guessed.

The authenticated, CSRF-protected POST /api/leads/:id/whatsapp endpoint validates the number, enforces workspace ownership, atomically changes only New to Contacted, and records a timestamped attempt plus audit event. Interested, Converted, Rejected and other existing stages are preserved. No migration or WhatsApp API credentials are required.

The browser opens a blank tab synchronously, then navigates after the database write succeeds. Blocked popups prevent the write; server errors close the tab and display a retryable error. A lost response can leave the saved attempt recorded even if navigation failed; retrying preserves the stage and logs another attempt. Opening a chat is not proof of account existence, message sending, delivery or reply. No message is transmitted automatically. If the destination is invalid or the user cancels, the lead stage can be corrected manually. Desktop users may need to sign into WhatsApp Web; mobile users may need WhatsApp installed. Contact only the intended number with appropriate permission.
