import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const SITE_URL = "https://roovr.co";

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

    if (!found) return { ok: true, found: false };

    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
      options: { redirectTo },
    });
    if (error) {
      console.error("magic link error", error.message);
      return { ok: false, found: true };
    }
    return { ok: true, found: true };
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
