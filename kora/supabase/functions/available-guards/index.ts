// GET ?shift_id=... — dispatcher-authenticated.
// Returns every guard in the company with an `eligible` flag for this specific shift, so the
// planner UI can grey out / block staff who lack a valid credential or are already booked
// elsewhere, before the drag even lands. The database trigger enforces the same rule again
// on insert, so this is a UX convenience, not the security boundary.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireCompanyMember } from "../_shared/supabaseAdmin.ts";

const QUALIFICATION_RANK: Record<string, number> = { unterrichtung: 0, sachkunde: 1, meister: 2 };

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  const shiftId = url.searchParams.get("shift_id");
  if (!shiftId) return jsonResponse({ error: "shift_id is required" }, 400);

  const admin = getAdminClient();

  const { data: shift, error: shiftError } = await admin.from("shifts").select("*").eq("id", shiftId).maybeSingle();
  if (shiftError || !shift) return jsonResponse({ error: "Shift not found" }, 404);

  const auth = await requireCompanyMember(req, admin, shift.company_id);
  if (!auth) return jsonResponse({ error: "Not authorized for this company" }, 403);

  const { data: guards } = await admin
    .from("guards")
    .select("id, name, phone, active, credentials(qualification, expires_at)")
    .eq("company_id", shift.company_id)
    .eq("active", true);

  const { data: overlapping } = await admin
    .from("shift_assignments")
    .select("guard_id, shifts!inner(starts_at, ends_at, company_id)")
    .eq("shifts.company_id", shift.company_id)
    .neq("status", "declined");

  const shiftStart = new Date(shift.starts_at).getTime();
  const shiftEnd = new Date(shift.ends_at).getTime();
  const requiredRank = QUALIFICATION_RANK[shift.qualification_required] ?? 0;
  const shiftDateISO = shift.starts_at.slice(0, 10);

  const doubleBookedGuardIds = new Set(
    (overlapping ?? [])
      .filter((row: any) => {
        const s = new Date(row.shifts.starts_at).getTime();
        const e = new Date(row.shifts.ends_at).getTime();
        return s < shiftEnd && e > shiftStart;
      })
      .map((row: any) => row.guard_id),
  );

  const result = (guards ?? []).map((guard: any) => {
    const validCredential = (guard.credentials ?? []).find(
      (c: any) => c.expires_at >= shiftDateISO && (QUALIFICATION_RANK[c.qualification] ?? -1) >= requiredRank,
    );
    const doubleBooked = doubleBookedGuardIds.has(guard.id);

    let reason: string | null = null;
    if (!validCredential) reason = "No valid Bewacher-ID / credential for this duty type — no spot in the plan.";
    else if (doubleBooked) reason = "Already booked on an overlapping shift.";

    return {
      id: guard.id,
      name: guard.name,
      phone: guard.phone,
      eligible: !!validCredential && !doubleBooked,
      reason,
    };
  });

  return jsonResponse({ guards: result });
});
