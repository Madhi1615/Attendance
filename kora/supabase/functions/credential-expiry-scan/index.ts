// POST (no body needed) — meant to be called once a day by Supabase's Cron (Dashboard →
// Edge Functions → your function → Cron, schedule e.g. "0 6 * * *"), not by the frontend.
// Protect it the same way as any internal call: X-Internal-Secret must match KORA_INTERNAL_SECRET.
//
// For every company: finds credentials expiring within 14 days and tells the AI assistant to
// warn the dispatcher (one WhatsApp message per guard, per the brief's example: "Elif's
// Sachkunde expires 30.09..."). Credentials already expired are not separately messaged again
// here — scheduling is already hard-blocked by the database trigger the moment they lapse.
import { jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";

const WARNING_WINDOW_DAYS = 14;

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const internalSecret = req.headers.get("X-Internal-Secret");
  if (internalSecret !== Deno.env.get("KORA_INTERNAL_SECRET")) {
    return jsonResponse({ error: "Not authorized" }, 403);
  }

  const admin = getAdminClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + WARNING_WINDOW_DAYS);
  const today = new Date().toISOString().slice(0, 10);

  const { data: expiring } = await admin
    .from("credentials")
    .select("id, qualification, expires_at, guard_id, company_id, guards(name)")
    .gte("expires_at", today)
    .lte("expires_at", cutoff.toISOString().slice(0, 10));

  let warned = 0;
  for (const credential of expiring ?? []) {
    const res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-assistant`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Secret": Deno.env.get("KORA_INTERNAL_SECRET") ?? "",
      },
      body: JSON.stringify({
        mode: "proactive",
        event: "credential_expiring",
        company_id: (credential as any).company_id,
        guard_name: (credential as any).guards?.name,
        qualification: (credential as any).qualification,
        expires_at: (credential as any).expires_at,
      }),
    });
    if (res.ok) warned++;
  }

  return jsonResponse({ scanned: expiring?.length ?? 0, warned });
});
