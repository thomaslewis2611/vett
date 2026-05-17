import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AnalysisResult } from "@/lib/analysis.types";

export const createSharedReport = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      analysisData: z.unknown(),
      propertyAddress: z.string().max(500).optional().nullable(),
    })
  )
  .handler(async ({ data }): Promise<{ token: string }> => {
    const { data: row, error } = await supabaseAdmin
      .from("shared_reports")
      .insert({
        analysis_data: data.analysisData as never,
        property_address: data.propertyAddress ?? null,
      })
      .select("token")
      .single();
    if (error || !row) {
      console.error("[createSharedReport] insert failed", error);
      throw new Error("Failed to create share link");
    }
    return { token: (row as { token: string }).token };
  });

export const getSharedReport = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string().min(8).max(128) }))
  .handler(
    async ({
      data,
    }): Promise<{
      found: boolean;
      analysis: AnalysisResult | null;
      propertyAddress: string | null;
    }> => {
      const { data: row, error } = await supabaseAdmin
        .from("shared_reports")
        .select("analysis_data, property_address")
        .eq("token", data.token)
        .maybeSingle();
      if (error || !row) {
        return { found: false, analysis: null, propertyAddress: null };
      }
      return {
        found: true,
        analysis: (row as { analysis_data: AnalysisResult }).analysis_data,
        propertyAddress: (row as { property_address: string | null }).property_address,
      };
    }
  );
