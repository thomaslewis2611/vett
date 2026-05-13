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
const SITE_NAME = "roovr";
const SENDER_DOMAIN = "notify.roovr.co";
const FROM_DOMAIN = "roovr.co";

function buildMagicLinkHtml(actionLink: string): { html: string; text: string } {
  const html = `<!doctype html><html><body style="margin:0;padding:32px 0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:0 20px;">
    <div style="padding:0 0 24px;"><div style="font-size:20px;font-weight:700;color:#D85A30;letter-spacing:-0.01em;">Roovr</div></div>
    <div style="background:#FFFDF9;border:1px solid rgba(26,17,8,0.12);border-radius:12px;padding:32px;">
      <h1 style="font-size:24px;font-weight:700;color:#1A1108;margin:0 0 12px;line-height:1.3;">Activate your Buyer Pass</h1>
      <p style="font-size:15px;color:#1A1108;line-height:1.6;margin:0 0 24px;">Thanks for purchasing a Roovr Buyer Pass. Click below to activate your account and get unlimited property analyses, flood risk data, AI chat, and more.</p>
      <a href="${actionLink}" style="background:#D85A30;color:#FFFDF9;font-size:15px;font-weight:600;border-radius:8px;padding:14px 22px;text-decoration:none;display:inline-block;">Activate my Buyer Pass →</a>
      <hr style="border:none;border-top:1px solid rgba(26,17,8,0.12);margin:28px 0 20px;" />
      <p style="font-size:13px;color:#888780;line-height:1.5;margin:0 0 8px;">If the button doesn't work, copy and paste this link into your browser:</p>
      <a href="${actionLink}" style="font-size:13px;color:#D85A30;word-break:break-all;">${actionLink}</a>
      <p style="font-size:13px;color:#888780;line-height:1.5;margin:20px 0 0;">If you didn't request this, you can safely ignore this email.</p>
    </div>
    <div style="padding:24px 8px 0;text-align:center;"><p style="font-size:12px;color:#888780;margin:0;">© 2026 Roovr · roovr.co · Every listing. Analysed. Instantly.</p></div>
  </div>
</body></html>`;
  const text = `Activate your Roovr Buyer Pass\n\nThanks for purchasing a Roovr Buyer Pass. Activate your account here:\n${actionLink}\n\nIf you didn't request this, you can safely ignore this email.`;
  return { html, text };
}

async function sendBuyerPassMagicLinkEdge(email: string, redirectTo: string): Promise<void> {
  console.log("Magic link flow started for:", email);

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
  const actionLink = (linkData as any)?.properties?.action_link as string | undefined;
  console.log("Magic link generated:", actionLink ? "yes" : "no");
  if (linkErr || !actionLink) {
    console.error("generateLink error:", linkErr?.message);
    return;
  }

  const { html, text } = buildMagicLinkHtml(actionLink);
  const messageId = crypto.randomUUID();

  await supabase.from("email_send_log").insert({
    message_id: messageId,
    template_name: "magiclink",
    recipient_email: email,
    status: "pending",
  });

  const { error: enqErr } = await supabase.rpc("enqueue_email", {
    queue_name: "auth_emails",
    payload: {
      message_id: messageId,
      to: email,
      from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
      sender_domain: SENDER_DOMAIN,
      subject: "Activate your Roovr Buyer Pass",
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
    await supabase.from("email_send_log").insert({
      message_id: messageId,
      template_name: "magiclink",
      recipient_email: email,
      status: "failed",
      error_message: enqErr.message,
    });
  }
}

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
        user_email: customerEmail ? customerEmail.toLowerCase() : null,
      });
      if (error) throw error;

      // Send a magic link so the customer can log in and revisit the report
      if (customerEmail) {
        try {
          await sendBuyerPassMagicLinkEdge(customerEmail.toLowerCase(), `${SITE_URL}/my-report`);
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

      // Send magic link via the email queue
      try {
        await sendBuyerPassMagicLinkEdge(customerEmail.toLowerCase(), `${SITE_URL}/dashboard`);
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
