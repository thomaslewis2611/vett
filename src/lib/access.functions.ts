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

// Returns a Single Report match ONLY when the user has a saved analysis
// for THIS specific listingUrl. Email alone is not enough — Single Report
// access is per-listing, not per-account.
export const getSingleReportByEmail = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().email().max(320),
      listingUrl: z.string().max(2000).optional().nullable(),
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<{ hasAccess: boolean; token: string | null; listingUrl: string | null; expiresAt: string | null }> => {
      if (!data.listingUrl) {
        return { hasAccess: false, token: null, listingUrl: null, expiresAt: null };
      }
      // Match a paid Single Report for this exact listing URL.
      const { data: saved } = await supabaseAdmin
        .from("saved_analyses")
        .select("id, listing_url, created_at")
        .ilike("user_email", data.email)
        .eq("listing_url", data.listingUrl)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!saved) return { hasAccess: false, token: null, listingUrl: null, expiresAt: null };

      // Optional: surface the matching token's expiry if one exists.
      const { data: row } = await supabaseAdmin
        .from("single_report_tokens")
        .select("token, listing_url, expires_at, created_at")
        .ilike("user_email", data.email)
        .eq("listing_url", data.listingUrl)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (row && new Date(row.expires_at).getTime() < Date.now()) {
        return { hasAccess: false, token: null, listingUrl: null, expiresAt: null };
      }
      return {
        hasAccess: true,
        token: row?.token ?? null,
        listingUrl: data.listingUrl,
        expiresAt: row?.expires_at ?? null,
      };
    }
  );
