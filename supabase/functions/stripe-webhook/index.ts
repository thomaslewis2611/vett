// Stripe webhook handler. Verifies signature using STRIPE_WEBHOOK_SECRET,
// then on checkout.session.completed creates the right access record.
import Stripe from "https://esm.sh/stripe@17.5.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripeKey = Deno.env.get("STRIPE_SECRET_KEY")!;
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

const SITE_URL = "https://roovr.co";
const FROM_ADDRESS = "Roovr <noreply@roovr.co>";

type EmailVariant = "single" | "pass";

const SINGLE_REPORT_PRICE_ID = "price_1TWXsjCfTT0mXB2cPz7SPIOL";
const BUYER_PASS_PRICE_ID = "price_1TWtPLCfTT0mXB2cU829oJlb";

const EMAIL_COPY: Record<EmailVariant, {
  subject: string;
  heading: string;
  body: string;
  button: string;
  textIntro: string;
}> = {
  single: {
    subject: "Your Roovr report is ready",
    heading: "Your report is ready",
    body: "Your property analysis is saved to your account. Click below to access your full report.",
    button: "Access my report →",
    textIntro: "Your Roovr report is ready",
  },
  pass: {
    subject: "Activate your Roovr Buyer Pass",
    heading: "Activate your Buyer Pass",
    body: "Thanks for purchasing a Roovr Buyer Pass. Click below to activate your account and get unlimited property analyses for 90 days, including flood risk data, AI chat, and more.",
    button: "Activate my Buyer Pass →",
    textIntro: "Activate your Roovr Buyer Pass",
  },
};

function buildMagicLinkHtml(actionLink: string, variant: EmailVariant): { html: string; text: string } {
  const c = EMAIL_COPY[variant];
  const html = `<!doctype html><html><body style="margin:0;padding:32px 0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:0 20px;">
    <div style="padding:0 0 24px;"><div style="font-size:20px;font-weight:700;color:#2D6A4F;letter-spacing:-0.01em;">● Roovr</div></div>
    <div style="background:#FFFDF9;border:1px solid rgba(26,17,8,0.12);border-radius:12px;padding:32px;">
      <h1 style="font-size:24px;font-weight:700;color:#1A1108;margin:0 0 12px;line-height:1.3;">${c.heading}</h1>
      <p style="font-size:15px;color:#1A1108;line-height:1.6;margin:0 0 24px;">${c.body}</p>
      <a href="${actionLink}" style="background:#2D6A4F;color:#FFFDF9;font-size:15px;font-weight:600;border-radius:8px;padding:14px 22px;text-decoration:none;display:inline-block;">${c.button}</a>
      <hr style="border:none;border-top:1px solid rgba(26,17,8,0.12);margin:28px 0 20px;" />
      <p style="font-size:13px;color:#888780;line-height:1.5;margin:0 0 8px;">If the button does not work, copy and paste this link into your browser:</p>
      <a href="${actionLink}" style="font-size:13px;color:#2D6A4F;word-break:break-all;">${actionLink}</a>
      <p style="font-size:13px;color:#888780;line-height:1.5;margin:20px 0 0;">If you did not request this, you can safely ignore this email.</p>
    </div>
    <div style="padding:24px 8px 0;text-align:center;"><p style="font-size:12px;color:#888780;margin:0;">© 2026 Roovr · roovr.co · Every listing. Analysed. Instantly.</p></div>
  </div>
</body></html>`;
  const text = `${c.textIntro}\n\n${c.body}\n${actionLink}\n\nIf you did not request this, you can safely ignore this email.`;
  return { html, text };
}

