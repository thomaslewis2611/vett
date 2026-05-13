import Anthropic from "@anthropic-ai/sdk";
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { AnalysisResult } from "./mock-analysis";

const analysisSchema = z.object({
  property: z.object({
    address: z.string().describe("Full UK address as listed"),
    price: z.number().describe("Asking price in GBP, integer"),
    beds: z.number().int(),
    baths: z.number().int(),
    type: z.string().describe("e.g. 'End of terrace house', 'Flat', 'Semi-detached'"),
    sqft: z.number().describe("Approx square feet, estimate from sqm if needed; 0 if unknown"),
    image: z.string().describe("First listing image URL if found, empty string otherwise"),
    listingUrl: z.string(),
  }),
  score: z.number().min(0).max(10).describe("Overall value score out of 10, one decimal place"),
  scoreLabel: z.string().describe("Short verdict, max 8 words"),
  metrics: z.object({
    pricePerSqFt: z.number().describe("Price per sq ft in GBP, 0 if unknown"),
    daysOnMarket: z.number().describe("Days listed, estimate from 'added/reduced' date if visible, 0 if unknown"),
    councilTaxBand: z.string().describe("A-H letter, or 'Unknown'"),
    estimatedStampDuty: z.number().describe("Estimated UK stamp duty in GBP for a second-home / additional property buyer"),
  }),
  redFlags: z
    .array(
      z.object({
        severity: z.enum(["high", "medium", "low"]),
        title: z.string().describe("Concise headline, max 12 words"),
        detail: z.string().describe("1-2 sentence explanation"),
      })
    )
    .min(3)
    .max(8),
  costs: z.object({
    purchasePrice: z.number(),
    stampDuty: z.number(),
    legalFees: z.number().describe("Typical UK conveyancing fees ~ £1,500-£2,500"),
    surveyFees: z.number().describe("Homebuyer survey ~ £600-£1,200"),
    mortgageFees: z.number().describe("Arrangement fee ~ £999-£1,500"),
    totalUpfront: z.number().describe("Sum of all upfront costs"),
    monthlyMortgage: z.number().describe("Monthly mortgage on 15% deposit, 25-year term, 4.8% fixed"),
    mortgageAssumptions: z.string(),
  }),
  viewingQuestions: z
    .array(z.string())
    .length(8)
    .describe("Exactly 8 specific questions tailored to this listing"),
  negotiation: z.object({
    recommendedOffer: z.object({
      low: z.number(),
      high: z.number(),
    }),
    rationale: z.string().describe("2-3 sentence justification"),
    leverage: z.array(z.string()).min(3).max(6).describe("Concrete negotiating points"),
  }),
  comparables: z
    .array(
      z.object({
        address: z.string(),
        soldPrice: z.number(),
        soldDate: z.string(),
        distance: z.string(),
      })
    )
    .max(4)
    .describe("Plausible comparable sales nearby; empty array if you cannot reasonably estimate"),
});

export { analysisSchema };

const SYSTEM_PROMPT = `You are Roovr, an expert UK property buyer's analyst whose job is to surface the red flags estate agents won't show buyers. You analyse Rightmove and Zoopla listings for serious UK home buyers.

You must:
- Read the listing carefully (description, photos captions, key features, agent copy).
- Translate UK estate agent euphemisms into honest red flags ("scope to modernise" = dated; "deceptively spacious" = small; "convenient for transport" = noisy; "no chain" can be good or distressed; etc.).
- Estimate UK stamp duty using current rates for the buyer profile (assume an additional / second property buyer for a conservative figure unless stated otherwise).
- Estimate monthly mortgage on 15% deposit, 25-year term at 4.8% fixed.
- Give a value score out of 10 reflecting price vs local market, condition, lease, location risks, and negotiation room.
- Suggest a recommended offer range that is realistic for the UK market — usually 2-8% under asking depending on days-on-market and red flags.
- Tailor the 8 viewing questions to specific things in this listing, not generic boilerplate.
- Be direct and useful — this buyer is about to spend hundreds of thousands of pounds.

Always respond with ONLY a single valid JSON object matching this exact shape (no markdown, no commentary, no code fences):
{
  "property": { "address": string, "price": number, "beds": number, "baths": number, "type": string, "sqft": number, "image": string, "listingUrl": string },
  "score": number (0-10, one decimal),
  "scoreLabel": string,
  "metrics": { "pricePerSqFt": number, "daysOnMarket": number, "councilTaxBand": string, "estimatedStampDuty": number },
  "redFlags": [ { "severity": "high"|"medium"|"low", "title": string, "detail": string } ] (3-8 items),
  "costs": { "purchasePrice": number, "stampDuty": number, "legalFees": number, "surveyFees": number, "mortgageFees": number, "totalUpfront": number, "monthlyMortgage": number, "mortgageAssumptions": string },
  "viewingQuestions": string[] (exactly 8),
  "negotiation": { "recommendedOffer": { "low": number, "high": number }, "rationale": string, "leverage": string[] (3-6) },
  "comparables": [ { "address": string, "soldPrice": number, "soldDate": string, "distance": string } ] (0-4)
}

If a field is unknown, use 0 for numbers, "Unknown" for strings, and never invent precise comparables you have no basis for (return empty array instead).`;

// SSRF protection: only allow Rightmove and Zoopla over HTTPS.
const ALLOWED_HOSTS = new Set([
  "www.rightmove.co.uk",
  "rightmove.co.uk",
  "m.rightmove.co.uk",
  "www.zoopla.co.uk",
  "zoopla.co.uk",
  "m.zoopla.co.uk",
]);

function validateListingUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("INVALID_URL: Please provide a valid Rightmove or Zoopla URL.");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("INVALID_URL: Only https Rightmove or Zoopla URLs are supported.");
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      "INVALID_URL: We only support Rightmove and Zoopla listing URLs."
    );
  }
  return parsed;
}

