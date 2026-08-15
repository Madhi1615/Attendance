// POST — the KORA assistant itself. Two invocation shapes:
//
// 1. Proactive (called by credential-expiry-scan, or by the frontend right after a request
//    is created / an invoice is generated):
//      { mode: "proactive", event, company_id, ...event-specific fields }
//    Facts (amounts, dates, names) are computed deterministically in this file from the
//    database — never invented by the model — and Claude is only asked to phrase the
//    German WhatsApp text in the house tone (du, short sentences, "Zettelchaos"-style
//    vocabulary, never "Lösung"/"Plattform"/"digitalisieren").
//
// 2. Inbound reply (called by whatsapp-webhook when a dispatcher texts KORA):
//      { mode: "inbound_reply", company_id, from_phone, message_text }
//    Claude answers using a small tool-calling loop over read-only DB lookups, so answers
//    are grounded in real data rather than guessed.
//
// Auth: internal callers (webhook, scan) send X-Internal-Secret matching KORA_INTERNAL_SECRET.
// Dispatcher-triggered calls from the frontend send a normal Supabase JWT instead.
import { handleOptions, jsonResponse } from "../_shared/cors.ts";
import { getAdminClient, requireCompanyMember } from "../_shared/supabaseAdmin.ts";
import { sendWhatsAppText } from "../_shared/whatsapp.ts";

const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") ?? "claude-sonnet-5";

const SYSTEM_PROMPT = `You are KORA, an AI assistant built into a German security-firm scheduling product.
You message dispatchers (Disponenten) directly over WhatsApp. Voice: du-form, short sentences,
the customer's own vocabulary (Zettelchaos, Dienstplan, Schicht, Nachweis). Never say "Lösung",
"Plattform" or "digitalisieren". Never claim you checked an ID against the federal Bewacherregister —
there is no public API for that; you only know what was stored after the employer's own registration.
Never put a Bewacher-ID, a credential document, or a full ID number in a message body.
Be concise: one to three sentences, always with concrete numbers/dates when you have them.`;