async function sendMagicLinkEdge(
  email: string,
  redirectTo: string,
  variant: EmailVariant,
): Promise<void> {
  console.log(`Magic link flow started for: ${email} (variant=${variant})`);

  const { data: createData, error: createErr } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createErr && !/already|registered|exists/i.test(createErr.message)) {
    console.error("createUser error:", createErr.message);
    return;
  }
  console.log("User created/found:", createData?.user?.id ?? "(existing)");

  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  // deno-lint-ignore no-explicit-any
  const actionLink = (linkData as any)?.properties?.action_link as string | undefined;
  console.log("Magic link generated:", actionLink ? "yes" : "no");
  if (linkErr || !actionLink) {
    console.error("generateLink error:", linkErr?.message);
    return;
  }

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) {
    console.error("RESEND_API_KEY not configured");
    return;
  }

  const copy = EMAIL_COPY[variant];
  const { html } = buildMagicLinkHtml(actionLink, variant);

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: email,
      subject: copy.subject,
      html,
    }),
  });

  if (!resendResponse.ok) {
    const errText = await resendResponse.text();
    console.error("Resend API error:", errText);
    return;
  }

  console.log(`Magic link email (${variant}) sent successfully via Resend to: ${email}`);
}

async function resolveVariantFromSession(
  session: Stripe.Checkout.Session,
  fallback: EmailVariant,
): Promise<EmailVariant> {
  try {
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 });
    const priceIds = items.data
      .map((li) => (typeof li.price === "string" ? li.price : li.price?.id ?? null))
      .filter((p): p is string => !!p);
    console.log("Stripe session price IDs:", JSON.stringify(priceIds), "session:", session.id);
    if (priceIds.some((p) => p === SINGLE_REPORT_PRICE_ID)) return "single";
    if (priceIds.some((p) => p === BUYER_PASS_PRICE_ID)) return "pass";
  } catch (e) {
    console.error("listLineItems error:", (e as Error).message);
  }
  return fallback;
}

