// GET  ?token=<portal_token>                        -> this guard's own data only
// POST { token, shift_assignment_id, action }        -> action: "accept" | "decline"
//
// No login. The unguessable UUID in the WhatsApp deep link *is* the credential — this
// function runs with the service role key specifically so it can look up exactly one
// guard's row by token without exposing every other guard through RLS. Never returns
// anything about other guards, other companies, or documents/Bewacher-IDs — only what
// the brief's employee surface asks for: own credentials + expiry, own hours, offered shifts.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient } from "../_shared/supabaseAdmin.ts";

async function loadGuardByToken(admin: ReturnType<typeof getAdminClient>, token: string) {
  const { data: guard } = await admin
    .from("guards")
    .select("id, name, company_id, active")
    .eq("portal_token", token)
    .maybeSingle();
  return guard;
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;

  const admin = getAdminClient();

  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return jsonResponse({ error: "token is required" }, 400);

    const guard = await loadGuardByToken(admin, token);
    if (!guard || !guard.active) return jsonResponse({ error: "Link not recognised." }, 404);

    const { data: credentials } = await admin
      .from("credentials")
      .select("qualification, expires_at, permitted_deployment")
      .eq("guard_id", guard.id)
      .order("expires_at", { ascending: true });

    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const { data: confirmedThisMonth } = await admin
      .from("shift_assignments")
      .select("hours_worked, shifts!inner(starts_at)")
      .eq("guard_id", guard.id)
      .eq("status", "confirmed")
      .gte("shifts.starts_at", startOfMonth.toISOString());

    const hoursThisMonth = (confirmedThisMonth ?? []).reduce((sum: number, row: any) => sum + Number(row.hours_worked ?? 0), 0);

    const { data: offered } = await admin
      .from("shift_assignments")
      .select("id, status, shifts!inner(starts_at, ends_at, qualification_required)")
      .eq("guard_id", guard.id)
      .in("status", ["proposed", "accepted", "confirmed"])
      .gte("shifts.starts_at", new Date().toISOString())
      .order("starts_at", { foreignTable: "shifts", ascending: true });

    return jsonResponse({
      guard: { name: guard.name },
      credentials,
      hours_this_month: hoursThisMonth,
      shifts: offered,
    });
  }

  if (req.method === "POST") {
    const { token, shift_assignment_id, action } = await req.json().catch(() => ({}));
    if (!token || !shift_assignment_id || !["accept", "decline"].includes(action)) {
      return jsonResponse({ error: "token, shift_assignment_id and a valid action are required" }, 400);
    }

    const guard = await loadGuardByToken(admin, token);
    if (!guard || !guard.active) return jsonResponse({ error: "Link not recognised." }, 404);

    const { data: assignment } = await admin
      .from("shift_assignments")
      .select("id, guard_id")
      .eq("id", shift_assignment_id)
      .maybeSingle();

    if (!assignment || assignment.guard_id !== guard.id) {
      return jsonResponse({ error: "Not your shift." }, 403);
    }

    const { error } = await admin
      .from("shift_assignments")
      .update({ status: action === "accept" ? "accepted" : "declined" })
      .eq("id", shift_assignment_id);

    if (error) return jsonResponse({ error: error.message }, 500);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
});
