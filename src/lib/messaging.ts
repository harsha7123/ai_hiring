
/**
 * Consent invitations by SMS or WhatsApp through Twilio's REST API.
 * Optional: when not configured, recruiters copy the invite link from the dashboard.
 */
export const messagingConfigured = () =>
  !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

export async function sendInvite(to: string, body: string): Promise<{ sent: boolean; error?: string }> {
  if (!messagingConfigured()) return { sent: false, error: "Messaging not configured" };
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const whatsapp = process.env.TWILIO_CHANNEL === "whatsapp";
  const params = new URLSearchParams({
    To: whatsapp ? `whatsapp:${to}` : to,
    From: whatsapp ? `whatsapp:${process.env.TWILIO_FROM}` : process.env.TWILIO_FROM!,
    Body: body,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { sent: false, error: `Twilio ${res.status}: ${(await res.text()).slice(0, 200)}` };
  return { sent: true };
}

/** E.164 normalisation with a default country code (India by default). */
export function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cc = process.env.DEFAULT_COUNTRY_CODE || "91";
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits.length >= 11 ? digits : null;
  const d = digits.replace(/^0+/, "");
  if (d.length === 10) return `+${cc}${d}`;
  if (d.length > 10 && d.length <= 15) return `+${d}`;
  return null;
}
