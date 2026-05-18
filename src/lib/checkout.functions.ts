import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { AnalysisResult } from "@/lib/analysis.types";

const SITE_URL = "https://vetthome.com";
const FROM_ADDRESS = "vett <noreply@roovr.co>";

function buildMagicLinkHtml(actionLink: string, opts: { heading: string; body: string; cta: string }): string {
  return `<!doctype html><html><body style="margin:0;padding:32px 0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:0 20px;">
    <div style="padding:0 0 24px;"><div style="font-size:20px;font-weight:700;color:#2D6A4F;letter-spacing:-0.01em;">● vett</div></div>
    <div style="background:#FFFDF9;border:1px solid rgba(26,17,8,0.12);border-radius:12px;padding:32px;">
      <h1 style="font-size:24px;font-weight:700;color:#1A1108;margin:0 0 12px;line-height:1.3;">${opts.heading}</h1>
      <p style="font-size:15px;color:#1A1108;line-height:1.6;margin:0 0 24px;">${opts.body}</p>
      <a href="${actionLink}" style="background:#2D6A4F;color:#FFFDF9;font-size:15px;font-weight:600;border-radius:8px;padding:14px 22px;text-decoration:none;display:inline-block;">${opts.cta}</a>
      <hr style="border:none;border-top:1px solid rgba(26,17,8,0.12);margin:28px 0 20px;" />
      <p style="font-size:13px;color:#888780;line-height:1.5;margin:0 0 8px;">If the button does not work, copy and paste this link into your browser:</p>
      <a href="${actionLink}" style="font-size:13px;color:#2D6A4F;word-break:break-all;">${actionLink}</a>
      <p style="font-size:13px;color:#888780;line-height:1.5;margin:20px 0 0;">If you did not request this, you can safely ignore this email.</p>
    </div>
    <div style="padding:24px 8px 0;text-align:center;"><p style="font-size:12px;color:#888780;margin:0;">© 2026 vett · vetthome.com · Every listing. Vetted. Instantly.</p></div>
  </div>
</body></html>`;
}

/**
 * Generate a Supabase magic link and send it directly via Resend.
 * Bypasses the Lovable email queue (kept commented below for restoration).
 */
async function sendMagicLinkViaResend(
  email: string,
  redirectTo: string,
  variant: "buyer-pass" | "access",
): Promise<{ ok: boolean; error?: string }> {
  console.log("Magic link flow started for:", email);

  const createRes = await supabaseAdmin.auth.admin.createUser({ email, email_confirm: true });
  if (createRes.error && !/already|registered|exists/i.test(createRes.error.message)) {
    console.error("createUser error:", createRes.error.message);
    return { ok: false, error: createRes.error.message };
  }
  console.log("User created/found:", createRes.data?.user?.id ?? "(existing)");

  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  const actionLink = linkData?.properties?.action_link;
  console.log("Magic link generated:", actionLink ? "yes" : "no");
  if (linkError || !actionLink) {
    console.error("generateLink error:", linkError?.message);
    return { ok: false, error: linkError?.message ?? "no action_link" };
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.error("RESEND_API_KEY not configured");
    return { ok: false, error: "RESEND_API_KEY missing" };
  }

  const subject = variant === "buyer-pass" ? "Activate your Buyer Pass" : "Your vett access link";
  const html = buildMagicLinkHtml(
    actionLink,
    variant === "buyer-pass"
      ? {
          heading: "Activate your Buyer Pass",
          body: "Thanks for purchasing a vett Buyer Pass. Click below to activate your account and get unlimited property analyses for 90 days, including flood risk data, AI chat, and more.",
          cta: "Activate my Buyer Pass →",
        }
      : {
          heading: "Your vett access link",
          body: "Click the button below to access your vett report.",
          cta: "Access my vett report →",
        },
  );

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_ADDRESS, to: email, subject, html }),
  });

  if (!resendResponse.ok) {
    const errText = await resendResponse.text();
    console.error("Resend API error:", errText);
    return { ok: false, error: errText };
  }

  console.log("Magic link email sent successfully via Resend to:", email);
  return { ok: true };
}

// ── Legacy Lovable email-queue path (kept for restoration) ──────────────────
// import * as React from "react";
// import { render } from "@react-email/components";
// import { MagicLinkEmail } from "@/lib/email-templates/magic-link";
// async function sendMagicLinkViaQueue(email: string, redirectTo: string) {
//   // ...generate link as above, then:
//   // const element = React.createElement(MagicLinkEmail, { siteName: "vett", confirmationUrl: actionLink });
//   // const html = await render(element);
//   // const text = await render(element, { plainText: true });
//   // await supabaseAdmin.rpc("enqueue_email", { queue_name: "auth_emails", payload: {
//   //   message_id: crypto.randomUUID(), to: email, from: "vett <noreply@roovr.co>",
//   //   sender_domain: "notify.roovr.co", subject: "Your vett access link",
//   //   html, text, purpose: "transactional", label: "magiclink",
//   //   queued_at: new Date().toISOString(), run_id: crypto.randomUUID(),
//   // }});
// }

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Missing STRIPE_SECRET_KEY");
  return new Stripe(key);
}

