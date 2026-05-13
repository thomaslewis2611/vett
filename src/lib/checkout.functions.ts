import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Stripe from "stripe";
import * as React from "react";
import { render } from "@react-email/components";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { MagicLinkEmail } from "@/lib/email-templates/magic-link";

const SITE_URL = "https://roovr.co";
const SITE_NAME = "roovr";
const SENDER_DOMAIN = "notify.roovr.co";
const FROM_DOMAIN = "roovr.co";

/**
 * Ensure a Supabase auth user exists for the given email, generate a magic
 * link via the admin API, render the Roovr-branded magic-link email, and
 * enqueue it for delivery via the existing email queue.
 */
async function sendMagicLinkViaQueue(email: string, redirectTo: string): Promise<{ ok: boolean; error?: string }> {
  console.log("Magic link flow started for:", email);

  // Step 1: ensure user exists (ignore "already registered")
  const createRes = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (createRes.error && !/already|registered|exists/i.test(createRes.error.message)) {
    console.error("createUser error:", createRes.error.message);
    return { ok: false, error: createRes.error.message };
  }
  console.log("User created/found:", createRes.data?.user?.id ?? "(existing)");

  // Step 2: generate magic link
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo },
  });
  const actionLink = linkData?.properties?.action_link;
  console.log("Magic link generated:", Boolean(actionLink) ? "yes" : "no");
  if (linkError || !actionLink) {
    console.error("generateLink error:", linkError?.message);
    return { ok: false, error: linkError?.message ?? "no action_link" };
  }

  // Step 3: render template + enqueue
  const element = React.createElement(MagicLinkEmail, {
    siteName: SITE_NAME,
    confirmationUrl: actionLink,
  });
  const html = await render(element);
  const text = await render(element, { plainText: true });
  const messageId = crypto.randomUUID();

  await supabaseAdmin.from("email_send_log").insert({
    message_id: messageId,
    template_name: "magiclink",
    recipient_email: email,
    status: "pending",
  });

  const { error: enqErr } = await supabaseAdmin.rpc("enqueue_email", {
    queue_name: "auth_emails",
    payload: {
      message_id: messageId,
      to: email,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: "Your Roovr access link",
      html,
      text,
      purpose: "transactional",
      label: "magiclink",
      queued_at: new Date().toISOString(),
    },
  });

  console.log("Email queued:", enqErr ? "no" : "yes");
  if (enqErr) {
    console.error("enqueue_email error:", enqErr.message);
    await supabaseAdmin.from("email_send_log").insert({
      message_id: messageId,
      template_name: "magiclink",
      recipient_email: email,
      status: "failed",
      error_message: enqErr.message,
    });
    return { ok: false, error: enqErr.message };
  }
  return { ok: true };
}

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
    })
  )
  .handler(async ({ data }): Promise<{ url: string }> => {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      currency: "gbp",
      line_items: [{ price: data.priceId, quantity: 1 }],
      customer_email: undefined,
      // collect email from customer
      customer_creation: "always",
      success_url: `${SITE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&tier=${data.tier}`,
      cancel_url: `${SITE_URL}/pricing`,
      metadata: {
        tier: data.tier,
        listing_url: data.listingUrl,
      },
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
    }> => {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(data.sessionId);
      const paid = session.payment_status === "paid";
      const tier = (session.metadata?.tier as "single" | "pass" | undefined) ?? null;
      const email = session.customer_details?.email ?? null;
      const listingUrl = session.metadata?.listing_url ?? null;

      let token: string | null = null;
      if (paid && tier === "single") {
        const { data: row } = await supabaseAdmin
          .from("single_report_tokens")
          .select("token, listing_url")
          .eq("stripe_session_id", data.sessionId)
          .maybeSingle();
        token = row?.token ?? null;
      }

      return { paid, tier, email, token, listingUrl };
    }
  );

export const sendBuyerPassMagicLink = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().email().max(320) }))
  .handler(async ({ data }): Promise<{ ok: boolean; found: boolean }> => {
    const email = data.email.trim().toLowerCase();
    const { data: bp } = await supabaseAdmin
      .from("buyer_pass_users")
      .select("email")
      .ilike("email", email)
      .maybeSingle();

    let redirectTo = `${SITE_URL}/dashboard`;
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
        redirectTo = `${SITE_URL}/my-report`;
      }
    }

    if (!found) {
      console.log("Magic link: no account found for", email);
      return { ok: true, found: false };
    }

    const res = await sendMagicLinkViaQueue(email, redirectTo);
    return { ok: res.ok, found: true };
  });


export const saveAnalysisForUser = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().email().max(320),
      listingUrl: z.string().max(2000).optional().nullable(),
      analysis: z.unknown(),
    })
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    // Verify the user actually has a Buyer Pass before saving
    const { data: bp } = await supabaseAdmin
      .from("buyer_pass_users")
      .select("email")
      .ilike("email", data.email)
      .maybeSingle();
    if (!bp) return { ok: false };
    await supabaseAdmin.from("saved_analyses").insert({
      user_email: data.email.toLowerCase(),
      listing_url: data.listingUrl ?? null,
      analysis_json: data.analysis as never,
    });
    return { ok: true };
  });
