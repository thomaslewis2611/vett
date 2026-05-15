import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PASS_DISCOUNT_PRICE_ID = "price_1TXLgzCfTT0mXB2cJMfAE4DW";

/**
 * Returns whether the signed-in user qualifies for the £20 Buyer Pass
 * upgrade discount: they have previously purchased at least one Single
 * Report AND do not currently hold an active Buyer Pass.
 */
export const checkPassDiscountEligibility = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(
    async ({
      context,
    }): Promise<{ eligible: boolean; priceId: string }> => {
      const email = (context.claims as { email?: string } | null)?.email ?? null;
      if (!email) return { eligible: false, priceId: PASS_DISCOUNT_PRICE_ID };

      // Active Buyer Pass disqualifies.
      const { data: pass } = await supabaseAdmin
        .from("buyer_pass_users")
        .select("expires_at, activated_at")
        .ilike("email", email)
        .maybeSingle();
      if (pass) {
        const expiresAt =
          (pass as { expires_at: string | null }).expires_at ??
          (pass as { activated_at: string }).activated_at;
        const active = expiresAt
          ? new Date(expiresAt).getTime() > Date.now()
          : true;
        if (active) return { eligible: false, priceId: PASS_DISCOUNT_PRICE_ID };
      }

      // Prior Single Report purchase qualifies.
      const { data: token } = await supabaseAdmin
        .from("single_report_tokens")
        .select("token")
        .ilike("user_email", email)
        .limit(1)
        .maybeSingle();
      return { eligible: !!token, priceId: PASS_DISCOUNT_PRICE_ID };
    },
  );