export const createCheckoutSession = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      priceId: z.string().min(1).max(200),
      listingUrl: z.string().max(2000).optional().default(""),
      tier: z.enum(["single", "pass"]),
      analysisJobId: z.string().uuid().optional(),
      source: z.string().max(40).optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ url: string }> => {
    const stripe = getStripe();
    const metadata: Record<string, string> = {
      tier: data.tier,
      listing_url: data.listingUrl,
    };
    if (data.analysisJobId) metadata.analysis_job_id = data.analysisJobId;
    if (data.source) metadata.source = data.source;

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: "gbp",
      line_items: [{ price: data.priceId, quantity: 1 }],
      customer_email: undefined,
      // collect email from customer
      customer_creation: "always",
      success_url: `${SITE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&tier=${data.tier}`,
      cancel_url: `${SITE_URL}/pricing`,
      metadata,
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    return { url: session.url };
  });

export const verifyCheckoutSession = createServerFn({ method: "POST" })
  .inputValidator(z.object({ sessionId: z.string().min(1).max(200) }))
  .handler(
    async ({
      data,
    }): Promise<{
      paid: boolean;
      tier: "single" | "pass" | null;
      email: string | null;
      token: string | null;
      listingUrl: string | null;
      hadAnalysisJob: boolean;
    }> => {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(data.sessionId);
      const paid = session.payment_status === "paid";
      const tier = (session.metadata?.tier as "single" | "pass" | undefined) ?? null;
      const email = session.customer_details?.email ?? null;
      const listingUrl = session.metadata?.listing_url ?? null;
      const hadAnalysisJob = Boolean(session.metadata?.analysis_job_id);

      let token: string | null = null;
      if (paid && tier === "single") {
        const { data: row } = await supabaseAdmin
          .from("single_report_tokens")
          .select("token, listing_url")
          .eq("stripe_session_id", data.sessionId)
          .maybeSingle();
        token = row?.token ?? null;
      }

      return { paid, tier, email, token, listingUrl, hadAnalysisJob };
    },
  );

export const sendBuyerPassMagicLink = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().email().max(320) }))
  .handler(async ({ data }): Promise<{ ok: boolean; found: boolean }> => {
    const email = data.email.trim().toLowerCase();
    const { data: bp } = await supabaseAdmin
      .from("buyer_pass_users")
      .select("email, expires_at")
      .ilike("email", email)
      .maybeSingle();

    let redirectTo = `${SITE_URL}/dashboard`;
    // Treat any buyer_pass_users row (active OR expired) as "found" so the
    // user can sign in and see the renewal state on the dashboard.
    let found = Boolean(bp);

    if (!found) {
      const { data: sr } = await supabaseAdmin
        .from("single_report_tokens")
        .select("token")
        .ilike("user_email", email)
        .limit(1)
        .maybeSingle();
      if (sr) {
        found = true;
        redirectTo = `${SITE_URL}/my-reports`;
      }
    }

    if (!found) {
      console.log("Magic link: no account found for", email);
      return { ok: true, found: false };
    }

    const res = await sendMagicLinkViaResend(email, redirectTo, "access");
    return { ok: res.ok, found: true };
  });

export const saveAnalysisForUser = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().email().max(320),
      listingUrl: z.string().max(2000).optional().nullable(),
      analysis: z.unknown(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const email = data.email.toLowerCase();

    // Allow if user has an ACTIVE Buyer Pass...
    const { data: bp } = await supabaseAdmin
      .from("buyer_pass_users")
      .select("email, expires_at")
      .ilike("email", email)
      .maybeSingle();
    let allowed = false;
    if (bp) {
      const exp = (bp as { expires_at: string | null }).expires_at;
      if (!exp || new Date(exp).getTime() > Date.now()) allowed = true;
    }

    // ...OR an active Single Report token for this email
    if (!allowed) {
      const { data: sr } = await supabaseAdmin
        .from("single_report_tokens")
        .select("token, expires_at")
        .ilike("user_email", email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (sr) {
        const exp = (sr as { expires_at: string }).expires_at;
        if (!exp || new Date(exp).getTime() > Date.now()) allowed = true;
      }
    }

    if (!allowed) return { ok: false };

    // Update existing row for same (email, listing_url) instead of inserting a duplicate.
    if (data.listingUrl) {
      const { data: existing } = await supabaseAdmin
        .from("saved_analyses")
        .select("id")
        .ilike("user_email", email)
        .eq("listing_url", data.listingUrl)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing) {
        await supabaseAdmin
          .from("saved_analyses")
          .update({ analysis_json: data.analysis as never })
          .eq("id", (existing as { id: string }).id);
        return { ok: true };
      }
    }

    await supabaseAdmin.from("saved_analyses").insert({
      user_email: email,
      listing_url: data.listingUrl ?? null,
      analysis_json: data.analysis as never,
    });
    return { ok: true };
  });

export const getSavedAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    console.log("[getSavedAnalysis] querying saved_analyses", { id: data.id, userId });
    const { data: row, error } = await supabase
      .from("saved_analyses")
      .select("id, listing_url, analysis_json, created_at, user_email")
      .eq("id", data.id)
      .maybeSingle();
    if (error) {
      console.error("[getSavedAnalysis] supabase error", { id: data.id, error });
      return { found: false as const, errorMessage: error.message };
    }
    if (!row) {
      console.warn("[getSavedAnalysis] no row found", { id: data.id });
      return { found: false as const };
    }
    return {
      found: true as const,
      listingUrl: (row as { listing_url: string | null }).listing_url,
      analysis: (row as unknown as { analysis_json: AnalysisResult }).analysis_json,
      userEmail: (row as { user_email: string | null }).user_email,
    };
  });
