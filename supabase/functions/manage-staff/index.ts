import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Admin-only staff account management.
//
// Creating an auth user requires the service-role key, which must never be
// exposed to the browser — so it happens here. Every request is verified to
// come from a signed-in super_admin before any privileged work is done.
//
// Actions:
//   create         { email, password, full_name, role, assigned_store_id }
//   delete         { user_id }
//   reset_password { user_id, password }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    // 1. Identify the caller from their own JWT.
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: authErr } = await supabaseClient.auth.getUser();
    if (!user || authErr) return json({ error: "Unauthorized" }, 401);

    // 2. Service-role client for the privileged work.
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 3. Only super admins may manage staff.
    const { data: callerProfile } = await supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (callerProfile?.role !== "super_admin") {
      return json({ error: "Only a super admin can manage staff accounts." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action as string | undefined;

    // ---------------------------------------------------------- CREATE
    if (action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const fullName = String(body.full_name ?? "").trim();
      const role = String(body.role ?? "staff");
      const storeId = body.assigned_store_id ? String(body.assigned_store_id) : null;

      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return json({ error: "Enter a valid email address." }, 400);
      }
      if (password.length < 8) {
        return json({ error: "Password must be at least 8 characters." }, 400);
      }
      if (!["staff", "super_admin"].includes(role)) {
        return json({ error: "Role must be staff or super_admin." }, 400);
      }

      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // no confirmation email needed for internal accounts
        user_metadata: { full_name: fullName },
      });

      if (createErr || !created?.user) {
        const msg = createErr?.message ?? "Could not create the account.";
        const friendly = /already|registered|exists/i.test(msg)
          ? "An account with that email already exists."
          : msg;
        return json({ error: friendly }, 400);
      }

      // The on-signup trigger inserts a 'customer' profile; upsert the real role.
      const { error: profileErr } = await supabaseAdmin
        .from("profiles")
        .upsert(
          { id: created.user.id, role, full_name: fullName, assigned_store_id: storeId },
          { onConflict: "id" },
        );

      if (profileErr) {
        // Don't leave a half-made account behind.
        await supabaseAdmin.auth.admin.deleteUser(created.user.id);
        return json({ error: `Account created but role could not be set: ${profileErr.message}` }, 500);
      }

      return json({ success: true, user_id: created.user.id, email });
    }

    // ---------------------------------------------------------- DELETE
    if (action === "delete") {
      const userId = String(body.user_id ?? "");
      if (!userId) return json({ error: "Missing user_id." }, 400);
      if (userId === user.id) {
        return json({ error: "You cannot delete your own account." }, 400);
      }

      const { error: delErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
      if (delErr) {
        // A profile referenced by existing orders can't be removed.
        const friendly = /foreign key|violates/i.test(delErr.message)
          ? "This account has order history and can't be deleted. Change their role to Customer instead."
          : delErr.message;
        return json({ error: friendly }, 400);
      }
      return json({ success: true });
    }

    // -------------------------------------------------- RESET PASSWORD
    if (action === "reset_password") {
      const userId = String(body.user_id ?? "");
      const password = String(body.password ?? "");
      if (!userId) return json({ error: "Missing user_id." }, 400);
      if (password.length < 8) {
        return json({ error: "Password must be at least 8 characters." }, 400);
      }

      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, { password });
      if (updErr) return json({ error: updErr.message }, 400);
      return json({ success: true });
    }

    return json({ error: "Unknown action." }, 400);
  } catch (err) {
    return json({ error: (err as Error).message ?? "Unexpected error" }, 500);
  }
});
