// Thin client for the Meta WhatsApp Cloud API. Requires two secrets set on the Supabase
// project (Project Settings → Edge Functions → Secrets):
//   WHATSAPP_TOKEN            permanent access token from Meta Business Manager
//   WHATSAPP_PHONE_NUMBER_ID  the sending number's ID (not the phone number itself)
//
// Rule from the product brief, enforced here structurally: message bodies never carry
// credentials, Bewacher-IDs, or documents — only short text and, where needed, a link to
// data that lives behind Supabase auth/RLS.
export async function sendWhatsAppText(toPhoneE164: string, body: string): Promise<{ id: string } | null> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneNumberId) {
    console.error("WhatsApp secrets not configured; message not sent:", body);
    return null;
  }

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhoneE164.replace(/^\+/, ""),
      type: "text",
      text: { body },
    }),
  });

  if (!res.ok) {
    console.error("WhatsApp send failed", res.status, await res.text());
    return null;
  }

  const json = await res.json();
  return { id: json?.messages?.[0]?.id ?? "" };
}

// Verifies the X-Hub-Signature-256 header Meta sends on every webhook POST, using the
// app secret (WHATSAPP_APP_SECRET). Rejects anything that isn't provably from Meta.
export async function verifyMetaSignature(req: Request, rawBody: string): Promise<boolean> {
  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!appSecret) return false;

  const signatureHeader = req.headers.get("x-hub-signature-256") ?? "";
  const expectedPrefix = "sha256=";
  if (!signatureHeader.startsWith(expectedPrefix)) return false;
  const providedHex = signatureHeader.slice(expectedPrefix.length);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const computedHex = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  if (computedHex.length !== providedHex.length) return false;
  let diff = 0;
  for (let i = 0; i < computedHex.length; i++) {
    diff |= computedHex.charCodeAt(i) ^ providedHex.charCodeAt(i);
  }
  return diff === 0;
}
