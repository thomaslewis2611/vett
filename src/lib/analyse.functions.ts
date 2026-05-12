import { createServerFn } from "@tanstack/react-start";
import { generateText, Output } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway";
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

const SYSTEM_PROMPT = `You are Propwise, an expert UK property buyer's analyst. You analyse Rightmove and Zoopla listings for serious UK home buyers.

You must:
- Read the listing carefully (description, photos captions, key features, agent copy).
- Translate UK estate agent euphemisms into honest red flags ("scope to modernise" = dated; "deceptively spacious" = small; "convenient for transport" = noisy; "no chain" can be good or distressed; etc.).
- Estimate UK stamp duty using current rates for the buyer profile (assume an additional / second property buyer for a conservative figure unless stated otherwise).
- Estimate monthly mortgage on 15% deposit, 25-year term at 4.8% fixed.
- Give a value score out of 10 reflecting price vs local market, condition, lease, location risks, and negotiation room.
- Suggest a recommended offer range that is realistic for the UK market — usually 2-8% under asking depending on days-on-market and red flags.
- Tailor the 8 viewing questions to specific things in this listing, not generic boilerplate.
- Be direct and useful — this buyer is about to spend hundreds of thousands of pounds.

Always return the structured object. If a field is unknown, use 0 for numbers, "Unknown" for strings, and never invent precise comparables you have no basis for (return empty array instead).`;

async function fetchListingText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
      },
    });
    if (!res.ok) return "";
    const html = await res.text();
    // Strip tags + collapse whitespace; cap to keep prompt manageable
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&pound;/g, "£")
      .replace(/\s+/g, " ")
      .trim();
    return text.slice(0, 25000);
  } catch {
    return "";
  }
}

export const analyseListing = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      url: z.string().optional(),
      text: z.string().optional(),
    })
  )
  .handler(async ({ data }): Promise<AnalysisResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const url = data.url?.trim() ?? "";
    const pastedText = data.text?.trim() ?? "";
    if (!url && !pastedText) throw new Error("Provide a listing URL or pasted text");

    let listingContent = pastedText;
    if (!listingContent && url) {
      listingContent = await fetchListingText(url);
    }
    if (!listingContent || listingContent.length < 200) {
      // Fallback: still let Claude reason from the URL alone (it knows the format).
      listingContent = `[Could not fetch full page content. URL: ${url}]\n\nAnalyse based on what is reasonable for a typical UK listing at this URL and flag the lack of disclosed information as a red flag.`;
    }

    const gateway = createLovableAiGatewayProvider(apiKey);
    const model = gateway("google/gemini-3-pro-preview");

    try {
      const { experimental_output: output } = await generateText({
        model,
        system: SYSTEM_PROMPT,
        prompt: `Listing URL: ${url || "(pasted text only)"}\n\nListing content:\n${listingContent}`,
        experimental_output: Output.object({ schema: analysisSchema }),
      });

      // Ensure listingUrl reflects the user-provided URL.
      return {
        ...output,
        property: {
          ...output.property,
          listingUrl: url || output.property.listingUrl || "",
          image:
            output.property.image ||
            "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200&q=80",
        },
      } as AnalysisResult;
    } catch (err: unknown) {
      const e = err as { statusCode?: number; message?: string };
      if (e?.statusCode === 429) {
        throw new Error("RATE_LIMIT: AI is busy right now. Please try again in a moment.");
      }
      if (e?.statusCode === 402) {
        throw new Error("CREDITS: Workspace is out of AI credits. Add credits in Lovable settings.");
      }
      throw new Error(e?.message || "Analysis failed");
    }
  });
