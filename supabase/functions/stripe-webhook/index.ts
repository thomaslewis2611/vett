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
  const customerEmail = session.customer_details?.email ?? session.customer_email ?? null;
  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  try {
    if (tier === "single") {
      const token = crypto.randomUUID();
      const { error } = await supabase.from("single_report_tokens").insert({
        token,
        listing_url: listingUrl,
        stripe_session_id: session.id,
      });
      if (error) throw error;
      return new Response(JSON.stringify({ ok: true, token }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (tier === "pass") {
      if (!customerEmail) {
        console.error("No customer email on Buyer Pass session", session.id);
        return new Response("No email", { status: 400 });
      }
      // upsert in case of duplicate webhook deliveries
      const { error } = await supabase.from("buyer_pass_users").upsert(
        {
          email: customerEmail.toLowerCase(),
          stripe_session_id: session.id,
          stripe_customer_id: customerId,
        },
        { onConflict: "email" }
      );
      if (error) throw error;

      // Send magic link via Supabase Auth
      const { error: linkErr } = await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: customerEmail.toLowerCase(),
        options: { redirectTo: `${SITE_URL}/dashboard` },
      });
      if (linkErr) {
        console.error("magic link error:", linkErr.message);
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
