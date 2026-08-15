// POST { guard_id, body } — dispatcher-authenticated.
// Manual send: lets a dispatcher trigger a one-off WhatsApp text to a guard from the UI
// (e.g. "ask them directly") without going through the AI assistant. Automatic/proactive
// messages are sent by ai-assistant and credential-expiry-scan instead, which call
// sendWhatsAppText directly.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireCompanyMember } from "../_shared/supabaseAdmin.ts";
import { sendWhatsAppText } from "../_shared/whatsapp.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const { guard_id, body } = await req.json().catch(() => ({}));
  if (!guard_id || !body) return jsonResponse({ error: "guard_id and body are required" }, 400);

  const admin = getAdminClient();

  const { data: guard } = await admin.from("guards").select("id, company_id, phone, name").eq("id", guard_id).maybeSingle();
  if (!guard) return jsonResponse({ error: "Guard not found" }, 404);
  if (!guard.phone) return jsonResponse({ error: "Guard has no phone number on file" }, 422);

  const auth = await requireCompanyMember(req, admin, guard.company_id);
  if (!auth) return jsonResponse({ error: "Not authorized for this company" }, 403);

  const sent = await sendWhatsAppText(guard.phone, body);

  await admin.from("whatsapp_messages").insert({
    company_id: guard.company_id,
    guard_id: guard.id,
    to_phone: guard.phone,
    direction: "outbound",
    body,
    wa_message_id: sent?.id ?? null,
  });

  return jsonResponse({ sent: !!sent });
});
