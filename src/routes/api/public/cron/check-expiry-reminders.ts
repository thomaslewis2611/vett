import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const FROM_ADDRESS = "Roovr <noreply@roovr.co>";

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function buildHtml(expiryDate: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Your Buyer Pass expires soon</title></head>
<body style="margin:0;padding:0;background:#F5F1EC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F1EC;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:#1a1a1a;padding:24px 32px;">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#2D6A4F;vertical-align:middle;margin-right:8px;"></span>
          <span style="color:#ffffff;font-size:18px;font-weight:600;vertical-align:middle;">Roovr</span>
        </td></tr>
        <tr><td style="padding:40px 32px 24px 32px;">
          <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.3;color:#1a1a1a;">Your Buyer Pass expires soon</h1>
          <p style="margin:0 0 24px 0;font-size:15px;line-height:1.6;color:#444;">
            Your Roovr Buyer Pass expires on <strong>${formatDate(expiryDate)}</strong>. Renew now to keep unlimited access to property analyses, AI chat, flood risk data, and more.
          </p>
          <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#2D6A4F;border-radius:999px;">
            <a href="https://roovr.co/pricing" style="display:inline-block;padding:14px 24px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;">Renew my Buyer Pass — £24.99 →</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding:24px 32px 32px 32px;border-top:1px solid #eee;font-size:12px;color:#888780;line-height:1.6;">
          © 2026 Roovr · roovr.co · Every listing. Analysed. Instantly.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendWithTimeout(apiKey: string, to: string, html: string): Promise<{ ok: boolean; error?: string }> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 10_000);
  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to,
        subject: "Your Roovr Buyer Pass expires in 14 days",
        html,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) return { ok: false, error: await resp.text() };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

export const Route = createFileRoute("/api/public/cron/check-expiry-reminders")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const resendKey = process.env.RESEND_API_KEY;
        const cronSecret = process.env.CRON_SECRET;
        if (!supabaseUrl || !serviceKey || !resendKey || !cronSecret) {
          return new Response(JSON.stringify({ error: "missing env" }), { status: 500 });
        }

        const provided = request.headers.get("x-cron-secret");
        if (!provided || provided !== cronSecret) {
          return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
        }

        const supabase = createClient(supabaseUrl, serviceKey);

        const lower = new Date(Date.now() + 13 * 86400_000).toISOString();
        const upper = new Date(Date.now() + 15 * 86400_000).toISOString();

        const { data: rows, error } = await supabase
          .from("buyer_pass_users")
          .select("id, email, expires_at")
          .gte("expires_at", lower)
          .lte("expires_at", upper)
          .eq("renewal_reminder_sent", false);

        if (error) {
          console.error("[reminders] query error", error);
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }

        const results: Array<{ email: string; ok: boolean; error?: string }> = [];
        for (const row of rows ?? []) {
          if (!row.email || !row.expires_at) continue;
          const html = buildHtml(row.expires_at);
          const send = await sendWithTimeout(resendKey, row.email, html);
          if (send.ok) {
            const { error: upErr } = await supabase
              .from("buyer_pass_users")
              .update({ renewal_reminder_sent: true })
              .eq("id", row.id);
            if (upErr) console.error("[reminders] update error", row.email, upErr);
          } else {
            console.error("[reminders] send failed", row.email, send.error);
          }
          results.push({ email: row.email, ok: send.ok, error: send.error });
        }

        return new Response(JSON.stringify({ processed: results.length, results }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      GET: async () => new Response("ok", { status: 200 }),
    },
  },
});