// ── Legacy Lovable email-queue path (kept for restoration) ──────────────────
// const messageId = crypto.randomUUID();
// await supabase.from("email_send_log").insert({ message_id: messageId, template_name: "magiclink", recipient_email: email, status: "pending" });
// await supabase.rpc("enqueue_email", { queue_name: "auth_emails", payload: {
//   message_id: messageId, to: email, from: "roovr <noreply@roovr.co>",
//   sender_domain: "notify.roovr.co", subject: "Activate your Roovr Buyer Pass",
//   html, text, purpose: "transactional", label: "magiclink",
//   queued_at: new Date().toISOString(), run_id: crypto.randomUUID(),
// }});

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error("Signature verification failed:", (err as Error).message);
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type !== "checkout.session.completed") {
    return new Response(JSON.stringify({ received: true, ignored: event.type }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const tier = (session.metadata?.tier ?? "") as string;
  const listingUrl = session.metadata?.listing_url ?? null;
  const analysisJobId = session.metadata?.analysis_job_id ?? null;
  const customerEmail = session.customer_details?.email ?? session.customer_email ?? null;
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  // If the buyer came from a results-page upgrade, copy the analysis from
  // analysis_jobs into saved_analyses for their email so the magic link can
  // land them straight on the unlocked report.
  async function captureAnalysisForEmail(email: string): Promise<string | null> {
    try {
      // 1. Prefer the explicit analysis_job_id passed through Stripe metadata.
      let job: { result_json: unknown; url: string | null } | null = null;
      if (analysisJobId) {
        const { data, error: jobErr } = await supabase
          .from("analysis_jobs")
          .select("result_json, url")
          .eq("id", analysisJobId)
          .maybeSingle();
        if (jobErr) console.error("captureAnalysisForEmail: job lookup error", jobErr);
        if (data?.result_json) job = data as typeof job;
      }
      // 2. Fallback: find the most recent completed analysis_jobs row for
      // this listing URL. Covers the case where the buyer's browser cleared
      // sessionStorage between viewing the sample and paying.
      if (!job && listingUrl) {
        const { data } = await supabase
          .from("analysis_jobs")
          .select("result_json, url")
          .eq("url", listingUrl)
          .eq("status", "complete")
          .not("result_json", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data?.result_json) job = data as typeof job;
      }
      if (!job) {
        console.error("captureAnalysisForEmail: no analysis available", { analysisJobId, listingUrl });
        return null;
      }
      const lurl = listingUrl ?? job.url ?? null;

      // Reuse an existing saved_analyses row for the same (email, listing_url).
      let savedId: string | null = null;
      if (lurl) {
        const { data: existing } = await supabase
          .from("saved_analyses")
          .select("id")
          .ilike("user_email", email)
          .eq("listing_url", lurl)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (existing?.id) {
          await supabase
            .from("saved_analyses")
            .update({ analysis_json: job.result_json })
            .eq("id", existing.id);
          savedId = existing.id;
        }
      }
      if (!savedId) {
        const { data: inserted, error: insErr } = await supabase
          .from("saved_analyses")
          .insert({
            user_email: email,
            listing_url: lurl,
            analysis_json: job.result_json,
          })
          .select("id")
          .single();
        if (insErr) {
          console.error("captureAnalysisForEmail insert error:", insErr.message);
          return null;
        }
        savedId = inserted.id;
      }
      return savedId;
    } catch (e) {
      console.error("captureAnalysisForEmail error:", (e as Error).message);
      return null;
    }
  }

  function buildRedirect(savedId: string | null, fallback: string): string {
    if (!savedId) return fallback;
    const params = new URLSearchParams({ saved_id: savedId });
    if (listingUrl) params.set("url", listingUrl);
    return `${SITE_URL}/results?${params.toString()}`;
  }

  try {
    if (tier === "single") {
      const token = crypto.randomUUID();
      const normalizedEmail = customerEmail ? customerEmail.toLowerCase() : null;

      // Resolve the auth user id from the email so the dashboard can match
      // this purchase to the user's account even if they later sign in with
      // a slightly different email casing or via OAuth.
      let resolvedUserId: string | null = null;
      if (normalizedEmail) {
        try {
          const { data } = await supabase.auth.admin.getUserByEmail(normalizedEmail);
          resolvedUserId = data.user?.id ?? null;
        } catch (e) {
          console.error("[stripe-webhook] auth user lookup failed:", (e as Error).message);
        }
      }
      console.log("[stripe-webhook] inserting single_report_token", {
        stripe_session_id: session.id,
        user_email: normalizedEmail,
        resolved_user_id: resolvedUserId,
      });

      const { error } = await supabase.from("single_report_tokens").insert({
        token,
        listing_url: listingUrl,
        stripe_session_id: session.id,
        user_email: normalizedEmail,
        user_id: resolvedUserId,
      });
      if (error) throw error;

      // Send a magic link so the customer can log in and revisit the report
      if (customerEmail) {
        try {
          const email = customerEmail.toLowerCase();
          const savedId = await captureAnalysisForEmail(email);
          const redirectTo = buildRedirect(savedId, `${SITE_URL}/my-reports`);
          const variant = await resolveVariantFromSession(session, "single");
          await sendMagicLinkEdge(email, redirectTo, variant);
        } catch (e) {
          console.error("single magic link error:", (e as Error).message);
        }
      }

      return new Response(JSON.stringify({ ok: true, token }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (tier === "pass") {
      if (!customerEmail) {
        console.error("No customer email on Buyer Pass session", session.id);
        return new Response("No email", { status: 400 });
      }
      // upsert in case of duplicate webhook deliveries.
      // 90-day Buyer Pass: extend expires_at from now() each time the user pays
      // (covers both new purchases and renewals).
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
      const email = customerEmail.toLowerCase();
      const { error } = await supabase.from("buyer_pass_users").upsert(
        {
          email,
          stripe_session_id: session.id,
          stripe_customer_id: customerId,
          activated_at: now.toISOString(),
          expires_at: expiresAt,
        },
        { onConflict: "email" }
      );
      if (error) throw error;

      // Send magic link via the email queue
      try {
        const savedId = await captureAnalysisForEmail(email);
        const redirectTo = buildRedirect(savedId, `${SITE_URL}/dashboard`);
        const variant = await resolveVariantFromSession(session, "pass");
        await sendMagicLinkEdge(email, redirectTo, variant);
      } catch (e) {
        console.error("buyer pass magic link error:", (e as Error).message);
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, ignoredTier: tier }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Webhook handler error:", (err as Error).message);
    return new Response("Internal error", { status: 500 });
  }
});
