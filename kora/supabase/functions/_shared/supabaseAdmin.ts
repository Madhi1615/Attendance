import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// Service-role client. Bypasses Row Level Security — only ever used inside edge functions
// running on Supabase's servers, never sent to the browser. Each function that uses this
// is responsible for its own narrow authorization check before touching the database.
export function getAdminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Verifies the caller's JWT (sent as "Authorization: Bearer <token>" by the frontend's
// supabase-js client) and confirms they belong to the given company before letting an
// edge function act on that company's data.
export async function requireCompanyMember(
  req: Request,
  admin: SupabaseClient,
  companyId: string,
): Promise<{ userId: string } | null> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return null;

  const { data: userData, error } = await admin.auth.getUser(token);
  if (error || !userData?.user) return null;

  const { data: membership } = await admin
    .from("company_members")
    .select("company_id")
    .eq("user_id", userData.user.id)
    .eq("company_id", companyId)
    .maybeSingle();

  if (!membership) return null;
  return { userId: userData.user.id };
}
