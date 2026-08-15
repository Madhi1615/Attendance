// GET  — Meta's one-time webhook verification handshake (hub.mode/hub.verify_token/hub.challenge)
// POST — inbound WhatsApp messages from dispatchers. Verifies Meta's signature, logs the
//        message, then hands it to the ai-assistant function to draft and send a reply.
//
// Configure in Meta Developer Console → WhatsApp → Configuration → Webhook:
//   Callback URL:  https://<project-ref>.supabase.co/functions/v1/whatsapp-webhook
//   Verify token:  must match the WHATSAPP_VERIFY_TOKEN secret below
import { getAdminClient } from "../_shared/supabaseAdmin.ts";

Deno.serve(async (req) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === Deno.env.get("WHATSAPP_VERIFY_TOKEN")) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const rawBody = await req.text();

  const { verifyMetaSignature } = await import("../_shared/whatsapp.ts");
  const validSignature = await verifyMetaSignature(req, rawBody);
  if (!validSignature) return new Response("Invalid signature", { status: 401 });

  const payload = JSON.parse(rawBody);
  const admin = getAdminClient();

  const changes = payload?.entry?.[0]?.changes?.[0]?.value;
  const message = changes?.messages?.[0];
  if (!message) {
    // Delivery receipts / status callbacks — nothing to do.
    return new Response("ok", { status: 200 });
  }

  const fromPhone = `+${message.from}`;
  const text = message.text?.body ?? "";

  // Match the sender to a company by their registered dispatcher phone number.
  const { data: company } = await admin
    .from("companies")
    .select("id")
    .eq("whatsapp_dispatcher_phone", fromPhone)
    .maybeSingle();

  await admin.from("whatsapp_messages").insert({
    company_id: company?.id ?? null,
    from_phone: fromPhone,
    direction: "inbound",
    body: text,
    wa_message_id: message.id,
  });

  if (company) {
    // Hand off to the AI assistant to interpret and reply. Internal call, authenticated
    // with a shared secret rather than a dispatcher JWT since this is a server-to-server hop.
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-assistant`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": Deno.env.get("KORA_INTERNAL_SECRET") ?? "",
      },
      body: JSON.stringify({
        mode: "inbound_reply",
        company_id: company.id,
        from_phone: fromPhone,
        message_text: text,
      }),
    }).catch((err) => console.error("Failed to invoke ai-assistant", err));
  }

  return new Response("ok", { status: 200 });
});