async function callAnthropic(messages: unknown[], tools?: unknown[]): Promise<any> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages,
      ...(tools ? { tools } : {}),
    }),
  });

  if (!res.ok) throw new Error(`Anthropic API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function phraseMessage(facts: string): Promise<string> {
  const response = await callAnthropic([
    { role: "user", content: `Write the WhatsApp message to send now, based on these facts:\n${facts}` },
  ]);
  const textBlock = response.content?.find((b: any) => b.type === "text");
  return textBlock?.text?.trim() ?? facts;
}

// --- Read-only tools available to the inbound-reply loop -----------------------------------

const TOOLS = [
  {
    name: "get_open_requests",
    description: "List requests that are new or quoted (not yet fully planned) for this company.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_unfilled_shifts",
    description: "List shifts for this company that still need more guards assigned.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "get_expiring_credentials",
    description: "List guards whose credential expires within the given number of days.",
    input_schema: {
      type: "object",
      properties: { within_days: { type: "number", description: "Look-ahead window in days, default 30" } },
      required: [],
    },
  },
];

async function runTool(admin: ReturnType<typeof getAdminClient>, companyId: string, name: string, input: any) {
  if (name === "get_open_requests") {
    const { data } = await admin
      .from("requests")
      .select("id, title, starts_at, guards_required, status")
      .eq("company_id", companyId)
      .in("status", ["new", "quoted"])
      .order("starts_at", { ascending: true })
      .limit(10);
    return data ?? [];
  }

  if (name === "get_unfilled_shifts") {
    const { data: shifts } = await admin
      .from("shifts")
      .select("id, starts_at, ends_at, qualification_required, requests(title)")
      .eq("company_id", companyId)
      .gte("starts_at", new Date().toISOString())
      .limit(20);

    const result = [];
    for (const shift of shifts ?? []) {
      const { count } = await admin
        .from("shift_assignments")
        .select("id", { count: "exact", head: true })
        .eq("shift_id", (shift as any).id)
        .neq("status", "declined");
      result.push({ ...shift, guards_assigned: count ?? 0 });
    }
    return result;
  }

  if (name === "get_expiring_credentials") {
    const withinDays = Number(input?.within_days ?? 30);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + withinDays);
    const { data } = await admin
      .from("credentials")
      .select("qualification, expires_at, guards!inner(name, company_id)")
      .eq("guards.company_id", companyId)
      .lte("expires_at", cutoff.toISOString().slice(0, 10))
      .order("expires_at", { ascending: true });
    return data ?? [];
  }

  return { error: `Unknown tool ${name}` };
}

async function handleInboundReply(admin: ReturnType<typeof getAdminClient>, companyId: string, fromPhone: string, messageText: string) {
  const messages: any[] = [{ role: "user", content: messageText }];

  for (let iteration = 0; iteration < 4; iteration++) {
    const response = await callAnthropic(messages, TOOLS);
    const toolUses = (response.content ?? []).filter((b: any) => b.type === "tool_use");

    if (toolUses.length === 0) {
      const textBlock = (response.content ?? []).find((b: any) => b.type === "text");
      return textBlock?.text?.trim() ?? "Ich konnte das gerade nicht verarbeiten.";
    }

    messages.push({ role: "assistant", content: response.content });
    const toolResults = [];
    for (const toolUse of toolUses) {
      const result = await runTool(admin, companyId, toolUse.name, toolUse.input);
      toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(result) });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return "Dazu brauche ich noch etwas mehr Zeit — schau gleich im Dashboard nach.";
}

Deno.serve(async (req) => {
  const preflight = handleOptions(req);
  if (preflight) return preflight;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => ({}));
  const admin = getAdminClient();

  const internalSecret = req.headers.get("X-Internal-Secret");
  const isInternal = !!internalSecret && internalSecret === Deno.env.get("KORA_INTERNAL_SECRET");

  if (!isInternal) {
    const auth = await requireCompanyMember(req, admin, body.company_id);
    if (!auth) return jsonResponse({ error: "Not authorized for this company" }, 403);
  }

  const { data: company } = await admin.from("companies").select("*").eq("id", body.company_id).maybeSingle();
  if (!company) return jsonResponse({ error: "Company not found" }, 404);

  if (body.mode === "inbound_reply") {
    const replyText = await handleInboundReply(admin, company.id, body.from_phone, body.message_text);
    const sent = await sendWhatsAppText(body.from_phone, replyText);
    await admin.from("whatsapp_messages").insert({
      company_id: company.id,
      to_phone: body.from_phone,
      direction: "outbound",
      body: replyText,
      wa_message_id: sent?.id ?? null,
    });
    return jsonResponse({ reply: replyText });
  }

  if (body.mode === "proactive") {
    let facts = "";
    let target = company.whatsapp_dispatcher_phone;

    if (body.event === "new_request_quoted") {
      const { data: request } = await admin.from("requests").select("*, clients(name)").eq("id", body.request_id).maybeSingle();
      const { data: quote } = await admin
        .from("quotes")
        .select("*")
        .eq("request_id", body.request_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      facts = `New request from ${request?.clients?.name ?? "a client"} in ${request?.location ?? request?.federal_state}, starting ${request?.starts_at}, ${request?.guards_required} guards needed. Quote total: €${quote?.total?.toFixed(2)}.`;
    } else if (body.event === "unfilled_slots") {
      facts = `${body.unfilled_count} slot(s) still unfilled for request "${body.request_title}" on ${body.shift_date}. ${body.available_count} guard(s) are available. Ask whether to reach out to them.`;
    } else if (body.event === "credential_expiring") {
      facts = `${body.guard_name}'s ${body.qualification} credential expires on ${body.expires_at}. From that date KORA will block them for scheduling until a new certificate is filed.`;
    } else if (body.event === "invoice_ready") {
      const { data: invoice } = await admin.from("invoices").select("*").eq("id", body.invoice_id).maybeSingle();
      facts = `Invoice ${invoice?.invoice_number} is ready: €${invoice?.total?.toFixed(2)} including premiums and VAT (${invoice?.vat_percent}%). Audit record attached in the dashboard.`;
    } else {
      return jsonResponse({ error: `Unknown event ${body.event}` }, 400);
    }

    if (!target) return jsonResponse({ error: "Company has no whatsapp_dispatcher_phone configured" }, 422);

    const messageText = await phraseMessage(facts);
    const sent = await sendWhatsAppText(target, messageText);
    await admin.from("whatsapp_messages").insert({
      company_id: company.id,
      to_phone: target,
      direction: "outbound",
      body: messageText,
      wa_message_id: sent?.id ?? null,
    });
    return jsonResponse({ sent: !!sent, message: messageText });
  }

  return jsonResponse({ error: "mode must be 'proactive' or 'inbound_reply'" }, 400);
});
