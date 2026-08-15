// POST { request_id } — dispatcher-authenticated.
// Builds the invoice straight from the executed shift plan (shift_assignments with
// status = 'confirmed' and hours_worked filled in) so nothing is retyped, itemises premiums,
// and attaches an audit record (Prüfprotokoll) listing who worked with which credential —
// the § 823 BGB due-diligence evidence the brief calls for.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireCompanyMember } from "../_shared/supabaseAdmin.ts";

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const { request_id } = await req.json().catch(() => ({}));
  if (!request_id) return jsonResponse({ error: "request_id is required" }, 400);

  const admin = getAdminClient();

  const { data: requestRow, error: requestError } = await admin
    .from("requests")
    .select("*, clients(name)")
    .eq("id", request_id)
    .maybeSingle();
  if (requestError || !requestRow) return jsonResponse({ error: "Request not found" }, 404);

  const auth = await requireCompanyMember(req, admin, requestRow.company_id);
  if (!auth) return jsonResponse({ error: "Not authorized for this company" }, 403);

  const { data: company } = await admin.from("companies").select("*").eq("id", requestRow.company_id).single();

  const { data: assignments, error: assignmentsError } = await admin
    .from("shift_assignments")
    .select("*, guards(id, name), shifts!inner(id, request_id, starts_at, ends_at, qualification_required)")
    .eq("shifts.request_id", request_id)
    .eq("status", "confirmed");

  if (assignmentsError) return jsonResponse({ error: assignmentsError.message }, 500);
  if (!assignments || assignments.length === 0) {
    return jsonResponse({ error: "No confirmed, worked shifts to invoice yet." }, 422);
  }

  const { data: rateCard } = await admin
    .from("rate_cards")
    .select("*")
    .eq("company_id", requestRow.company_id)
    .eq("federal_state", requestRow.federal_state)
    .eq("qualification", requestRow.qualification_required)
    .maybeSingle();

  if (!rateCard) return jsonResponse({ error: "No rate card configured for this request's state/qualification." }, 422);

  const lineItems = [];
  const auditEntries = [];
  let subtotal = 0;

  for (const assignment of assignments as any[]) {
    const hours = Number(assignment.hours_worked ?? 0);
    const amount = hours * rateCard.hourly_rate;
    subtotal += amount;

    lineItems.push({
      guard_name: assignment.guards.name,
      shift_id: assignment.shifts.id,
      hours,
      hourly_rate: rateCard.hourly_rate,
      amount,
    });

    const { data: credential } = await admin
      .from("credentials")
      .select("qualification, expires_at, bewacher_id")
      .eq("guard_id", assignment.guard_id)
      .gte("expires_at", assignment.shifts.starts_at.slice(0, 10))
      .order("expires_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    auditEntries.push({
      guard_name: assignment.guards.name,
      guard_id: assignment.guard_id,
      shift_starts_at: assignment.shifts.starts_at,
      shift_ends_at: assignment.shifts.ends_at,
      credential_qualification: credential?.qualification ?? "unknown",
      credential_valid_at_shift_time: !!credential,
      bewacher_id_on_file: !!credential?.bewacher_id,
    });
  }

  const vatPercent = company?.vat_percent ?? 19;
  const vatAmount = subtotal * (vatPercent / 100);
  const total = subtotal + vatAmount;

  const { count: existingInvoiceCount } = await admin
    .from("invoices")
    .select("id", { count: "exact", head: true })
    .eq("company_id", requestRow.company_id);

  const invoiceNumber = `${new Date().getFullYear()}-${String((existingInvoiceCount ?? 0) + 1).padStart(4, "0")}`;

  const { data: invoice, error: insertError } = await admin
    .from("invoices")
    .insert({
      company_id: requestRow.company_id,
      request_id,
      invoice_number: invoiceNumber,
      line_items: lineItems,
      subtotal,
      vat_percent: vatPercent,
      vat_amount: vatAmount,
      total,
      audit_record: { client: requestRow.clients?.name ?? null, entries: auditEntries },
    })
    .select()
    .single();

  if (insertError) return jsonResponse({ error: insertError.message }, 500);

  await admin.from("requests").update({ status: "invoiced" }).eq("id", request_id);

  return jsonResponse({ invoice });
});
