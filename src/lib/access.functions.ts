import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const validateSingleReportToken = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      token: z.string().min(1).max(200),
      listingUrl: z.string().max(2000).optional().nullable(),
    })
  )
  .handler(async ({ data }): Promise<{ valid: boolean; listingUrl: string | null }> => {
    const { data: row } = await supabaseAdmin
      .from("single_report_tokens")
      .select("token, listing_url, expires_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!row) return { valid: false, listingUrl: null };
    if (new Date(row.expires_at).getTime() < Date.now()) return { valid: false, listingUrl: null };
    if (data.listingUrl && row.listing_url && row.listing_url !== data.listingUrl) {
      return { valid: false, listingUrl: row.listing_url };
    }
    return { valid: true, listingUrl: row.listing_url };
  });

export const checkBuyerPassByEmail = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().email().max(320) }))
  .handler(
    async ({
      data,
    }): Promise<{ hasPass: boolean; expired: boolean; expiresAt: string | null }> => {
      const { data: row } = await supabaseAdmin
        .from("buyer_pass_users")
        .select("email, expires_at, activated_at")
        .ilike("email", data.email)
        .maybeSingle();
      if (!row) return { hasPass: false, expired: false, expiresAt: null };
      const expiresAt =
        (row as { expires_at: string | null }).expires_at ??
        (row as { activated_at: string }).activated_at;
      const expired = expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;
      return { hasPass: !expired, expired, expiresAt };
    }
  );

export const getSingleReportByEmail = createServerFn({ method: "POST" })
  .inputValidator(z.object({ email: z.string().email().max(320) }))
  .handler(
    async ({
      data,
    }): Promise<{ token: string | null; listingUrl: string | null; expiresAt: string | null }> => {
      const { data: row } = await supabaseAdmin
        .from("single_report_tokens")
        .select("token, listing_url, expires_at, created_at")
        .ilike("user_email", data.email)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!row) return { token: null, listingUrl: null, expiresAt: null };
      if (new Date(row.expires_at).getTime() < Date.now())
        return { token: null, listingUrl: null, expiresAt: null };
      return { token: row.token, listingUrl: row.listing_url, expiresAt: row.expires_at };
    }
  );
