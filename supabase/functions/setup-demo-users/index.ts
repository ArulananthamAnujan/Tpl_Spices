import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results: any[] = [];

  const demoUsers = [
    { email: "admin@tplspices.com",    password: "Admin@123",    role: "super_admin", fullName: "TPL Admin" },
    { email: "staff@tplspices.com",    password: "Staff@123",    role: "staff",       fullName: "TPL Staff" },
    { email: "customer@tplspices.com", password: "Customer@123", role: "customer",    fullName: "Demo Customer" },
  ];

  for (const u of demoUsers) {
    // Delete existing user by email (if any)
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
    const found = existing?.users?.find((x: any) => x.email === u.email);
    if (found) {
      await supabaseAdmin.auth.admin.deleteUser(found.id);
    }

    // Create properly via Admin API
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { full_name: u.fullName },
    });

    if (error) {
      results.push({ email: u.email, status: "error", error: error.message });
      continue;
    }

    const userId = data.user.id;

    // Upsert profile with correct role
    const { error: profileErr } = await supabaseAdmin
      .from("profiles")
      .upsert({ id: userId, role: u.role, full_name: u.fullName }, { onConflict: "id" });

    results.push({
      email: u.email,
      status: profileErr ? "profile_error" : "ok",
      userId,
      role: u.role,
      profileError: profileErr?.message ?? null,
    });
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
