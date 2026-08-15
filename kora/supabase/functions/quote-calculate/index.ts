// POST { request_id, margin_percent? } — dispatcher-authenticated.
// Computes the staffing cost for a request from its guards_required/qualification_required
// and the company's rate card, applies night/Sunday/holiday premiums, then the margin slider,
// and stores the result as a quote row so it can be reused for the PDF offer.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireCompanyMember } from "../_shared/supabaseAdmin.ts";
import { calculateShiftCost } from "../_shared/rates.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const { request_id, margin_percent } = await req.json().catch(() => ({}));
  if (!request_id) return jsonResponse({ error: "request_id is required" }, 400);

  const admin = getAdminClient();

  const { data: requestRow, error: requestError } = await admin
    .from("requests")
    .select("*")
    .eq("id", request_id)
    .maybeSingle();
  if (requestError || !requestRow) return jsonResponse({ error: "Request not found" }, 404);

  const auth = await requireCompanyMember(req, admin, requestRow.company_id);
  if (!auth) return jsonResponse({ error: "Not authorized for this company" }, 403);

  const { data: rateCard } = await admin
    .from("rate_cards")
    .select("*")
    .eq("company_id", requestRow.company_id)
    .eq("federal_state", requestRow.federal_state)
    .eq("qualification", requestRow.qualification_required)
    .maybeSingle();

  if (!rateCard) {
    return jsonResponse(
      { error: `No rate card for ${requestRow.federal_state} / ${requestRow.qualification_required}. Add one under Settings → Rate cards first.` },
      422,
    );
  }

  const perGuard = calculateShiftCost(
    { start: new Date(requestRow.starts_at), end: new Date(requestRow.ends_at) },
    rateCard,
  );

  const guardsRequired = requestRow.guards_required as number;
  const hourlyCost = perGuard.base * guardsRequired;
  const premiumsCost = perGuard.premiumsTotal * guardsRequired;
  const subtotal = hourlyCost + premiumsCost;

  const margin = typeof margin_percent === "number" ? margin_percent : 20;
  const total = subtotal * (1 + margin / 100);

  const breakdown = {
    guards_required: guardsRequired,
    hourly_rate: rateCard.hourly_rate,
    per_guard: perGuard,
    federal_state: requestRow.federal_state,
    qualification: requestRow.qualification_required,
  };

  const { data: quote, error: insertError } = await admin
    .from("quotes")
    .insert({
      request_id,
      company_id: requestRow.company_id,
      hourly_cost: hourlyCost,
      premiums_cost: premiumsCost,
      margin_percent: margin,
      subtotal,
      total,
      breakdown,
    })
    .select()
    .single();

  if (insertError) return jsonResponse({ error: insertError.message }, 500);

  await admin.from("requests").update({ status: "quoted" }).eq("id", request_id);

  return jsonResponse({ quote });
});