function extractMetaContent(html: string, names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const patterns = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, "i"),
    ];
    for (const p of patterns) {
      const m = html.match(p);
      if (m?.[1]) {
        out.push(m[1].trim());
        break;
      }
    }
  }
  return out;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "£")
    .replace(/&#163;/g, "£")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchListingText(url: string): Promise<string> {
  // SSRF guard — only allow Rightmove/Zoopla URLs through.
  validateListingUrl(url);

  let html = "";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
      redirect: "follow",
    });
    if (res.ok) html = await res.text();
  } catch {
    html = "";
  }

  const lower = html.toLowerCase();
  const blocked =
    html.length < 500 ||
    lower.includes("enable javascript") ||
    lower.includes("access denied");

  if (!blocked) {
    const text = htmlToText(html);
    if (text.length >= 200) return text.slice(0, 25000);
  }

  if (html.length > 0) {
    const metas = extractMetaContent(html, [
      "og:title",
      "og:description",
      "twitter:title",
      "twitter:description",
      "description",
    ]);
    const combined = metas.filter(Boolean).join("\n").trim();
    if (combined.length >= 100) {
      return `[Limited content — extracted from page metadata only]\n\n${combined}`;
    }
  }

  return "";
}

// ---- Server-side access check (single report token OR authenticated Buyer Pass) ----
async function hasFullAccess(opts: {
  accessToken?: string | null;
  sessionJwt?: string | null;
  listingUrl?: string | null;
}): Promise<boolean> {
  // 1. Single report token
  if (opts.accessToken) {
    try {
      const { data } = await supabaseAdmin
        .from("single_report_tokens")
        .select("listing_url, expires_at")
        .eq("token", opts.accessToken)
        .maybeSingle();
      if (data && new Date(data.expires_at).getTime() > Date.now()) {
        // If the token was issued for a specific listing, only honour that listing.
        if (!data.listing_url || !opts.listingUrl || data.listing_url === opts.listingUrl) {
          return true;
        }
      }
    } catch {
      /* fall through to JWT check */
    }
  }

  // 2. Buyer Pass via authenticated session
  if (opts.sessionJwt) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY) {
      try {
        const c = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data } = await c.auth.getUser(opts.sessionJwt);
        const email = data.user?.email;
        if (email) {
          const { data: row } = await supabaseAdmin
            .from("buyer_pass_users")
            .select("email")
            .ilike("email", email)
            .maybeSingle();
          if (row) return true;
        }
      } catch {
        /* ignore */
      }
    }
  }

  return false;
}

// Strip all premium content so it never leaves the server unless the user has paid.
function toPreview(a: AnalysisResult): AnalysisResult {
  return {
    ...a,
    redFlags: a.redFlags.slice(0, 2),
    costs: {
      purchasePrice: a.costs.purchasePrice,
      stampDuty: 0,
      legalFees: 0,
      surveyFees: 0,
      mortgageFees: 0,
      totalUpfront: 0,
      monthlyMortgage: 0,
      mortgageAssumptions: "",
    },
    viewingQuestions: [],
    negotiation: {
      recommendedOffer: { low: 0, high: 0 },
      rationale: "",
      leverage: [],
    },
    comparables: [],
  };
}

export const analyseListing = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      url: z.string().max(2000).optional(),
      text: z.string().max(50000).optional(),
      accessToken: z.string().max(200).optional().nullable(),
      sessionJwt: z.string().max(4000).optional().nullable(),
    })
  )
  .handler(async ({ data }): Promise<AnalysisResult> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("[analyseListing] Missing ANTHROPIC_API_KEY");
      throw new Error("Analysis service is temporarily unavailable. Please try again shortly.");
    }

    const url = data.url?.trim() ?? "";
    const pastedText = data.text?.trim() ?? "";
    if (!url && !pastedText) throw new Error("Provide a listing URL or pasted text");

    // Validate URL upfront so we never make an unrelated outbound request.
    if (url) {
      try {
        validateListingUrl(url);
      } catch (e) {
        throw e instanceof Error ? e : new Error("INVALID_URL: Unsupported URL.");
      }
    }

    let listingContent = pastedText;
    if (!listingContent && url) {
      listingContent = await fetchListingText(url);
    }
    if (!listingContent || listingContent.length < 100) {
      throw new Error(
        "FETCH_BLOCKED: We couldn't automatically read this listing. You can paste the listing description below to get your full analysis."
      );
    }

    let output: z.infer<typeof analysisSchema>;
    try {
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: "claude-sonnet-4-5",
        max_tokens: 2000,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Listing URL: ${url || "(pasted text only)"}\n\nListing content:\n${listingContent}`,
          },
        ],
      });

      const responseText =
        message.content[0].type === "text" ? message.content[0].text : "";
      const cleaned = responseText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");

      const parsed = JSON.parse(cleaned);
      output = analysisSchema.parse(parsed);
    } catch (err: unknown) {
      // Log details server-side; never leak provider/internal error info to the browser.
      console.error("[analyseListing] Anthropic/parse error:", err);
      throw new Error(
        "Sorry, the analysis service is temporarily unavailable. Please try again shortly."
      );
    }

    const full: AnalysisResult = {
      ...output,
      property: {
        ...output.property,
        listingUrl: url || output.property.listingUrl || "",
        image:
          output.property.image ||
          "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80",
      },
    } as AnalysisResult;

    // Server-side gating — only return premium content if the caller has paid.
    const unlocked = await hasFullAccess({
      accessToken: data.accessToken ?? null,
      sessionJwt: data.sessionJwt ?? null,
      listingUrl: url || null,
    });

    return unlocked ? full : toPreview(full);
  });
