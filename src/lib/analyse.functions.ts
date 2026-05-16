import Anthropic from "@anthropic-ai/sdk";
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { scheduleBackground } from "@/lib/execution-context";
import type { AnalysisResult } from "./mock-analysis";

const analysisSchema = z.object({
  property: z.object({
    address: z.string().describe("Full UK address as listed"),
    price: z.number().describe("Asking price in GBP, integer"),
    beds: z.number().int(),
    baths: z.number().int(),
    type: z.string().describe("e.g. 'End of terrace house', 'Flat', 'Semi-detached'"),
    sqft: z.number().describe("Approx square feet, estimate from sqm if needed; 0 if unknown"),
    listingUrl: z.string(),
  }),
  score: z.number().min(0).max(10).describe("Overall value score out of 10, one decimal place"),
  scoreLabel: z.string().describe("Short verdict, max 8 words"),
  subScores: z.object({
    valueForMoney: z.number().min(0).max(10),
    locationQuality: z.number().min(0).max(10),
    listingTransparency: z.number().min(0).max(10),
    marketTiming: z.number().min(0).max(10),
    riskLevel: z.number().min(0).max(10).describe("Higher = LOWER risk (10 = very safe, 0 = very risky)"),
    resalePotential: z.number().min(0).max(10),
  }),
  scoreReasons: z.object({
    valueForMoney: z.string().describe("2-3 sentences citing actual price, sq ft, area comparables"),
    locationQuality: z.string().describe("2-3 sentences naming the actual area, transport, amenities"),
    listingTransparency: z.string().describe("2-3 sentences on what this agent disclosed or hid"),
    marketTiming: z.string().describe("2-3 sentences on days on market, price history, demand for THIS property"),
    riskLevel: z.string().describe("2-3 sentences summarising the biggest specific risks in this listing"),
    resalePotential: z.string().describe("2-3 sentences on this property type, tenure and area's resale outlook"),
  }),
  metrics: z.object({
    pricePerSqFt: z.number().describe("Price per sq ft in GBP, 0 if unknown"),
    daysOnMarket: z.number().describe("Days listed, estimate from 'added/reduced' date if visible, 0 if unknown"),
    councilTaxBand: z.string().describe("A-H letter, or 'Unknown'"),
    estimatedStampDuty: z.number().describe("Estimated UK stamp duty (SDLT) in GBP for a main residence buyer (England/NI standard rates, not the additional / second-home rate)"),
  }),
  epc: z.object({
    rating: z.string().nullable().describe("EPC band letter A-G, or null if not in listing"),
    score: z.number().nullable().describe("EPC numeric score 1-100, or null"),
    potentialRating: z.string().nullable().describe("Potential EPC band letter after improvements, or null"),
    estimatedAnnualEnergyCost: z.string().nullable().describe("e.g. '£1,800 per year', or null"),
    commentary: z.string().describe("2-3 sentences: what this rating means for THIS property — typical annual energy bills for this size+rating, cost+saving of upgrading one band, mortgage lender implications if below D"),
  }).nullable(),
  priceHistory: z.unknown().nullable().optional(),
  floodRisk: z.object({
    riversAndSea: z.string().nullable(),
    surfaceWater: z.string().nullable(),
    reservoir: z.boolean().nullable(),
    groundwater: z.string().nullable(),
    overallRisk: z.string().nullable(),
    commentary: z.string(),
    autoRedFlag: z.boolean(),
    scotland: z.boolean().nullable().optional(),
    unavailable: z.boolean().nullable().optional(),
    manualZone: z.string().nullable().optional(),
    riskLevel: z.string().nullable().optional(),
    insuranceImplications: z.string().nullable().optional(),
    mortgageImplications: z.string().nullable().optional(),
    resaleImpact: z.string().nullable().optional(),
  }).nullable().optional(),
  nearbySchools: z.object({
    schools: z.array(z.object({
      name: z.string(),
      ofstedRating: z.number().nullable(),
      schoolType: z.string().nullable(),
      phase: z.enum(["primary", "secondary", "other"]),
      distanceMiles: z.number(),
    })),
    unavailable: z.boolean().nullable().optional(),
    aiSourced: z.boolean().nullable().optional(),
  }).nullable().optional(),
  crime: z.object({
    totalCrimes: z.number(),
    month: z.string(),
    topCategories: z.array(z.object({
      category: z.string(),
      count: z.number(),
      label: z.string(),
    })),
    riskLevel: z.enum(["Low", "Moderate", "High", "Very High"]),
    commentary: z.string(),
    autoRedFlag: z.boolean(),
    coordinates: z.object({ lat: z.number(), lng: z.number() }).nullable().optional(),
    unavailable: z.boolean().nullable().optional(),
  }).nullable().optional(),
  broadband: z.object({
    downloadSpeed: z.string(),
    uploadSpeed: z.string(),
    connectionType: z.enum(["Full fibre", "Fibre to cabinet", "ADSL", "Limited"]),
    suitableForRemoteWork: z.boolean(),
    mobileSignal: z.enum(["Excellent", "Good", "Limited", "Poor"]),
    commentary: z.string(),
    speedRating: z.enum(["Excellent", "Good", "Average", "Poor"]),
    source: z.string().nullable().optional(),
    unavailable: z.boolean().nullable().optional(),
    autoRedFlag: z.boolean().nullable().optional(),
  }).nullable().optional(),
  transport: z.object({
    nearestStation: z.string(),
    distanceToStation: z.string(),
    journeyToNearestCity: z.string(),
    nearestCity: z.string(),
    busLinks: z.string(),
    motorwayAccess: z.string(),
    airportAccess: z.string(),
    transportRating: z.enum(["Excellent", "Good", "Average", "Poor"]),
    commentary: z.string(),
    parkingNotes: z.string().nullable().optional(),
    unavailable: z.boolean().nullable().optional(),
    autoRedFlag: z.boolean().nullable().optional(),
  }).nullable().optional(),
  ptal: z.object({
    grade: z.string(),
    band: z.number().nullable(),
    label: z.string(),
    explanation: z.string(),
    source: z.string().nullable().optional(),
  }).nullable().optional(),
  areaContext: z.object({
    avgPricePerSqFtArea: z.number().nullable(),
    avgSoldPriceArea: z.number().nullable(),
    priceVsAreaPercent: z.number().nullable().describe("Positive = above area avg, negative = below"),
    areaDescription: z.string().describe("2 sentences on the area: desirability, trends, transport"),
    comparableNote: z.string().describe("1 sentence on how this property compares to typical area listings"),
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
    isAuction: z.boolean().optional().describe("True if this is an auction property"),
    maxBid: z.number().optional().describe("Single max bid figure for auction properties"),
    recommendedOffer: z.object({
      low: z.number(),
      high: z.number(),
    }),
    rationale: z.string().describe("2-3 sentence justification (or auction bidding strategy if isAuction)"),
    leverage: z.array(z.string()).min(3).max(6).describe("Concrete negotiating points"),
  }),
  sellerMotivation: z.object({
    score: z.number().min(1).max(10),
    label: z.enum(["Low", "Moderate", "High", "Very High"]),
    signals: z.array(z.string()),
    commentary: z.string(),
  }).nullable().optional(),
  viewingChecklist: z.object({
    items: z.array(z.object({
      category: z.enum(["Structure", "Legal", "Running costs", "Negotiation", "Practical"]),
      item: z.string(),
      why: z.string(),
    })).min(8).max(15),
  }).nullable().optional(),
  renovationCosts: z.object({
    items: z.array(z.object({
      issue: z.string(),
      estimatedCost: z.string(),
      priority: z.enum(["High priority", "Medium priority", "Low priority"]),
      notes: z.string(),
    })),
    totalEstimatedMin: z.number(),
    totalEstimatedMax: z.number(),
    commentary: z.string(),
  }).nullable().optional(),
  manualSqftAnalysis: z.object({
    sqft: z.number(),
    pricePerSqFt: z.number(),
    vsAreaAvg: z.string(),
    vsAreaAvgLabel: z.enum(["above", "below"]),
    commentary: z.string(),
  }).nullable().optional(),
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
  planningReference: z
    .object({
      found: z.boolean(),
      reference: z.string().nullable(),
      relatesTo: z.string().nullable(),
      applicationType: z
        .enum(["Householder", "Full Planning", "Change of Use", "Listed Building Consent", "Unknown"])
        .nullable(),
      commentary: z.string().nullable(),
    })
    .nullable()
    .optional(),
  partialPostcode: z.string().nullable().optional(),
  inferredPostcode: z.boolean().nullable().optional(),
  inferredPostcodeValue: z.string().nullable().optional(),
});

export { analysisSchema };

const SYSTEM_PROMPT = `You are Roovr, an expert UK property buyer's analyst whose job is to surface the red flags estate agents won't show buyers. You analyse Rightmove and Zoopla listings for serious UK home buyers.

You must:
- Read the listing carefully (description, photos captions, key features, agent copy).
- Translate UK estate agent euphemisms into honest red flags ("scope to modernise" = dated; "deceptively spacious" = small; "convenient for transport" = noisy; "no chain" can be good or distressed; etc.).
- Estimate UK stamp duty (SDLT) using the current MAIN RESIDENCE rates for England/Northern Ireland (do NOT apply the additional / second-home surcharge unless the listing explicitly says it's being bought as a second home or buy-to-let).
- For daysOnMarket: if the listing content begins with or contains a line like "LISTING DATE: DD/MM/YYYY — X days on market" (or "Date listed: ..."), use that X value directly. Otherwise look for any date references in the listing text and infer days on market if possible. Return 0 only if there is genuinely no signal. CRITICAL DATE MATH: When calculating days on market yourself, ALWAYS compute (today's date − listing date) to get a POSITIVE number of days. A listing date EARLIER than today means the property has been on the market for that many days — never describe it as being "in the future". For example, listed 27 April 2026 with today 16 May 2026 = 19 days on market (NOT 19 days in the future). Only if the listing date is genuinely AFTER today's date should you treat it as a potential data error and set daysOnMarket to 0 — never produce a negative number and never describe a past date as future.
- Estimate monthly mortgage on 15% deposit, 25-year term at 4.8% fixed.
- Give an overall value score AND 6 sub-scores (each out of 10, one decimal):
  - valueForMoney — price vs area comparables and sq ft
  - locationQuality — transport, schools, amenities, postcode desirability
  - listingTransparency — how honest and complete is the listing description
  - marketTiming — days on market, price reductions, demand signals
  - riskLevel — HIGHER number = LOWER risk (10 = very safe; 0 = many legal/structural/tenure red flags)
  - resalePotential — property type, tenure, size, area trajectory
- For EACH sub-score, also write a scoreReasons.<key> string of 2-3 sentences of SPECIFIC reasoning that references actual details from this listing — prices, dates, features, location names. Never write generic descriptions like "this scores well on transport". Always explain the score in terms of what you found in this specific property.
- Provide an areaContext object with your best estimates for the local area: avgPricePerSqFtArea, avgSoldPriceArea, priceVsAreaPercent (positive = above avg), a 2-sentence areaDescription and 1-sentence comparableNote. Use null for any number you genuinely cannot estimate.
- IMPORTANT: avgPricePerSqFtArea should reflect the typical price PER SQUARE FOOT for similar properties (same property type, similar size and tenure) in this specific area / postcode — NOT the average total sale price divided by anything. Base this on your knowledge of the postcode and property type. If you cannot estimate it reliably, return null rather than guessing.
- If this is an AUCTION property, set negotiation.isAuction to true and provide negotiation.maxBid as a single GBP number (not a range). Set recommendedOffer.low and high BOTH equal to maxBid. The rationale must explain auction bidding strategy including the need for bridging finance or cash. Otherwise leave isAuction false/omitted and provide a normal recommended offer range — usually 2-8% under asking.
- IMPORTANT: Only identify a property as an auction listing if the listing text explicitly contains one or more of these exact terms: auction, auctioneer, lot number, reserve price, unconditional exchange, sold prior to auction, online auction. Do NOT infer auction status from: guide price, offers over, offers in excess of, or any other pricing language. These are standard estate agent terms used on normal listings and must never be interpreted as auction indicators. Never generate an auction-related red flag (e.g. "Auction Property", "Cash Buyers Only", "Bridging Finance Required") unless one of those explicit auction terms appears in the listing text. If you incorrectly flag a non-auction property as an auction listing, this causes serious harm to users who may make incorrect financial decisions. When in doubt, do not flag as auction.
- IMPORTANT: "Guide Price" is standard, widely-used UK estate agent terminology — particularly common in Bath, Bristol, the South West and across many private treaty sales. It is NOT inherently an indicator of auction, distress or unusual sale conditions. Rules: (a) If the listing uses "Guide Price" with NO other supporting signals of distress or auction, do NOT generate a red flag for it at all. (b) If you do mention it, the maximum severity is LOW, and the tone must be neutral/informational — note that it is common terminology and the buyer should simply confirm the sale method (private treaty vs auction vs informal tender) with the agent. (c) Only escalate Guide Price to MEDIUM or HIGH severity if it is combined with other genuine warning signs such as explicit auction terms (see auction list above), very long days on market, multiple price reductions, or unusual completion timeframes (e.g. 28-day completion required). Never flag Guide Price as HIGH on its own.
- IMPORTANT: Only flag missing internal photos if the listing content explicitly states there are no photos, or if the listing description contains zero photo references and no photo count is mentioned. Do NOT flag missing photos based on the presence of a virtual tour, 360 tour, or video tour — these are additional features, not replacements for photos. A listing can have both photos AND a virtual tour simultaneously. Never generate a red flag about missing photos (e.g. "Virtual Tour Only — No Internal Photos Visible", "No Interior Photos") unless you are certain from the listing content that photos are genuinely absent. When in doubt, do not flag this — a false positive on photos is more harmful than missing a genuine case.
- IMPORTANT: SQUARE FOOTAGE. Only use a square footage figure if it is EXPLICITLY stated in the listing text (e.g. "1,180 sq ft", "110 sqm", or a PropertyData FLOOR AREAS figure for this exact property). NEVER estimate, infer, calculate, or assume square footage from bedroom count, property type, room dimensions, or general knowledge. If sq ft is not explicitly stated: set property.sqft to 0, set metrics.pricePerSqFt to 0, set areaContext.priceVsAreaPercent to null, and anywhere price per sq ft would otherwise be referenced (areaContext.comparableNote, scoreReasons.valueForMoney, redFlags details, etc.) include this exact sentence verbatim instead of any £/sqft figure: "Square footage is typically shown on the listing's floor plan. Please enter it in the sq ft input field below for accurate price per sq ft analysis. If no floor plan is available, ensure you request accurate square footage data from the agent — this is a key part of any property analysis and essential for assessing whether you are buying at the right price per square foot." Do not produce any estimated or assumed £/sqft number under any circumstances when sq ft is unknown.
- IMPORTANT: MISSING SQ FT IS NOT A RED FLAG. Square footage is almost never included in Rightmove listing text — it is standard UK practice for sq ft to appear on the floorplan only, which is not passed to you as text. Therefore: (a) NEVER generate a red flag, transparency issue, or risk note about sq ft being missing from the listing description. (b) NEVER lower the listingTransparency sub-score because sq ft is absent from the text. (c) Assume sq ft exists on the floorplan and rely on the standard prompt to the user to enter it (see the SQUARE FOOTAGE rule above). (d) Only treat missing sq ft as genuinely suspicious or as a transparency red flag if there is EXPLICIT evidence the agent is withholding it — for example the agent literally answers "Ask agent" to a size field, OR the listing has no floorplan at all (i.e. "FLOOR PLAN PRESENT: no" is explicitly present). In those narrow cases a LOW or MEDIUM transparency note is acceptable. Never use missing sq ft as a contributing factor to a low listingTransparency score unless a floorplan is confirmed absent.
- IMPORTANT: Floor plans. If the listing content begins with or contains a line like "FLOOR PLAN PRESENT: yes" (injected by our scraper after detecting a floor plan image, a "Floorplan" tab, or a floorplan asset on the listing page), the listing HAS a floor plan — do NOT generate any "no floor plan provided", "missing floor plan", or similar red flag under any circumstances. Only flag a missing floor plan if the line "FLOOR PLAN PRESENT: no" is explicitly present, or if there is no FLOOR PLAN PRESENT line at all AND the listing description itself gives no indication of a floor plan. When in doubt, do not flag — floor plan images are not passed to you as text, so absence of mention in the listing description is not evidence of absence.
- Tailor the 8 viewing questions to specific things in this listing, not generic boilerplate.
- EPC: Look for the pattern "EPC RATING EXTRACTED: [letter]" at the top of the listing content — this is the confirmed EPC rating, always use it as epc.rating. Also look for variations like "EPC rating D", "EPC Rating: D", or "* EPC rating D" in the description text. If the listing content begins with a line like "EXTRACTED FROM PAGE HTML — EPC rating: X", trust that value. If the listing content contains council tax band information, look in the same section for an EPC rating — on Rightmove they appear together (common format: "Council Tax band X" alongside "EPC rating Y", often in an "Additional Property Information" bullet list). Do NOT guess or invent an EPC rating. If the listing genuinely does not show one, return epc: null. If you find one, populate rating, score, potentialRating and estimatedAnnualEnergyCost where visible (otherwise null), and ALWAYS write a 2-3 sentence commentary tailored to THIS property's size and rating: typical annual energy bills for a property this size at this rating, the cost and saving of upgrading to the next band, and mortgage lender implications if rated below D.
- PRICE HISTORY: Always set priceHistory to null. Do not include any historical sale data.
- FLOOD RISK: If "ENVIRONMENT AGENCY FLOOD RISK" data is provided in the listing content, populate floodRisk with EXACTLY those values for riversAndSea, surfaceWater, reservoir, groundwater and overallRisk. Set autoRedFlag=true ONLY if Rivers/Sea risk is "High". Write a 2-3 sentence commentary explaining the practical implications: buildings insurance cost, mortgage lender concerns, what the buyer should do. For High risk specifically mention that some insurers refuse cover or charge 3-5x standard premiums and that some mortgage lenders require flood resilience measures as a condition of lending. If no flood data is provided, set floodRisk to null.
- Be direct and useful — this buyer is about to spend hundreds of thousands of pounds.

- Populate sellerMotivation based on: days on market, number of price reductions, chain status, reason for sale if mentioned, listing language urgency, and time of year. Score 1-3 = low motivation (recently listed, no reductions, strong market), 4-6 = moderate, 7-8 = high (30+ days, reduced, or chain free with emphasis), 9-10 = very high (multiple reductions, long time on market, vacant, urgent language). Signals must be short concrete strings drawn from the listing (e.g. "35 days on market", "Price reduced twice", "No onward chain", "Vacant possession"). Commentary is 2-3 sentences explaining what the motivation level means for the buyer's negotiating position.
- Populate viewingChecklist with 8-15 specific actionable items derived from the red flags and property characteristics identified. Every item must be specific to THIS property — not generic advice. Reference specific details from the listing. Each item belongs to one of: "Structure", "Legal", "Running costs", "Negotiation", "Practical". The "why" is one sentence explaining why this matters for THIS specific property.
- Populate renovationCosts only for issues identified in the red flags or listing. Do not invent issues not mentioned. Use realistic UK contractor pricing for 2026. estimatedCost should be a string range like "£15,000 – £25,000". priority is one of "High priority", "Medium priority", "Low priority". For renovation priority: use "High priority" for items that affect safety, mortgageability, or immediate habitability; "Medium priority" for items that affect comfort, energy efficiency, or resale value within 5 years; "Low priority" for cosmetic or lifestyle improvements the buyer may choose to defer or skip entirely. Never use "Essential" as this implies no choice — buyers may choose to accept any condition. Set totalEstimatedMin and totalEstimatedMax as the sum of min/max integers across items. Commentary is 2-3 sentences on overall renovation picture and whether costs are factored into asking price. If no renovation is needed, return { items: [], totalEstimatedMin: 0, totalEstimatedMax: 0, commentary: "..." }.
- PLANNING REFERENCE: Scan the listing text for a UK planning application reference. Common formats: "XX/XXXXX/XXX" (e.g. "21/03456/FUL", "22/01234/HOUSE") or older "XXXX/XXXX". Look for these especially near the words: planning, permission, reference, application, consent, approval. If found, set planningReference.found = true and populate: reference (the exact reference number as written), relatesTo (a brief description of the works derived from listing context — e.g. "rear kitchen extension", "loft conversion", "side dormer"; null if not inferable), applicationType (one of "Householder" | "Full Planning" | "Change of Use" | "Listed Building Consent" | "Unknown" — infer from the suffix and context: /FUL = Full Planning, /HOUSE or /HH = Householder, /COU = Change of Use, /LBC = Listed Building Consent), and commentary (2-3 sentences explaining what this reference means for the buyer, what documents to request from the seller's solicitors — typically the planning decision notice, approved drawings, and building regs completion certificate — and any typical conditions that attach to this type of permission). If no planning reference is present in the listing, return planningReference: { "found": false, "reference": null, "relatesTo": null, "applicationType": null, "commentary": null } (or omit the field). Do NOT invent a reference number.

Always respond with ONLY a single valid JSON object matching this exact shape (no markdown, no commentary, no code fences):
{
  "property": { "address": string, "price": number, "beds": number, "baths": number, "type": string, "sqft": number, "listingUrl": string },
  "score": number (0-10, one decimal),
  "scoreLabel": string,
  "subScores": { "valueForMoney": number, "locationQuality": number, "listingTransparency": number, "marketTiming": number, "riskLevel": number, "resalePotential": number },
  "scoreReasons": { "valueForMoney": string, "locationQuality": string, "listingTransparency": string, "marketTiming": string, "riskLevel": string, "resalePotential": string },
  "metrics": { "pricePerSqFt": number, "daysOnMarket": number, "councilTaxBand": string, "estimatedStampDuty": number },
  "epc": { "rating": string|null, "score": number|null, "potentialRating": string|null, "estimatedAnnualEnergyCost": string|null, "commentary": string } | null,
  "priceHistory": null,
  "floodRisk": { "riversAndSea": "Very Low"|"Low"|"Medium"|"High"|null, "surfaceWater": "Very Low"|"Low"|"Medium"|"High"|null, "reservoir": boolean|null, "groundwater": "Very Low"|"Low"|"Medium"|"High"|null, "overallRisk": "Very Low"|"Low"|"Medium"|"High"|null, "commentary": string, "autoRedFlag": boolean } | null,
  "areaContext": { "avgPricePerSqFtArea": number|null, "avgSoldPriceArea": number|null, "priceVsAreaPercent": number|null, "areaDescription": string, "comparableNote": string },
  "redFlags": [ { "severity": "high"|"medium"|"low", "title": string, "detail": string } ] (3-8 items),
  "costs": { "purchasePrice": number, "stampDuty": number, "legalFees": number, "surveyFees": number, "mortgageFees": number, "totalUpfront": number, "monthlyMortgage": number, "mortgageAssumptions": string },
  "viewingQuestions": string[] (exactly 8),
  "negotiation": { "isAuction": boolean (optional), "maxBid": number (optional, auction only), "recommendedOffer": { "low": number, "high": number }, "rationale": string, "leverage": string[] (3-6) },
  "sellerMotivation": { "score": number (1-10), "label": "Low"|"Moderate"|"High"|"Very High", "signals": string[], "commentary": string },
  "viewingChecklist": { "items": [{ "category": "Structure"|"Legal"|"Running costs"|"Negotiation"|"Practical", "item": string, "why": string }] (8-15) },
  "renovationCosts": { "items": [{ "issue": string, "estimatedCost": string, "priority": "High priority"|"Medium priority"|"Low priority", "notes": string }], "totalEstimatedMin": number, "totalEstimatedMax": number, "commentary": string },
  "comparables": [ { "address": string, "soldPrice": number, "soldDate": string, "distance": string } ] (0-4),
  "planningReference": { "found": boolean, "reference": string|null, "relatesTo": string|null, "applicationType": "Householder"|"Full Planning"|"Change of Use"|"Listed Building Consent"|"Unknown"|null, "commentary": string|null } | null
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
    throw new Error("INVALID_URL: Works best with Rightmove listings · More sites coming soon");
  }
  if (parsed.protocol !== "https:") {
    throw new Error("INVALID_URL: Works best with Rightmove listings · More sites coming soon");
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(
      "INVALID_URL: Works best with Rightmove listings · More sites coming soon"
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

// Decode the most common HTML entities we encounter in listing text/meta.
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&pound;/g, "£")
    .replace(/&#163;/g, "£")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function htmlToCleanText(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}



const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

async function basicFetchListingHtml(url: string): Promise<string> {
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
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

function htmlToListingText(html: string): string {
  if (!html) return "";
  const lower = html.toLowerCase();
  const blocked =
    html.length < 500 ||
    lower.includes("enable javascript") ||
    lower.includes("access denied");

  let text = "";
  if (!blocked) {
    text = htmlToCleanText(html).slice(0, 25_000);
  }
  if (text.length < 200) {
    // Fall back to head metadata when the body is unreadable.
    const metas = extractMetaContent(html, [
      "og:title",
      "og:description",
      "twitter:title",
      "twitter:description",
      "description",
    ]);
    const combined = metas.map(decodeEntities).filter(Boolean).join("\n").trim();
    if (combined.length >= 100) {
      text = `[Limited content — extracted from page metadata only]\n\n${combined}`.slice(0, 25_000);
    }
  }
  return text;
}

function extractEpcAndCouncilTax(html: string): { epc: string | null; councilTax: string | null } {
  if (!html) return { epc: null, councilTax: null };
  let epc: string | null = null;
  let councilTax: string | null = null;
  const epcPatterns: RegExp[] = [
    // Plain-text bullet pattern commonly found in Rightmove descriptions
    // e.g. "* EPC rating D", "* EPC Rating: C", "EPC rating: D"
    /\*?\s*EPC\s+rating[:\s]+([A-G])\b/i,
    /EPC[\s_-]*rating[^A-Za-z0-9]{0,10}([A-G])\b/i,
    /Energy[\s_-]*rating[^A-Za-z0-9]{0,10}([A-G])\b/i,
    /Energy[\s_-]*Performance[^<>]{0,60}?\b([A-G])\b/i,
    /"epcRating"\s*:\s*"([A-G])"/i,
    /"energyRating"\s*:\s*"([A-G])"/i,
    /"currentEnergyRating"\s*:\s*"?([A-G])"?/i,
    /data-epc-rating\s*=\s*["']([A-G])["']/i,
    /data-energy-rating\s*=\s*["']([A-G])["']/i,
    /aria-label\s*=\s*["'][^"']*?(?:EPC|Energy)[^"']*?\b([A-G])\b[^"']*["']/i,
  ];
  for (const p of epcPatterns) {
    const m = html.match(p);
    if (m?.[1]) { epc = m[1].toUpperCase(); break; }
  }
  const ctPatterns: RegExp[] = [
    /Council[\s_-]*Tax[\s_-]*band[^A-Za-z0-9]{0,10}([A-H])\b/i,
    /Council[\s_-]*Tax[^<>]{0,60}?\bBand\s*([A-H])\b/i,
    /"councilTaxBand"\s*:\s*"([A-H])"/i,
  ];
  for (const p of ctPatterns) {
    const m = html.match(p);
    if (m?.[1]) { councilTax = m[1].toUpperCase(); break; }
  }
  return { epc, councilTax };
}

function detectFloorPlan(html: string): boolean {
  if (!html) return false;
  const patterns: RegExp[] = [
    /\bfloorplans?\b/i,
    /["']floorplans?["']\s*:/i,
    /\/floorplans?\//i,
    /_FLP_\d+/i,
    /floor[\s-]*plan/i,
  ];
  return patterns.some((p) => p.test(html));
}

function extractListedDate(html: string): { dateStr: string; daysOnMarket: number } | null {
  if (!html) return null;
  const patterns: RegExp[] = [
    /Added on (\d{1,2}\/\d{1,2}\/\d{4})/i,
    /Listed on (\d{1,2}\/\d{1,2}\/\d{4})/i,
    /First listed[: ]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /available from[: ]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /Reduced on (\d{1,2}\/\d{1,2}\/\d{4})/i,
    // Fallback: any date within ~40 chars of "added" or "listed"
    /(?:added|listed)[^<>]{0,40}?(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) {
      const [dd, mm, yyyy] = m[1].split("/").map(Number);
      const listed = new Date(Date.UTC(yyyy, mm - 1, dd));
      if (!isNaN(listed.getTime())) {
        const days = Math.max(
          0,
          Math.floor((Date.now() - listed.getTime()) / (1000 * 60 * 60 * 24))
        );
        return { dateStr: m[1], daysOnMarket: days };
      }
    }
  }
  return null;
}

type LandRegistryEntry = { date: string; price: number; event: "sold" };
type LandRegistryResult = { entries: LandRegistryEntry[]; nearbyMode: boolean } | null;

const POSTCODE_RE = /\b([A-Z]{1,2}[0-9][0-9A-Z]?)\s?([0-9][A-Z]{2})\b/i;
const LAND_REGISTRY_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function extractPostcode(text: string): string | null {
  if (!text) return null;
  const m = text.match(POSTCODE_RE);
  if (!m) return null;
  return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
}

function extractAddressBits(text: string): {
  postcode: string | null;
  paon: string | null;
  saon: string | null;
  street: string | null;
} {
  const postcode = extractPostcode(text);
  let paon: string | null = null;
  let saon: string | null = null;
  let street: string | null = null;
  if (!text) return { postcode, paon, saon, street };

  // Look for "Flat N" / "Apartment N" / "Unit N"
  const flatMatch = text.match(/\b(?:Flat|Apartment|Apt|Unit)\s+([0-9]+[A-Z]?)\b/i);
  if (flatMatch) saon = flatMatch[1].toUpperCase();

  // House number + street name pattern, e.g. "16 Marlborough Street"
  // Pull the first occurrence within a window around the postcode if possible.
  const numberStreet = text.match(/\b(\d+[A-Z]?)\s+([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+){0,4}?\s+(?:Street|St|Road|Rd|Lane|Ln|Avenue|Ave|Close|Cl|Drive|Dr|Way|Place|Pl|Court|Ct|Crescent|Terrace|Square|Hill|Park|Mews|Gardens|Grove|Walk|Row))\b/);
  if (numberStreet) {
    paon = numberStreet[1].toUpperCase();
    street = numberStreet[2].trim();
  } else {
    // Property name like "Rose Cottage"
    const nameMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Cottage|House|Lodge|Manor|Barn|Farm|Villa))\b/);
    if (nameMatch && !paon) paon = nameMatch[1];
  }

  return { postcode, paon, saon, street };
}

function landRegistryCacheKey(postcode: string, paon: string | null, saon: string | null, street: string | null) {
  return `landreg:${postcode}|${paon ?? ""}|${saon ?? ""}|${street ?? ""}`;
}

function formatMonthYear(iso: string): string {
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return iso;
  return `${MONTH_NAMES[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`;
}

type PpiItem = {
  pricePaid?: number;
  transactionDate?: string;
  propertyAddress?: {
    paon?: string;
    saon?: string;
    street?: string;
    postcode?: string;
  };
  // Some responses use a different shape; tolerate it.
  primaryAddressobject?: { paon?: string; saon?: string };
};

async function fetchLandRegistryPriceHistory(
  postcode: string,
  paon: string | null,
  saon: string | null,
  street: string | null,
): Promise<LandRegistryResult> {
  console.log(`fetchPriceHistory called with postcode: ${postcode}`);
  if (!postcode) {
    console.log("fetchPriceHistory returned 0 results");
    return null;
  }

  const cacheKey = landRegistryCacheKey(postcode, paon, saon, street);
  // Cache lookup
  try {
    const { data: cached } = await supabaseAdmin
      .from("listing_cache")
      .select("text_content, fetched_at")
      .eq("url", cacheKey)
      .maybeSingle();
    if (
      cached?.text_content &&
      Date.now() - new Date(cached.fetched_at).getTime() < LAND_REGISTRY_TTL_MS
    ) {
      try {
        const parsed = JSON.parse(cached.text_content);
        if (parsed && Array.isArray(parsed.entries)) {
          console.log(`fetchPriceHistory returned ${parsed.entries.length} results (cached)`);
          return parsed as LandRegistryResult;
        }
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.error("[landRegistry] cache lookup failed:", err);
  }

  const pcParam = postcode.replace(/\s+/g, "+");
  const url = `https://landregistry.data.gov.uk/data/ppi/transaction-record.json?propertyAddress.postcode=${pcParam}&_page=0&_pageSize=10&_sort=-transactionDate`;

  let items: PpiItem[] = [];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      console.error(`[landRegistry] HTTP ${res.status} for ${url}`);
      console.log("fetchPriceHistory returned 0 results");
      return null;
    }
    const json = (await res.json()) as { result?: { items?: PpiItem[] } };
    items = json?.result?.items ?? [];
  } catch (err) {
    console.error("[landRegistry] fetch failed:", err);
    console.log("fetchPriceHistory returned 0 results");
    return null;
  }

  const toEntry = (it: PpiItem): LandRegistryEntry | null => {
    const price = typeof it.pricePaid === "number" ? it.pricePaid : NaN;
    const date = it.transactionDate ?? "";
    if (!Number.isFinite(price) || price <= 0 || !date) return null;
    return { date: formatMonthYear(date), price, event: "sold" as const };
  };

  const itemPaon = (it: PpiItem): string =>
    (it.propertyAddress?.paon ?? it.primaryAddressobject?.paon ?? "").toString().toUpperCase();

  // Exact-match only — if we don't know the property number, or none of the
  // postcode results match it, return null. No nearby/street-level fallback.
  if (!paon) {
    console.log("fetchPriceHistory returned 0 results (no paon to match)");
    return null;
  }

  const target = paon.toUpperCase();
  const matched = items.filter((it) => itemPaon(it) === target);
  const entries: LandRegistryEntry[] = matched
    .map(toEntry)
    .filter((x): x is LandRegistryEntry => x !== null);

  // Sort oldest-first for the timeline UI
  entries.sort((a, b) => a.date.localeCompare(b.date));

  if (entries.length === 0) {
    console.log("fetchPriceHistory returned 0 results (no exact match)");
    return null;
  }

  const result: LandRegistryResult = { entries, nearbyMode: false };
  try {
    await supabaseAdmin
      .from("listing_cache")
      .upsert(
        { url: cacheKey, text_content: JSON.stringify(result), fetched_at: new Date().toISOString() },
        { onConflict: "url" },
      );
  } catch (err) {
    console.error("[landRegistry] cache upsert failed:", err);
  }

  console.log(`fetchPriceHistory returned ${entries.length} results`);
  return result;
}

const SCOTTISH_POSTCODE_PREFIXES = [
  "EH","G","KA","KY","DD","AB","IV","PH","FK","ML","PA","KW","HS","ZE","TD","DG",
];

function isScottishPostcode(postcode: string | null): boolean {
  if (!postcode) return false;
  const pc = postcode.toUpperCase().replace(/\s+/g, "");
  // Match leading alpha area code (1-2 letters before first digit).
  const area = pc.match(/^[A-Z]+/)?.[0] ?? "";
  return SCOTTISH_POSTCODE_PREFIXES.includes(area);
}

// ---------------- Flood Risk (Environment Agency) ----------------
type FloodRiskRaw = {
  riversAndSea: string | null;
  surfaceWater: string | null;
  reservoir: boolean | null;
  groundwater: string | null;
  overallRisk: string | null;
  scotland?: boolean;
  unavailable?: boolean;
};

const FLOOD_RISK_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

const RISK_LEVELS = ["very low", "low", "medium", "high"] as const;
function normaliseRisk(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/\s+/g, " ");
  if (RISK_LEVELS.includes(s as (typeof RISK_LEVELS)[number])) {
    return s.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return null;
}

function highestRisk(values: (string | null)[]): string | null {
  let best = -1;
  for (const v of values) {
    if (!v) continue;
    const idx = RISK_LEVELS.indexOf(v.toLowerCase() as (typeof RISK_LEVELS)[number]);
    if (idx > best) best = idx;
  }
  if (best < 0) return null;
  const v = RISK_LEVELS[best];
  return v.replace(/\b\w/g, (c) => c.toUpperCase());
}

async function fetchFloodRisk(postcode: string | null): Promise<FloodRiskRaw | null> {
  if (!postcode) return null;
  console.log(`fetchFloodRisk called with postcode: ${postcode}`);

  if (isScottishPostcode(postcode)) {
    console.log("fetchFloodRisk: Scottish postcode, skipping EA API");
    return {
      riversAndSea: null,
      surfaceWater: null,
      reservoir: null,
      groundwater: null,
      overallRisk: null,
      scotland: true,
    };
  }

  const cacheKey = `floodrisk:${postcode}`;
  try {
    const { data: cached } = await supabaseAdmin
      .from("listing_cache")
      .select("text_content, fetched_at")
      .eq("url", cacheKey)
      .maybeSingle();
    if (
      cached?.text_content &&
      Date.now() - new Date(cached.fetched_at).getTime() < FLOOD_RISK_TTL_MS
    ) {
      try {
        const parsed = JSON.parse(cached.text_content) as FloodRiskRaw;
        console.log(`fetchFloodRisk returned cached for ${postcode}`);
        return parsed;
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.error("[floodRisk] cache lookup failed:", err);
  }

  // EA API requires properly-formatted UK postcode with a space before the last 3 chars.
  const pcCompact = postcode.replace(/\s+/g, "").toUpperCase();
  const pcFormatted = pcCompact.length > 3
    ? `${pcCompact.slice(0, -3)} ${pcCompact.slice(-3)}`
    : pcCompact;
  const pcParam = encodeURIComponent(pcFormatted);
  const url = `https://check-long-term-flood-risk.service.gov.uk/api/flood-risk-by-postcode/${pcParam}`;

  let raw: FloodRiskRaw | null = null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Roovr/1.0" },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) {
      console.error(`[floodRisk] HTTP ${res.status} for ${url}`);
      return { riversAndSea: null, surfaceWater: null, reservoir: null, groundwater: null, overallRisk: null, unavailable: true };
    }
    const json = (await res.json()) as Record<string, unknown>;
    const rivers = normaliseRisk(json.floodRiskFromRivers ?? json.riversAndSea ?? json.rivers);
    const surface = normaliseRisk(json.floodRiskFromSurface ?? json.surfaceWater ?? json.surface);
    const ground = normaliseRisk(json.floodRiskFromGroundwater ?? json.groundwater);
    const reservoirRaw = json.floodRiskFromReservoir ?? json.reservoir;
    const reservoir = typeof reservoirRaw === "boolean" ? reservoirRaw : null;
    const overall = highestRisk([rivers, surface, ground]);
    raw = {
      riversAndSea: rivers,
      surfaceWater: surface,
      reservoir,
      groundwater: ground,
      overallRisk: overall,
    };
  } catch (err) {
    console.error("[floodRisk] fetch failed:", err);
    return { riversAndSea: null, surfaceWater: null, reservoir: null, groundwater: null, overallRisk: null, unavailable: true };
  }

  try {
    await supabaseAdmin
      .from("listing_cache")
      .upsert(
        { url: cacheKey, text_content: JSON.stringify(raw), fetched_at: new Date().toISOString() },
        { onConflict: "url" },
      );
  } catch (err) {
    console.error("[floodRisk] cache upsert failed:", err);
  }

  console.log(`fetchFloodRisk returned overallRisk=${raw?.overallRisk ?? "null"}`);
  return raw;
}

// ---------------- Nearby Schools (DfE / Ofsted) ----------------
type SchoolEntry = {
  name: string;
  ofstedRating: number | null;
  schoolType: string | null;
  phase: "primary" | "secondary" | "other";
  distanceMiles: number;
};
type NearbySchoolsRaw = {
  schools: SchoolEntry[];
  unavailable?: boolean;
  aiSourced?: boolean;
};

const NEARBY_SCHOOLS_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function classifyPhase(schoolType: string | null): "primary" | "secondary" | "other" {
  if (!schoolType) return "other";
  const s = schoolType.toLowerCase();
  if (/(secondary|sixth|all[- ]through|upper)/.test(s)) return "secondary";
  if (/(primary|infant|junior|first|nursery)/.test(s)) return "primary";
  return "other";
}

function normaliseSchoolList(list: any[]): SchoolEntry[] {
  return list
    .map((s) => {
      const name: string =
        s.school_name ?? s.name ?? s.schoolName ?? s.establishmentName ?? s.EstablishmentName ?? "";
      const ofstedRaw =
        s.ofsted_rating ?? s.ofstedRating ?? s.ofsted ?? s.ofstedRatingName ?? s.OfstedRating;
      const ofstedRating =
        typeof ofstedRaw === "number"
          ? ofstedRaw
          : typeof ofstedRaw === "string" && /^\d$/.test(ofstedRaw)
            ? Number(ofstedRaw)
            : null;
      const schoolType: string | null =
        s.school_type ?? s.schoolType ?? s.type ?? s.phaseOfEducation ?? s.PhaseOfEducation ?? s.TypeOfEstablishment ?? null;
      const milesRaw = s.distanceInMiles ?? s.distance_miles ?? s.distanceMiles;
      let distanceMiles: number;
      if (milesRaw != null && Number.isFinite(Number(milesRaw))) {
        distanceMiles = Number(milesRaw);
      } else {
        const distRaw = s.distance ?? s.distance_km ?? s.distanceKm ?? s.distance_metres ?? s.distanceMetres;
        const distNum = typeof distRaw === "number" ? distRaw : Number(distRaw);
        if (Number.isFinite(distNum)) {
          // Heuristic: >100 → metres, else km
          distanceMiles = distNum > 100 ? distNum / 1609.34 : distNum * 0.621371;
        } else {
          distanceMiles = NaN;
        }
      }
      return {
        name,
        ofstedRating,
        schoolType,
        phase: classifyPhase(schoolType),
        distanceMiles,
      };
    })
    .filter((s) => s.name && Number.isFinite(s.distanceMiles))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);
}

async function fetchSchoolsFromClaude(
  postcode: string,
  address: string,
  coordinates: { lat: number; lng: number } | null,
  apiKey: string | undefined,
): Promise<SchoolEntry[]> {
  if (!apiKey) return [];
  try {
    const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 0 });
    const coordStr = coordinates ? ` (approx ${coordinates.lat.toFixed(4)}, ${coordinates.lng.toFixed(4)})` : "";
    const prompt = `List up to 8 primary and secondary schools within approximately 5 miles of ${address || postcode} ${postcode}${coordStr} in the UK. Include school name, approximate distance, Ofsted rating if known, and school type. Base this on your training knowledge of UK schools. If you are not confident about specific schools in this area, say so clearly rather than guessing.

Return ONLY a single valid JSON object (no markdown, no code fences) of this exact shape:
{
  "schools": [
    { "name": string, "distanceMiles": number, "ofstedRating": number | null, "schoolType": "Primary" | "Secondary" | "All-through" | "Other" }
  ]
}
Use ofstedRating 1=Outstanding, 2=Good, 3=Requires Improvement, 4=Inadequate, or null if unknown. If not confident in any specific schools for this area, return { "schools": [] }.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as { schools?: any[] };
    if (!Array.isArray(parsed.schools)) return [];
    return normaliseSchoolList(parsed.schools);
  } catch (err) {
    console.error("[nearbySchools] Claude fallback failed:", err);
    return [];
  }
}

async function fetchNearbySchools(
  postcode: string | null,
  address: string,
  apiKey: string | undefined,
): Promise<NearbySchoolsRaw | null> {
  if (!postcode) return null;
  console.log(`fetchNearbySchools called with postcode: ${postcode}`);

  const cacheKey = `schools:v2:${postcode}`;
  try {
    const { data: cached } = await supabaseAdmin
      .from("listing_cache")
      .select("text_content, fetched_at")
      .eq("url", cacheKey)
      .maybeSingle();
    if (
      cached?.text_content &&
      Date.now() - new Date(cached.fetched_at).getTime() < NEARBY_SCHOOLS_TTL_MS
    ) {
      try {
        const parsed = JSON.parse(cached.text_content) as NearbySchoolsRaw;
        if ((parsed.schools?.length ?? 0) > 0) {
          console.log(`fetchNearbySchools cached hit for ${postcode} (${parsed.schools.length})`);
          return parsed;
        }
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.error("[nearbySchools] cache lookup failed:", err);
  }

  const pcCompact = postcode.replace(/\s+/g, "").toUpperCase();
  const pcFormatted = pcCompact.length > 3
    ? `${pcCompact.slice(0, -3)} ${pcCompact.slice(-3)}`
    : pcCompact;
  const pcParam = encodeURIComponent(pcFormatted);

  const headers = {
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; Roovr/1.0; +https://roovr.co)",
    "Referer": "https://roovr.co",
  };

  const tryFetch = async (url: string): Promise<SchoolEntry[]> => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10_000);
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(t);
      const bodyText = await res.text();
      console.log(`[nearbySchools] ${url} → HTTP ${res.status}, body[0..200]: ${bodyText.slice(0, 200)}`);
      if (!res.ok) return [];
      let json: unknown;
      try { json = JSON.parse(bodyText); } catch { return []; }
      const list: any[] = Array.isArray(json)
        ? (json as any[])
        : Array.isArray((json as any)?.results) ? (json as any).results
        : Array.isArray((json as any)?.data) ? (json as any).data
        : Array.isArray((json as any)?.schools) ? (json as any).schools
        : Array.isArray((json as any)?.establishments) ? (json as any).establishments
        : [];
      return normaliseSchoolList(list);
    } catch (err) {
      console.error(`[nearbySchools] fetch failed for ${url}:`, err);
      return [];
    }
  };

  // 1. Primary: GIAS API
  let schools = await tryFetch(
    `https://get-information-schools.service.gov.uk/api/v1/schools?location=${pcParam}&radiusInMiles=5&includeReligious=true`,
  );
  let aiSourced = false;

  // 2. Alt: data.education.gov.uk with lat/lng
  if (schools.length === 0) {
    const coords = await postcodeToLatLng(pcFormatted);
    if (coords) {
      schools = await tryFetch(
        `https://data.education.gov.uk/api/establishments?filters[gor_name]=any&filters[location]=${coords.lat},${coords.lng}&filters[distance]=8000&page[size]=20`,
      );
    }
  }

  // 3. Claude knowledge fallback
  if (schools.length === 0) {
    const coords = await postcodeToLatLng(pcFormatted);
    const claudeSchools = await fetchSchoolsFromClaude(pcFormatted, address, coords, apiKey);
    if (claudeSchools.length > 0) {
      schools = claudeSchools;
      aiSourced = true;
    }
  }

  if (schools.length === 0) {
    return { schools: [], unavailable: true };
  }

  const raw: NearbySchoolsRaw = { schools, aiSourced };

  try {
    await supabaseAdmin
      .from("listing_cache")
      .upsert(
        { url: cacheKey, text_content: JSON.stringify(raw), fetched_at: new Date().toISOString() },
        { onConflict: "url" },
      );
  } catch (err) {
    console.error("[nearbySchools] cache upsert failed:", err);
  }

  console.log(`fetchNearbySchools returned ${raw.schools.length} schools (aiSourced=${aiSourced})`);
  return raw;
}

// ---------------- Crime statistics (data.police.uk) ----------------
type CrimeRaw = {
  totalCrimes: number;
  month: string;
  topCategories: { category: string; count: number; label: string }[];
  riskLevel: "Low" | "Moderate" | "High" | "Very High";
  commentary: string;
  autoRedFlag: boolean;
  coordinates: { lat: number; lng: number } | null;
  unavailable?: boolean;
};

const CRIME_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const CRIME_CATEGORY_LABELS: Record<string, string> = {
  "burglary": "Burglary",
  "vehicle-crime": "Vehicle crime",
  "violent-crime": "Violence and sexual offences",
  "anti-social-behaviour": "Anti-social behaviour",
  "robbery": "Robbery",
  "criminal-damage-arson": "Criminal damage and arson",
  "drugs": "Drugs",
  "shoplifting": "Shoplifting",
  "theft-from-the-person": "Theft from the person",
  "bicycle-theft": "Bicycle theft",
  "other-theft": "Other theft",
  "public-order": "Public order",
  "possession-of-weapons": "Possession of weapons",
  "other-crime": "Other crime",
};

function recentCrimeMonth(): string {
  // Police data lags ~2 months. Use current - 2.
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 2);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function formatCrimeMonthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

async function postcodeToLatLng(postcode: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const pc = encodeURIComponent(postcode.trim());
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`https://api.postcodes.io/postcodes/${pc}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: { latitude?: number; longitude?: number } };
    const lat = j.result?.latitude;
    const lng = j.result?.longitude;
    if (typeof lat === "number" && typeof lng === "number") return { lat, lng };
    return null;
  } catch (err) {
    console.error("[crime] postcodes.io failed:", err);
    return null;
  }
}

async function generateCrimeCommentary(
  apiKey: string | undefined,
  payload: {
    crimeData: { category: string; count: number; label: string }[];
    totalCrimes: number;
    coordinates: { lat: number; lng: number };
    address: string;
    month: string;
  },
): Promise<{ riskLevel: CrimeRaw["riskLevel"]; commentary: string; autoRedFlag: boolean }> {
  // Heuristic fallback risk (also used if Claude fails).
  const t = payload.totalCrimes;
  const fallbackRisk: CrimeRaw["riskLevel"] =
    t < 50 ? "Low" : t < 150 ? "Moderate" : t < 300 ? "High" : "Very High";
  const fallbackCommentary = `Police recorded ${t} crimes within a 1-mile radius of this property in ${formatCrimeMonthLabel(payload.month)}. Compare with your local knowledge and consider security and insurance implications.`;
  const fallback = {
    riskLevel: fallbackRisk,
    commentary: fallbackCommentary,
    autoRedFlag: fallbackRisk === "High" || fallbackRisk === "Very High",
  };
  if (!apiKey) return fallback;

  try {
    const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 0 });
    const prompt = `You are a UK property risk analyst. Given the following police-recorded crime data for the area around ${payload.address || "this property"} in ${formatCrimeMonthLabel(payload.month)}:

Total crimes within ~1 mile: ${payload.totalCrimes}
Top categories:
${payload.crimeData.slice(0, 8).map((c) => `- ${c.label}: ${c.count}`).join("\n")}

Return ONLY a single valid JSON object (no markdown, no code fences) of this exact shape:
{
  "riskLevel": "Low" | "Moderate" | "High" | "Very High",
  "commentary": string (2-3 sentences: how this compares to a typical UK residential area, any particular crime types worth flagging, practical implications for buildings/contents insurance or security measures),
  "autoRedFlag": boolean (true ONLY if riskLevel is High or Very High)
}

UK reference points: a quiet residential area typically sees 30-80 recorded crimes per month within 1 mile; 80-200 is moderate / urban-typical; 200-400 is high; 400+ is very high (often town/city centres). Adjust for likely category mix (e.g. mostly anti-social-behaviour in a town centre is less alarming than burglary or violent-crime dominating a residential street).`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as {
      riskLevel?: string;
      commentary?: string;
      autoRedFlag?: boolean;
    };
    const riskLevel = (["Low", "Moderate", "High", "Very High"].includes(parsed.riskLevel ?? "")
      ? parsed.riskLevel
      : fallbackRisk) as CrimeRaw["riskLevel"];
    return {
      riskLevel,
      commentary: typeof parsed.commentary === "string" && parsed.commentary.length > 10
        ? parsed.commentary
        : fallbackCommentary,
      autoRedFlag: typeof parsed.autoRedFlag === "boolean"
        ? parsed.autoRedFlag
        : (riskLevel === "High" || riskLevel === "Very High"),
    };
  } catch (err) {
    console.error("[crime] Claude commentary failed:", err);
    return fallback;
  }
}

async function fetchCrimeStats(
  postcode: string | null,
  address: string,
  apiKey: string | undefined,
): Promise<CrimeRaw | null> {
  if (!postcode) return null;
  const month = recentCrimeMonth();
  const cacheKey = `crime:${postcode.toUpperCase().replace(/\s+/g, "")}:${month}`;

  // Cache lookup
  try {
    const { data: cached } = await supabaseAdmin
      .from("listing_cache")
      .select("text_content, fetched_at")
      .eq("url", cacheKey)
      .maybeSingle();
    if (
      cached?.text_content &&
      Date.now() - new Date(cached.fetched_at).getTime() < CRIME_TTL_MS
    ) {
      try {
        const parsed = JSON.parse(cached.text_content) as CrimeRaw;
        console.log(`[crime] cache hit for ${cacheKey}`);
        return parsed;
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.error("[crime] cache lookup failed:", err);
  }

  const coords = await postcodeToLatLng(postcode);
  if (!coords) {
    return {
      totalCrimes: 0, month, topCategories: [], riskLevel: "Low",
      commentary: "", autoRedFlag: false, coordinates: null, unavailable: true,
    };
  }

  let crimes: { category: string }[] = [];
  try {
    const url = `https://data.police.uk/api/crimes-street/all-crime?lat=${coords.lat}&lng=${coords.lng}&date=${month}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15_000);
    const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Roovr/1.0" }, signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      console.error(`[crime] police.uk HTTP ${res.status}`);
      return {
        totalCrimes: 0, month, topCategories: [], riskLevel: "Low",
        commentary: "", autoRedFlag: false, coordinates: coords, unavailable: true,
      };
    }
    const json = (await res.json()) as { category?: string }[];
    crimes = Array.isArray(json) ? json.map((c) => ({ category: String(c.category ?? "other-crime") })) : [];
  } catch (err) {
    console.error("[crime] police.uk fetch failed:", err);
    return {
      totalCrimes: 0, month, topCategories: [], riskLevel: "Low",
      commentary: "", autoRedFlag: false, coordinates: coords, unavailable: true,
    };
  }

  // Aggregate by category
  const counts = new Map<string, number>();
  for (const c of crimes) counts.set(c.category, (counts.get(c.category) ?? 0) + 1);
  const topCategories = [...counts.entries()]
    .map(([category, count]) => ({
      category,
      count,
      label: CRIME_CATEGORY_LABELS[category] ?? category.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    }))
    .sort((a, b) => b.count - a.count);

  const totalCrimes = crimes.length;

  const { riskLevel, commentary, autoRedFlag } = await generateCrimeCommentary(apiKey, {
    crimeData: topCategories,
    totalCrimes,
    coordinates: coords,
    address,
    month,
  });

  const raw: CrimeRaw = {
    totalCrimes,
    month,
    topCategories,
    riskLevel,
    commentary,
    autoRedFlag,
    coordinates: coords,
  };

  try {
    await supabaseAdmin
      .from("listing_cache")
      .upsert(
        { url: cacheKey, text_content: JSON.stringify(raw), fetched_at: new Date().toISOString() },
        { onConflict: "url" },
      );
  } catch (err) {
    console.error("[crime] cache upsert failed:", err);
  }

  console.log(`[crime] ${cacheKey} → total=${totalCrimes} risk=${riskLevel}`);
  return raw;
}

// ---------------- Broadband (Ofcom Connected Nations + Claude estimation) ----------------
type BroadbandRaw = {
  downloadSpeed: string;
  uploadSpeed: string;
  connectionType: "Full fibre" | "Fibre to cabinet" | "ADSL" | "Limited";
  suitableForRemoteWork: boolean;
  mobileSignal: "Excellent" | "Good" | "Limited" | "Poor";
  commentary: string;
  speedRating: "Excellent" | "Good" | "Average" | "Poor";
  source: "Ofcom" | "Estimated";
  unavailable?: boolean;
  autoRedFlag?: boolean;
};

const BROADBAND_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

type OfcomBroadband = {
  maxDownloadSpeed?: number;
  maxUploadSpeed?: number;
  fttcAvailable?: boolean;
  fttpAvailable?: boolean;
  ultraFastAvailable?: boolean;
  mobileSignal?: string;
};

async function fetchOfcomBroadband(postcode: string): Promise<OfcomBroadband | null> {
  try {
    const pc = encodeURIComponent(postcode.trim());
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(
      `https://api.ofcom.org.uk/connected-nations/broadband-coverage?postcode=${pc}`,
      { headers: { Accept: "application/json", "User-Agent": "Roovr/1.0" }, signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!res.ok) {
      console.log(`[broadband] Ofcom HTTP ${res.status} — falling back to estimation`);
      return null;
    }
    const json = (await res.json()) as OfcomBroadband;
    return json ?? null;
  } catch (err) {
    console.log("[broadband] Ofcom unavailable, falling back to estimation:", (err as Error).message);
    return null;
  }
}

async function fetchPostcodeArea(postcode: string): Promise<{
  admin_district?: string;
  region?: string;
  rural_urban?: string | null;
  parish?: string | null;
} | null> {
  try {
    const pc = encodeURIComponent(postcode.trim());
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`https://api.postcodes.io/postcodes/${pc}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = (await res.json()) as { result?: Record<string, unknown> };
    const r = j.result;
    if (!r) return null;
    return {
      admin_district: typeof r.admin_district === "string" ? r.admin_district : undefined,
      region: typeof r.region === "string" ? r.region : undefined,
      rural_urban: null,
      parish: typeof r.parish === "string" ? (r.parish as string) : null,
    };
  } catch {
    return null;
  }
}

function ratingFromSpeed(maxDown: number): BroadbandRaw["speedRating"] {
  if (maxDown >= 300) return "Excellent";
  if (maxDown >= 80) return "Good";
  if (maxDown >= 24) return "Average";
  return "Poor";
}

function connectionFromOfcom(o: OfcomBroadband): BroadbandRaw["connectionType"] {
  if (o.fttpAvailable || o.ultraFastAvailable) return "Full fibre";
  if (o.fttcAvailable) return "Fibre to cabinet";
  if ((o.maxDownloadSpeed ?? 0) >= 10) return "ADSL";
  return "Limited";
}

async function generateBroadbandFromClaude(
  apiKey: string | undefined,
  payload: { postcode: string; area: { admin_district?: string; region?: string } | null; ofcom: OfcomBroadband | null },
): Promise<BroadbandRaw> {
  const fallback: BroadbandRaw = {
    downloadSpeed: "Up to 67 Mbps",
    uploadSpeed: "Up to 18 Mbps",
    connectionType: "Fibre to cabinet",
    suitableForRemoteWork: true,
    mobileSignal: "Good",
    commentary: "Typical UK broadband speeds in this area should support remote working, video calls and streaming. Confirm exact availability with providers before committing.",
    speedRating: "Good",
    source: payload.ofcom ? "Ofcom" : "Estimated",
    autoRedFlag: false,
  };
  if (!apiKey) return fallback;

  try {
    const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 0 });
    const ofcomBlock = payload.ofcom
      ? `Ofcom Connected Nations data:
- Max download speed: ${payload.ofcom.maxDownloadSpeed ?? "unknown"} Mbps
- Max upload speed: ${payload.ofcom.maxUploadSpeed ?? "unknown"} Mbps
- FTTP (full fibre) available: ${payload.ofcom.fttpAvailable ?? "unknown"}
- FTTC (fibre to cabinet) available: ${payload.ofcom.fttcAvailable ?? "unknown"}
- Ultrafast (300Mbps+) available: ${payload.ofcom.ultraFastAvailable ?? "unknown"}
- Mobile signal: ${payload.ofcom.mobileSignal ?? "unknown"}`
      : `No Ofcom coverage data was returned. Estimate typical speeds based on the area type (urban / suburban / rural) and what is normally available across the UK in similar areas in 2025.`;

    const prompt = `You are a UK property connectivity analyst. Postcode: ${payload.postcode}. Area: ${payload.area?.admin_district ?? "unknown"}, ${payload.area?.region ?? "unknown"}.

${ofcomBlock}

Return ONLY a single valid JSON object (no markdown, no code fences) of this exact shape:
{
  "downloadSpeed": string (e.g. "Up to 67 Mbps"),
  "uploadSpeed": string (e.g. "Up to 18 Mbps"),
  "connectionType": "Full fibre" | "Fibre to cabinet" | "ADSL" | "Limited",
  "suitableForRemoteWork": boolean (true if download is at least ~30 Mbps and upload at least ~5 Mbps),
  "mobileSignal": "Excellent" | "Good" | "Limited" | "Poor",
  "commentary": string (2 sentences: is this adequate for modern use, any concerns for remote workers / heavy users / smart-home devices),
  "speedRating": "Excellent" (300+ Mbps full fibre) | "Good" (80-299 Mbps) | "Average" (24-79 Mbps FTTC) | "Poor" (<24 Mbps ADSL or limited)
}`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 600,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<BroadbandRaw>;

    const connectionType =
      (["Full fibre", "Fibre to cabinet", "ADSL", "Limited"] as const).includes(parsed.connectionType as never)
        ? (parsed.connectionType as BroadbandRaw["connectionType"])
        : fallback.connectionType;
    const speedRating =
      (["Excellent", "Good", "Average", "Poor"] as const).includes(parsed.speedRating as never)
        ? (parsed.speedRating as BroadbandRaw["speedRating"])
        : (payload.ofcom ? ratingFromSpeed(payload.ofcom.maxDownloadSpeed ?? 0) : fallback.speedRating);
    const mobileSignal =
      (["Excellent", "Good", "Limited", "Poor"] as const).includes(parsed.mobileSignal as never)
        ? (parsed.mobileSignal as BroadbandRaw["mobileSignal"])
        : fallback.mobileSignal;

    const autoRedFlag = connectionType === "ADSL" || connectionType === "Limited" || speedRating === "Poor";

    return {
      downloadSpeed: typeof parsed.downloadSpeed === "string" ? parsed.downloadSpeed : fallback.downloadSpeed,
      uploadSpeed: typeof parsed.uploadSpeed === "string" ? parsed.uploadSpeed : fallback.uploadSpeed,
      connectionType,
      suitableForRemoteWork: typeof parsed.suitableForRemoteWork === "boolean" ? parsed.suitableForRemoteWork : speedRating !== "Poor",
      mobileSignal,
      commentary: typeof parsed.commentary === "string" && parsed.commentary.length > 10 ? parsed.commentary : fallback.commentary,
      speedRating,
      source: payload.ofcom ? "Ofcom" : "Estimated",
      autoRedFlag,
    };
  } catch (err) {
    console.error("[broadband] Claude commentary failed:", err);
    return fallback;
  }
}

async function fetchBroadband(
  postcode: string | null,
  apiKey: string | undefined,
): Promise<BroadbandRaw | null> {
  if (!postcode) return null;
  const cacheKey = `broadband:${postcode.toUpperCase().replace(/\s+/g, "")}`;

  // Cache lookup
  try {
    const { data: cached } = await supabaseAdmin
      .from("listing_cache")
      .select("text_content, fetched_at")
      .eq("url", cacheKey)
      .maybeSingle();
    if (
      cached?.text_content &&
      Date.now() - new Date(cached.fetched_at).getTime() < BROADBAND_TTL_MS
    ) {
      try {
        const parsed = JSON.parse(cached.text_content) as BroadbandRaw;
        console.log(`[broadband] cache hit for ${cacheKey}`);
        return parsed;
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.error("[broadband] cache lookup failed:", err);
  }

  const [ofcom, area] = await Promise.all([
    fetchOfcomBroadband(postcode),
    fetchPostcodeArea(postcode),
  ]);

  const raw = await generateBroadbandFromClaude(apiKey, { postcode, area, ofcom });

  try {
    await supabaseAdmin
      .from("listing_cache")
      .upsert(
        { url: cacheKey, text_content: JSON.stringify(raw), fetched_at: new Date().toISOString() },
        { onConflict: "url" },
      );
  } catch (err) {
    console.error("[broadband] cache upsert failed:", err);
  }

  console.log(`[broadband] ${cacheKey} → ${raw.connectionType} / ${raw.speedRating} (source=${raw.source})`);
  return raw;
}

// ---------------- Transport links (Claude geographic knowledge) ----------------
const TRANSPORT_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
type TransportRaw = {
  nearestStation: string;
  distanceToStation: string;
  journeyToNearestCity: string;
  nearestCity: string;
  busLinks: string;
  motorwayAccess: string;
  airportAccess: string;
  transportRating: "Excellent" | "Good" | "Average" | "Poor";
  commentary: string;
  parkingNotes?: string | null;
  unavailable?: boolean | null;
  autoRedFlag?: boolean | null;
};

async function fetchTransport(
  postcode: string | null,
  address: string,
  propertyType: string | null | undefined,
  apiKey: string | undefined,
): Promise<TransportRaw | null> {
  if (!postcode) return null;
  const cacheKey = `transport:${postcode.toUpperCase().replace(/\s+/g, "")}`;

  try {
    const { data: cached } = await supabaseAdmin
      .from("listing_cache")
      .select("text_content, fetched_at")
      .eq("url", cacheKey)
      .maybeSingle();
    if (
      cached?.text_content &&
      Date.now() - new Date(cached.fetched_at).getTime() < TRANSPORT_TTL_MS
    ) {
      try {
        const parsed = JSON.parse(cached.text_content) as TransportRaw;
        console.log(`[transport] cache hit for ${cacheKey}`);
        return parsed;
      } catch { /* ignore */ }
    }
  } catch (err) {
    console.error("[transport] cache lookup failed:", err);
  }

  if (!apiKey) {
    return {
      nearestStation: "Unknown",
      distanceToStation: "—",
      journeyToNearestCity: "—",
      nearestCity: "—",
      busLinks: "Unknown",
      motorwayAccess: "Unknown",
      airportAccess: "Unknown",
      transportRating: "Average",
      commentary: "Transport data is currently unavailable for this postcode.",
      unavailable: true,
    };
  }

  try {
    const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 0 });
    const prompt = `You are a UK transport and geography analyst. Assess transport connectivity for this property.

Address: ${address || "(unknown)"}
Postcode: ${postcode}
Property type: ${propertyType ?? "unknown"}

Base transport information on your training knowledge of UK geography, train lines, and road networks. Be accurate for well-known locations. For less familiar locations, be appropriately cautious and say "approximately" where uncertain.

Return ONLY a single valid JSON object (no markdown, no code fences) of this exact shape:
{
  "nearestStation": string (name of the nearest National Rail / tube / metro station),
  "distanceToStation": string (e.g. "0.4 miles" or "12 min walk"),
  "journeyToNearestCity": string (e.g. "approximately 22 minutes to Bristol Temple Meads by train"),
  "nearestCity": string (the major city this postcode commutes to),
  "busLinks": string (1 short sentence on bus connectivity — e.g. "Good — frequent services to town centre" or "Limited — hourly rural service"),
  "motorwayAccess": string (e.g. "M5 J19, approximately 4 miles" or "No motorway within 20 miles"),
  "airportAccess": string (e.g. "Bristol Airport approximately 35 minutes by car"),
  "transportRating": "Excellent" | "Good" | "Average" | "Poor",
  "commentary": string (2-3 sentences: overall transport connectivity assessment, who this suits — commuters, families, retirees — and any limitations),
  "parkingNotes": string | null (1 short sentence if relevant — on-street parking pressure, permit zones, off-street availability typical for the area; null if nothing meaningful to add)
}

Rating guide: Excellent = central city / direct fast trains to a major hub + frequent buses + motorway nearby. Good = decent train service + reasonable bus links OR strong road links. Average = workable but limited frequency / longer journeys. Poor = rural, no nearby station, infrequent buses, car-dependent.`;

    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }],
    });
    const text = message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<TransportRaw>;

    const ratings = ["Excellent", "Good", "Average", "Poor"] as const;
    const transportRating = (ratings as readonly string[]).includes(parsed.transportRating ?? "")
      ? (parsed.transportRating as TransportRaw["transportRating"])
      : "Average";

    const raw: TransportRaw = {
      nearestStation: typeof parsed.nearestStation === "string" ? parsed.nearestStation : "Unknown",
      distanceToStation: typeof parsed.distanceToStation === "string" ? parsed.distanceToStation : "—",
      journeyToNearestCity: typeof parsed.journeyToNearestCity === "string" ? parsed.journeyToNearestCity : "—",
      nearestCity: typeof parsed.nearestCity === "string" ? parsed.nearestCity : "—",
      busLinks: typeof parsed.busLinks === "string" ? parsed.busLinks : "Unknown",
      motorwayAccess: typeof parsed.motorwayAccess === "string" ? parsed.motorwayAccess : "Unknown",
      airportAccess: typeof parsed.airportAccess === "string" ? parsed.airportAccess : "Unknown",
      transportRating,
      commentary: typeof parsed.commentary === "string" ? parsed.commentary : "",
      parkingNotes: typeof parsed.parkingNotes === "string" && parsed.parkingNotes.length > 0 ? parsed.parkingNotes : null,
      autoRedFlag: transportRating === "Poor",
    };

    try {
      await supabaseAdmin
        .from("listing_cache")
        .upsert(
          { url: cacheKey, text_content: JSON.stringify(raw), fetched_at: new Date().toISOString() },
          { onConflict: "url" },
        );
    } catch (err) {
      console.error("[transport] cache upsert failed:", err);
    }

    console.log(`[transport] ${cacheKey} → ${raw.nearestStation} (${raw.transportRating})`);
    return raw;
  } catch (err) {
    console.error("[transport] Claude assessment failed:", err);
    return {
      nearestStation: "Unknown",
      distanceToStation: "—",
      journeyToNearestCity: "—",
      nearestCity: "—",
      busLinks: "Unknown",
      motorwayAccess: "Unknown",
      airportAccess: "Unknown",
      transportRating: "Average",
      commentary: "Transport data could not be generated for this postcode.",
      unavailable: true,
    };
  }
}
type FetchedListing = {
  text: string;
  landRegistry: LandRegistryResult;
  scotland: boolean;
  postcode: string | null;
  floodRisk: FloodRiskRaw | null;
  nearbySchools: NearbySchoolsRaw | null;
  crime: CrimeRaw | null;
  broadband: BroadbandRaw | null;
  transport: TransportRaw | null;
};

async function fetchListingText(url: string): Promise<FetchedListing> {
  // SSRF guard — only allow Rightmove/Zoopla URLs through.
  validateListingUrl(url);

  // 1. Cache lookup (24h TTL) — listing text only. Land Registry has its own
  // longer-lived cache keyed by postcode+paon.
  let cachedText: string | null = null;
  try {
    const { data: cached } = await supabaseAdmin
      .from("listing_cache")
      .select("text_content, fetched_at")
      .eq("url", url)
      .maybeSingle();
    if (
      cached &&
      cached.text_content &&
      Date.now() - new Date(cached.fetched_at).getTime() < CACHE_TTL_MS
    ) {
      console.log(`[analyseListing] cache hit for ${url}`);
      cachedText = cached.text_content;
    }
  } catch (err) {
    console.error("[analyseListing] cache lookup failed:", err);
  }

  // We need either cached text or fresh HTML to extract postcode for the
  // Land Registry / flood-risk calls.
  let html = "";
  if (!cachedText) {
    html = await basicFetchListingHtml(url);
  }
  const sourceForExtraction = cachedText ?? (html ? htmlToCleanText(html) : "");
  const { postcode, paon, saon, street } = extractAddressBits(sourceForExtraction);
  const scotland = isScottishPostcode(postcode);

  // Run external lookups in parallel with the rest of the work.
  const landRegistryPromise: Promise<LandRegistryResult> = Promise.resolve(null);

  const floodRiskPromise: Promise<FloodRiskRaw | null> = postcode
    ? fetchFloodRisk(postcode).catch((err) => {
        console.error("[floodRisk] lookup failed:", err);
        return null;
      })
    : Promise.resolve(null);

  const nearbySchoolsPromise: Promise<NearbySchoolsRaw | null> = postcode
    ? fetchNearbySchools(postcode, sourceForExtraction.slice(0, 200), process.env.ANTHROPIC_API_KEY).catch((err) => {
        console.error("[nearbySchools] lookup failed:", err);
        return null;
      })
    : Promise.resolve(null);

  const crimePromise: Promise<CrimeRaw | null> = postcode
    ? fetchCrimeStats(postcode, sourceForExtraction.slice(0, 200), process.env.ANTHROPIC_API_KEY).catch((err) => {
        console.error("[crime] lookup failed:", err);
        return null;
      })
    : Promise.resolve(null);

  const broadbandPromise: Promise<BroadbandRaw | null> = postcode
    ? fetchBroadband(postcode, process.env.ANTHROPIC_API_KEY).catch((err) => {
        console.error("[broadband] lookup failed:", err);
        return null;
      })
    : Promise.resolve(null);

  const transportPromise: Promise<TransportRaw | null> = postcode
    ? fetchTransport(postcode, sourceForExtraction.slice(0, 400), null, process.env.ANTHROPIC_API_KEY).catch((err) => {
        console.error("[transport] lookup failed:", err);
        return null;
      })
    : Promise.resolve(null);

  if (cachedText) {
    const [landRegistry, floodRisk, nearbySchools, crime, broadband, transport] = await Promise.all([
      landRegistryPromise,
      floodRiskPromise,
      nearbySchoolsPromise,
      crimePromise,
      broadbandPromise,
      transportPromise,
    ]);
    return { text: cachedText, landRegistry, scotland, postcode, floodRisk, nearbySchools, crime, broadband, transport };
  }

  const listed = html ? extractListedDate(html) : null;
  const { epc, councilTax } = html ? extractEpcAndCouncilTax(html) : { epc: null, councilTax: null };
  let text = html ? htmlToListingText(html) : "";
  const [landRegistry, floodRisk, nearbySchools, crime, broadband, transport] = await Promise.all([
    landRegistryPromise,
    floodRiskPromise,
    nearbySchoolsPromise,
    crimePromise,
    broadbandPromise,
    transportPromise,
  ]);

  const hasFloorPlan = html ? detectFloorPlan(html) : false;

  const notes: string[] = [];
  notes.push(`FLOOR PLAN PRESENT: ${hasFloorPlan ? "yes" : "unknown"}`);
  if (listed) {
    notes.push(`LISTING DATE: ${listed.dateStr} — ${listed.daysOnMarket} days on market as of today`);
    notes.push(`Date listed: ${listed.dateStr} (${listed.daysOnMarket} days on market)`);
  }
  if (epc) {
    notes.push(`EPC RATING EXTRACTED: ${epc}`);
    notes.push(`EXTRACTED FROM PAGE HTML — EPC rating: ${epc} (use this as epc.rating)`);
  } else if (councilTax) {
    notes.push(`NOTE: Council Tax Band ${councilTax} was found in the listing. EPC rating is often shown in the same section on Rightmove — check carefully and extract it if present.`);
  }
  if (councilTax) {
    notes.push(`EXTRACTED FROM PAGE HTML — Council Tax Band: ${councilTax}`);
  }
  // Price history removed — no Land Registry note injected.
  if (floodRisk && !floodRisk.scotland && !floodRisk.unavailable) {
    const lines: string[] = [
      `Rivers and sea: ${floodRisk.riversAndSea ?? "Unknown"}`,
      `Surface water: ${floodRisk.surfaceWater ?? "Unknown"}`,
      `Reservoir: ${floodRisk.reservoir == null ? "Unknown" : floodRisk.reservoir ? "Yes" : "No"}`,
      `Groundwater: ${floodRisk.groundwater ?? "Unknown"}`,
      `Overall (highest of rivers/surface/groundwater): ${floodRisk.overallRisk ?? "Unknown"}`,
    ];
    notes.push(`ENVIRONMENT AGENCY FLOOD RISK (official data — use these values verbatim in floodRisk and write a 2-3 sentence commentary; set autoRedFlag=true only if Rivers/Sea is High):\n${lines.join("\n")}`);
  }
  if (text && notes.length) {
    text = `${notes.join("\n")}\n\n${text}`.slice(0, 25_700);
  }

  // 3. Cache successful listing text.
  if (text && text.length >= 200) {
    try {
      await supabaseAdmin
        .from("listing_cache")
        .upsert(
          { url, text_content: text, fetched_at: new Date().toISOString() },
          { onConflict: "url" },
        );
    } catch (err) {
      console.error("[analyseListing] cache upsert failed:", err);
    }
  }

  return { text, landRegistry, scotland, postcode, floodRisk, nearbySchools, crime, broadband, transport };
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

  // 2. Authenticated session: Buyer Pass OR Single Report by email
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
            .select("email, expires_at")
            .ilike("email", email)
            .maybeSingle();
          if (row) {
            const expiresAt = (row as { expires_at: string | null }).expires_at;
            if (!expiresAt || new Date(expiresAt).getTime() > Date.now()) return true;
          }
          // Single Report tied to this email AND this specific listing URL.
          // Email alone is NOT enough — Single Report access is per-listing.
          if (opts.listingUrl) {
            const { data: sr } = await supabaseAdmin
              .from("single_report_tokens")
              .select("expires_at")
              .ilike("user_email", email)
              .eq("listing_url", opts.listingUrl)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            if (sr) {
              const exp = (sr as { expires_at: string }).expires_at;
              if (!exp || new Date(exp).getTime() > Date.now()) return true;
            }
            // Fallback: a saved analysis already exists for this exact listing
            // (covers cases where the token row was pruned but the report
            // remains in saved_analyses).
            const { data: saved } = await supabaseAdmin
              .from("saved_analyses")
              .select("id")
              .ilike("user_email", email)
              .eq("listing_url", opts.listingUrl)
              .limit(1)
              .maybeSingle();
            if (saved) return true;
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  return false;
}

// Free tier: keep real costs and negotiation values so the UI can render them
// behind a visual blur/lock overlay. Only strip the truly premium narrative
// content (extra red flags, viewing questions, comparables) that has no
// "shape" to obscure visually.
function toPreview(a: AnalysisResult): AnalysisResult {
  return {
    ...a,
    redFlags: Array.isArray(a?.redFlags) ? a.redFlags.slice(0, 2) : [],
    viewingQuestions: [],
    comparables: [],
    nearbySchools: null,
    crime: null,
    broadband: null,
    transport: null,
    renovationCosts: null,
  };
}

// In-memory dedupe for concurrent analyses of the same URL.
// - inflight: pending promise for an in-progress analysis (same isolate)
// - recent: completed result kept for 60s so a second tab opening the same
//   URL returns immediately instead of re-running Claude.
type FullAnalysis = AnalysisResult;
const inflightAnalyses = new Map<string, Promise<FullAnalysis>>();
const recentAnalyses = new Map<string, { at: number; full: FullAnalysis }>();
const ANALYSIS_DEDUPE_TTL_MS = 60_000;

async function runAnalysis(
  url: string,
  pastedText: string,
  apiKey: string,
  overrides?: { userEpc?: string | null; userSqft?: number | null },
): Promise<FullAnalysis> {
  let listingContent = pastedText;
  let landRegistry: LandRegistryResult = null;
  let scotland = false;
  let floodRiskRaw: FloodRiskRaw | null = null;
  let nearbySchoolsRaw: NearbySchoolsRaw | null = null;
  let crimeRaw: CrimeRaw | null = null;
  let broadbandRaw: BroadbandRaw | null = null;
  let transportRaw: TransportRaw | null = null;
  if (!listingContent && url) {
    console.log(`[runAnalysis] Fetching listing content for ${url}...`);
    const fetched = await fetchListingText(url);
    listingContent = fetched.text;
    landRegistry = fetched.landRegistry;
    scotland = fetched.scotland;
    floodRiskRaw = fetched.floodRisk;
    nearbySchoolsRaw = fetched.nearbySchools;
    crimeRaw = fetched.crime;
    broadbandRaw = fetched.broadband;
    transportRaw = fetched.transport;
    console.log(`[runAnalysis] Listing content fetched, length: ${listingContent?.length ?? 0}`);
  }
  if (!listingContent || listingContent.length < 100) {
    throw new Error(
      "FETCH_BLOCKED: We couldn't automatically read this listing. You can paste the listing description below to get your full analysis."
    );
  }

  // Prepend user-confirmed EPC/sqft as authoritative facts so Claude treats
  // them like values explicitly stated in the listing text.
  const overrideNotes: string[] = [];
  if (overrides?.userEpc) {
    overrideNotes.push(
      `EPC RATING EXTRACTED: ${overrides.userEpc.toUpperCase()}`,
      `USER-CONFIRMED EPC RATING: ${overrides.userEpc.toUpperCase()} (treat as explicitly stated in the listing; use as epc.rating)`,
    );
  }
  if (overrides?.userSqft && overrides.userSqft > 0) {
    overrideNotes.push(
      `USER-CONFIRMED SQUARE FOOTAGE: ${overrides.userSqft} sq ft (treat as EXPLICITLY stated in the listing; use as property.sqft and compute metrics.pricePerSqFt from it; do NOT output the "Square footage is typically shown..." placeholder sentence — calculate £/sqft normally)`,
    );
  }
  if (overrideNotes.length) {
    listingContent = `${overrideNotes.join("\n")}\n\n${listingContent}`;
  }

  let output: z.infer<typeof analysisSchema>;
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 1 });
  const userContent = `Listing URL: ${url || "(pasted text only)"}\n\nListing content:\n${listingContent}`;

  const cleanResponse = (raw: string) =>
    raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

  const tryRepairJson = (text: string): string => {
    // Strip trailing incomplete content after the last complete field.
    let s = text;
    // Drop a trailing partial token like `, "key": "abc` or `, "key":`
    const lastComma = s.lastIndexOf(",");
    const lastBrace = s.lastIndexOf("}");
    if (lastBrace < lastComma) {
      s = s.slice(0, lastComma);
    }
    // Balance braces and brackets
    let curly = 0;
    let square = 0;
    let inStr = false;
    let esc = false;
    for (const ch of s) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === "{") curly++;
      else if (ch === "}") curly--;
      else if (ch === "[") square++;
      else if (ch === "]") square--;
    }
    if (inStr) s += '"';
    while (square-- > 0) s += "]";
    while (curly-- > 0) s += "}";
    return s;
  };

  const callClaude = async (system: string, maxTokens: number) => {
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userContent }],
    });
    return message.content[0].type === "text" ? message.content[0].text : "";
  };

  const parseWithRepair = (raw: string) => {
    const cleaned = cleanResponse(raw);
    const endsClean = cleaned.endsWith("}") || cleaned.endsWith("}}");
    if (!endsClean) {
      console.warn(
        "[analyseListing] Claude response appears truncated; attempting JSON repair."
      );
      const repaired = tryRepairJson(cleaned);
      return JSON.parse(repaired);
    }
    try {
      return JSON.parse(cleaned);
    } catch (e) {
      console.warn("[analyseListing] JSON.parse failed; attempting repair.", e);
      return JSON.parse(tryRepairJson(cleaned));
    }
  };

  try {
    let parsed: unknown;
    try {
      console.log("[runAnalysis] Calling Claude API...");
      const responseText = await callClaude(SYSTEM_PROMPT, 6000);
      console.log(`[runAnalysis] Claude response received, length: ${responseText.length}`);
      console.log("[runAnalysis] Parsing JSON response...");
      parsed = parseWithRepair(responseText);
    } catch (primaryErr) {
      console.error(
        "[runAnalysis] Primary analysis parse failed, retrying with simplified schema (no renovationCosts).",
        primaryErr
      );
      const simplifiedPrompt =
        SYSTEM_PROMPT +
        "\n\nIMPORTANT OVERRIDE: Omit the renovationCosts field entirely from your JSON response to keep it compact. Set it to null.";
      console.log("[runAnalysis] Calling Claude API (fallback)...");
      const fallbackText = await callClaude(simplifiedPrompt, 6000);
      console.log(`[runAnalysis] Claude fallback response received, length: ${fallbackText.length}`);
      console.log("[runAnalysis] Parsing fallback JSON response...");
      const fallbackParsed = parseWithRepair(fallbackText) as Record<string, unknown>;
      fallbackParsed.renovationCosts = null;
      parsed = fallbackParsed;
    }
    output = analysisSchema.parse(parsed);
  } catch (err: unknown) {
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
    },
  } as AnalysisResult;

  // Price history removed entirely — never set on the result.
  full.priceHistory = null;

  if (floodRiskRaw) {
    if (floodRiskRaw.scotland) {
      full.floodRisk = {
        riversAndSea: null,
        surfaceWater: null,
        reservoir: null,
        groundwater: null,
        overallRisk: null,
        commentary: "",
        autoRedFlag: false,
        scotland: true,
      };
    } else if (floodRiskRaw.unavailable) {
      full.floodRisk = {
        riversAndSea: null,
        surfaceWater: null,
        reservoir: null,
        groundwater: null,
        overallRisk: null,
        commentary: "",
        autoRedFlag: false,
        unavailable: true,
      };
    } else {
      const aiFlood = full.floodRisk;
      const overall = floodRiskRaw.overallRisk;
      const isHighRivers = (floodRiskRaw.riversAndSea ?? "").toLowerCase() === "high";
      full.floodRisk = {
        riversAndSea: floodRiskRaw.riversAndSea,
        surfaceWater: floodRiskRaw.surfaceWater,
        reservoir: floodRiskRaw.reservoir,
        groundwater: floodRiskRaw.groundwater,
        overallRisk: overall,
        commentary: aiFlood?.commentary ?? "",
        autoRedFlag: isHighRivers,
      };
      if (isHighRivers) {
        const title = "High flood risk — insurance and mortgage implications";
        if (!full.redFlags.some((f) => f.title === title)) {
          full.redFlags = [
            {
              severity: "high",
              title,
              detail:
                "This property is in a High flood risk zone according to the Environment Agency. Buildings insurance may be significantly more expensive, refused, or subject to exclusions. Some mortgage lenders require flood resilience measures as a condition of lending. Check the Flood Re scheme eligibility and get a specialist flood insurance quote before proceeding.",
            },
            ...full.redFlags,
          ];
        }
      }
    }
  } else {
    full.floodRisk = null;
  }

  if (nearbySchoolsRaw) {
    full.nearbySchools = {
      schools: nearbySchoolsRaw.schools,
      unavailable: nearbySchoolsRaw.unavailable ?? false,
      aiSourced: nearbySchoolsRaw.aiSourced ?? false,
    };
  } else {
    full.nearbySchools = null;
  }

  if (crimeRaw) {
    full.crime = {
      totalCrimes: crimeRaw.totalCrimes,
      month: crimeRaw.month,
      topCategories: crimeRaw.topCategories,
      riskLevel: crimeRaw.riskLevel,
      commentary: crimeRaw.commentary,
      autoRedFlag: crimeRaw.autoRedFlag,
      coordinates: crimeRaw.coordinates,
      unavailable: crimeRaw.unavailable ?? false,
    };
    if (crimeRaw.autoRedFlag && !crimeRaw.unavailable) {
      const title = "High crime rate in this area";
      if (!full.redFlags.some((f) => f.title === title)) {
        full.redFlags = [
          {
            severity: "high",
            title,
            detail: `Police data shows ${crimeRaw.totalCrimes} recorded crimes near this property in ${formatCrimeMonthLabel(crimeRaw.month)}, significantly above typical UK residential levels. Check insurance implications and consider security measures in your budget.`,
          },
          ...full.redFlags,
        ];
      }
    }
  } else {
    full.crime = null;
  }

  if (broadbandRaw) {
    full.broadband = {
      downloadSpeed: broadbandRaw.downloadSpeed,
      uploadSpeed: broadbandRaw.uploadSpeed,
      connectionType: broadbandRaw.connectionType,
      suitableForRemoteWork: broadbandRaw.suitableForRemoteWork,
      mobileSignal: broadbandRaw.mobileSignal,
      commentary: broadbandRaw.commentary,
      speedRating: broadbandRaw.speedRating,
      source: broadbandRaw.source,
      unavailable: broadbandRaw.unavailable ?? false,
      autoRedFlag: broadbandRaw.autoRedFlag ?? false,
    };
    if (broadbandRaw.autoRedFlag && !broadbandRaw.unavailable) {
      const title = "Poor broadband connectivity";
      if (!full.redFlags.some((f) => f.title === title)) {
        full.redFlags = [
          ...full.redFlags,
          {
            severity: "medium",
            title,
            detail: "This postcode has limited broadband speeds which may affect remote working, streaming, and smart home devices. Check with providers before committing.",
          },
        ];
      }
    }
  } else {
    full.broadband = null;
  }

  if (transportRaw) {
    full.transport = {
      nearestStation: transportRaw.nearestStation,
      distanceToStation: transportRaw.distanceToStation,
      journeyToNearestCity: transportRaw.journeyToNearestCity,
      nearestCity: transportRaw.nearestCity,
      busLinks: transportRaw.busLinks,
      motorwayAccess: transportRaw.motorwayAccess,
      airportAccess: transportRaw.airportAccess,
      transportRating: transportRaw.transportRating,
      commentary: transportRaw.commentary,
      parkingNotes: transportRaw.parkingNotes ?? null,
      unavailable: transportRaw.unavailable ?? false,
      autoRedFlag: transportRaw.autoRedFlag ?? false,
    };
    if (transportRaw.autoRedFlag && !transportRaw.unavailable) {
      const title = "Limited transport links";
      if (!full.redFlags.some((f) => f.title === title)) {
        full.redFlags = [
          ...full.redFlags,
          {
            severity: "low",
            title,
            detail: "This property has limited public transport connections. Factor in car dependency costs and check local bus/train services before committing.",
          },
        ];
      }
    }
  } else {
    full.transport = null;
  }

  // Planning reference auto red flag — only for Change of Use, retrospective, enforcement or breach
  const pr = full.planningReference;
  if (pr && pr.found) {
    const relatesLower = (pr.relatesTo ?? "").toLowerCase();
    const isChangeOfUse = pr.applicationType === "Change of Use";
    const isRetro =
      relatesLower.includes("retrospective") ||
      relatesLower.includes("enforcement") ||
      relatesLower.includes("breach");
    if (isChangeOfUse || isRetro) {
      const title = isRetro
        ? "Retrospective or enforcement planning history"
        : "Change of use planning permission on this property";
      if (!full.redFlags.some((f) => f.title === title)) {
        full.redFlags = [
          ...full.redFlags,
          {
            severity: "medium",
            title,
            detail: isRetro
              ? `Planning reference ${pr.reference ?? ""} is described as retrospective or relates to an enforcement/breach matter. Ask the seller's solicitor for the full planning history, decision notice and any enforcement correspondence before proceeding.`
              : `Planning reference ${pr.reference ?? ""} is a Change of Use application. Confirm the lawful planning use class for the property and obtain the decision notice plus any conditions before exchange.`,
          },
        ];
      }
    }
  }

  return full;
}

export const analyseListing = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      url: z.string().max(2000).optional(),
      text: z.string().max(50000).optional(),
      accessToken: z.string().max(200).optional().nullable(),
      sessionJwt: z.string().max(4000).optional().nullable(),
      userEpc: z.string().regex(/^[A-Ga-g]$/).optional().nullable(),
      userSqft: z.number().min(50).max(50000).optional().nullable(),
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

    if (url) {
      try {
        validateListingUrl(url);
      } catch (e) {
        throw e instanceof Error ? e : new Error("INVALID_URL: Unsupported URL.");
      }
    }

    const overrides = {
      userEpc: data.userEpc ?? null,
      userSqft: data.userSqft ?? null,
    };
    const hasOverrides = Boolean(overrides.userEpc || overrides.userSqft);

    // Dedupe concurrent / rapid-repeat analyses for the same URL.
    // Pasted-text submissions skip the cache (content varies per call).
    // Override submissions also skip — different users may pass different values.
    let full: FullAnalysis;
    if (url && !pastedText && !hasOverrides) {
      const cached = recentAnalyses.get(url);
      if (cached && Date.now() - cached.at < ANALYSIS_DEDUPE_TTL_MS) {
        console.log("[analyseListing] returning cached result", { url, ageMs: Date.now() - cached.at });
        full = cached.full;
      } else {
        const existing = inflightAnalyses.get(url);
        if (existing) {
          console.log("[analyseListing] joining in-flight analysis", { url });
          full = await existing;
        } else {
          const promise = runAnalysis(url, pastedText, apiKey)
            .then((result) => {
              recentAnalyses.set(url, { at: Date.now(), full: result });
              return result;
            })
            .finally(() => {
              inflightAnalyses.delete(url);
            });
          inflightAnalyses.set(url, promise);
          full = await promise;
        }
      }
    } else {
      full = await runAnalysis(url, pastedText, apiKey, overrides);
    }

    const unlocked = await hasFullAccess({
      accessToken: data.accessToken ?? null,
      sessionJwt: data.sessionJwt ?? null,
      listingUrl: url || null,
    });

    return unlocked ? full : toPreview(full);
  });

// =====================================================================
// Async job pipeline
//
// The synchronous analyseListing path can take 30–90s end-to-end, which
// exceeds the Cloudflare Worker request budget on heavier listings. The
// pattern below splits the work in two:
//
//   1. startAnalysisJob — inserts a `pending` row, schedules the long
//      analysis via ctx.waitUntil so it survives past the response,
//      and returns the job id within ~1s.
//   2. getAnalysisJob  — polled by the client every 2s; returns the
//      current status + result once `complete`.
//
// Gating (preview vs full) is applied at READ time in getAnalysisJob, so
// the stored result_json is always the full analysis.
// =====================================================================

async function processAnalysisJob(
  jobId: string,
  url: string,
  pastedText: string,
  overrides?: { userEpc?: string | null; userSqft?: number | null },
): Promise<void> {
  console.log(`[processAnalysisJob] started for jobId: ${jobId}`);
  let step = "init";
  try {
    step = "read-api-key";
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Analysis service is temporarily unavailable. Please try again shortly.");
    }
    const hasOverrides = Boolean(overrides?.userEpc || overrides?.userSqft);
    let full: FullAnalysis;
    if (url && !pastedText && !hasOverrides) {
      const cached = recentAnalyses.get(url);
      if (cached && Date.now() - cached.at < ANALYSIS_DEDUPE_TTL_MS) {
        console.log(`[processAnalysisJob] using cached analysis for ${url}`);
        full = cached.full;
      } else {
        const existing = inflightAnalyses.get(url);
        if (existing) {
          console.log(`[processAnalysisJob] joining in-flight analysis for ${url}`);
          full = await existing;
        } else {
          step = "run-analysis";
          const promise = runAnalysis(url, pastedText, apiKey)
            .then((result) => {
              recentAnalyses.set(url, { at: Date.now(), full: result });
              return result;
            })
            .finally(() => {
              inflightAnalyses.delete(url);
            });
          inflightAnalyses.set(url, promise);
          full = await promise;
        }
      }
    } else {
      step = "run-analysis";
      full = await runAnalysis(url, pastedText, apiKey, overrides);
    }

    step = "update-job-row";
    console.log(`[processAnalysisJob] Analysis complete, updating job row ${jobId}...`);
    const { error: updateError } = await supabaseAdmin
      .from("analysis_jobs")
      .update({
        status: "complete",
        result_json: JSON.parse(JSON.stringify(full)),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (updateError) {
      throw new Error(`DB update failed: ${updateError.message}`);
    }
    console.log(`[processAnalysisJob] job ${jobId} marked complete`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    console.error(`[processAnalysisJob] Error at ${step} for jobId ${jobId}: ${message}`, err);
    try {
      await supabaseAdmin
        .from("analysis_jobs")
        .update({
          status: "error",
          error: `[${step}] ${message}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
    } catch (updateErr) {
      console.error(`[processAnalysisJob] failed to record error for jobId ${jobId}`, updateErr);
    }
  }
}

export const startAnalysisJob = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      url: z.string().max(2000).optional(),
      text: z.string().max(50000).optional(),
      accessToken: z.string().max(200).optional().nullable(),
      sessionJwt: z.string().max(4000).optional().nullable(),
      userEpc: z.string().regex(/^[A-Ga-g]$/).optional().nullable(),
      userSqft: z.number().min(50).max(50000).optional().nullable(),
    })
  )
  .handler(async ({ data }): Promise<{ jobId: string }> => {
    const url = data.url?.trim() ?? "";
    const pastedText = data.text?.trim() ?? "";
    if (!url && !pastedText) throw new Error("Provide a listing URL or pasted text");
    const overrides = {
      userEpc: data.userEpc ?? null,
      userSqft: data.userSqft ?? null,
    };

    if (url) {
      try {
        validateListingUrl(url);
      } catch (e) {
        throw e instanceof Error ? e : new Error("INVALID_URL: Unsupported URL.");
      }
    }

    const { data: row, error } = await supabaseAdmin
      .from("analysis_jobs")
      .insert({
        url: url || "(pasted text)",
        pasted_text: pastedText || null,
        access_token: data.accessToken ?? null,
        session_jwt: data.sessionJwt ?? null,
        status: "pending",
      })
      .select("id")
      .single();

    if (error || !row) {
      console.error("[startAnalysisJob] insert failed", error);
      throw new Error("Failed to start analysis. Please try again.");
    }

    const jobId = row.id as string;
    console.log(`[startAnalysisJob] scheduled jobId:`, jobId);

    // Fire-and-forget: dispatch the Edge Function invoke + fallback to
    // background work via scheduleBackground (Cloudflare waitUntil) so the
    // client gets the jobId immediately and can begin polling. Awaiting the
    // invoke here previously meant a slow/cancelled client request could
    // discard the jobId before it was returned, even though the job row
    // already existed server-side.
    scheduleBackground((async () => {
      let invokeFailed = false;
      let invokeErrorMessage = "";
      try {
        const result = await supabaseAdmin.functions.invoke("analyse-listing", {
          body: { jobId, url, pastedText, userEpc: overrides.userEpc, userSqft: overrides.userSqft },
        });
        console.log(`[startAnalysisJob:bg] invoke result`, JSON.stringify({
          hasData: !!result.data,
          error: result.error ? String(result.error?.message ?? result.error) : null,
        }));
        if (result.error) {
          invokeFailed = true;
          invokeErrorMessage = String(result.error?.message ?? result.error);
        }
      } catch (err) {
        invokeFailed = true;
        invokeErrorMessage = err instanceof Error ? err.message : String(err);
        console.error(`[startAnalysisJob:bg] invoke failed:`, invokeErrorMessage);
      }

      let needsFallback = invokeFailed;
      if (!invokeFailed) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const { data: statusRow } = await supabaseAdmin
            .from("analysis_jobs")
            .select("status")
            .eq("id", jobId)
            .maybeSingle();
          const currentStatus = (statusRow?.status as string | undefined) ?? "pending";
          if (currentStatus === "pending") {
            console.warn(`[startAnalysisJob:bg] Edge Function did not pick up ${jobId}; falling back`);
            needsFallback = true;
            invokeErrorMessage = invokeErrorMessage || "Edge Function did not start within 2s";
          }
        } catch (err) {
          console.error(`[startAnalysisJob:bg] post-invoke check failed:`, err);
          needsFallback = true;
          invokeErrorMessage = invokeErrorMessage || (err instanceof Error ? err.message : String(err));
        }
      }

      if (needsFallback) {
        console.warn(`[startAnalysisJob:bg] in-process fallback for ${jobId}`);
        try {
          await processAnalysisJob(jobId, url, pastedText, overrides);
        } catch (fallbackErr) {
          const msg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
          console.error(`[startAnalysisJob:bg] fallback failed for ${jobId}:`, msg);
          await supabaseAdmin
            .from("analysis_jobs")
            .update({
              status: "error",
              error: `Failed to start analysis: ${invokeErrorMessage}; fallback failed: ${msg}`,
              updated_at: new Date().toISOString(),
            })
            .eq("id", jobId);
        }
      }
    })());

    return { jobId };
  });

export const getAnalysisJob = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      jobId: z.string().uuid(),
      sessionJwt: z.string().max(4000).optional().nullable(),
    })
  )
  .handler(async ({ data }): Promise<{
    status: "pending" | "complete" | "error";
    analysis: AnalysisResult | null;
    error: string | null;
  }> => {
    const { data: row, error } = await supabaseAdmin
      .from("analysis_jobs")
      .select("status, result_json, error, url, access_token")
      .eq("id", data.jobId)
      .maybeSingle();

    if (error || !row) {
      return { status: "error", analysis: null, error: "Job not found." };
    }

    const status = (row.status as "pending" | "complete" | "error") ?? "pending";
    if (status !== "complete" || !row.result_json) {
      return { status, analysis: null, error: (row.error as string | null) ?? null };
    }

    const full = row.result_json as unknown as FullAnalysis;
    // Always derive the overall Roovr score from sub-scores so older
    // saved analyses (where Claude returned a flat 6.8) display correctly.
    const subAny = (full as unknown as { subScores?: Record<string, number> }).subScores;
    if (subAny) {
      const weights: Record<string, number> = {
        valueForMoney: 0.25,
        locationQuality: 0.20,
        riskLevel: 0.20,
        resalePotential: 0.15,
        listingTransparency: 0.10,
        marketTiming: 0.10,
      };
      let weightedSum = 0;
      let totalWeight = 0;
      for (const [k, w] of Object.entries(weights)) {
        const v = Number(subAny[k]);
        if (isFinite(v) && v > 0) { weightedSum += v * w; totalWeight += w; }
      }
      if (totalWeight > 0) {
        (full as unknown as { score: number }).score =
          Math.round((weightedSum / totalWeight) * 10) / 10;
      }
    }
    const unlocked = await hasFullAccess({
      accessToken: (row.access_token as string | null) ?? null,
      sessionJwt: data.sessionJwt ?? null,
      listingUrl: (row.url as string | null) ?? null,
    });

    return {
      status: "complete",
      analysis: unlocked ? full : toPreview(full),
      error: null,
    };
  });

// ---------------- Buyer Pass Extras (post-upgrade fetch) ----------------
// Fetches ONLY flood risk + nearby schools for an existing saved analysis,
// then patches the saved row. Does NOT re-run Claude — the rest of the
// report stays exactly as it was when first analysed.
export const fetchBuyerPassExtras = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().email().max(320),
      listingUrl: z.string().max(2000),
    }),
  )
  .handler(async ({ data }): Promise<{
    ok: boolean;
    floodRisk: AnalysisResult["floodRisk"] | null;
    nearbySchools: AnalysisResult["nearbySchools"] | null;
    crime: AnalysisResult["crime"] | null;
    broadband: AnalysisResult["broadband"] | null;
    transport: AnalysisResult["transport"] | null;
    error?: string;
  }> => {
    try {
      // 1. Verify caller has Buyer Pass.
      const { data: pass } = await supabaseAdmin
        .from("buyer_pass_users")
        .select("expires_at")
        .ilike("email", data.email)
        .maybeSingle();
      const valid =
        pass && pass.expires_at && new Date(pass.expires_at as string).getTime() > Date.now();
      if (!valid) {
        return { ok: false, floodRisk: null, nearbySchools: null, crime: null, broadband: null, transport: null, error: "Buyer Pass required" };
      }

      // 2. Load existing saved analysis row (most recent for this user+listing).
      const { data: rows } = await supabaseAdmin
        .from("saved_analyses")
        .select("id, analysis_json, created_at")
        .ilike("user_email", data.email)
        .eq("listing_url", data.listingUrl)
        .order("created_at", { ascending: false })
        .limit(1);
      const row = rows?.[0];
      if (!row) {
        return { ok: false, floodRisk: null, nearbySchools: null, crime: null, broadband: null, transport: null, error: "No saved analysis" };
      }
      const analysis = (row.analysis_json as AnalysisResult) ?? null;
      if (!analysis) {
        return { ok: false, floodRisk: null, nearbySchools: null, crime: null, broadband: null, transport: null, error: "Empty analysis" };
      }

      // 3. Extract postcode from saved address.
      const postcode =
        extractPostcode(analysis.property?.address ?? "") ??
        extractPostcode((analysis as any)?.property?.listingUrl ?? "");

      // 4. Fetch flood + schools + crime + broadband + transport in parallel (cached).
      const [floodRaw, schoolsRaw, crimeRawResult, broadbandRawResult, transportRawResult] = await Promise.all([
        fetchFloodRisk(postcode).catch((err) => {
          console.error("[fetchBuyerPassExtras] flood failed:", err);
          return null;
        }),
        fetchNearbySchools(postcode, analysis.property?.address ?? "", process.env.ANTHROPIC_API_KEY).catch((err) => {
          console.error("[fetchBuyerPassExtras] schools failed:", err);
          return null;
        }),
        fetchCrimeStats(postcode, analysis.property?.address ?? "", process.env.ANTHROPIC_API_KEY).catch((err) => {
          console.error("[fetchBuyerPassExtras] crime failed:", err);
          return null;
        }),
        fetchBroadband(postcode, process.env.ANTHROPIC_API_KEY).catch((err) => {
          console.error("[fetchBuyerPassExtras] broadband failed:", err);
          return null;
        }),
        fetchTransport(
          postcode,
          analysis.property?.address ?? "",
          analysis.property?.type ?? null,
          process.env.ANTHROPIC_API_KEY,
        ).catch((err) => {
          console.error("[fetchBuyerPassExtras] transport failed:", err);
          return null;
        }),
      ]);

      // 5. Build the AnalysisResult-shaped objects.
      const floodRisk: AnalysisResult["floodRisk"] = floodRaw
        ? {
            riversAndSea: floodRaw.riversAndSea,
            surfaceWater: floodRaw.surfaceWater,
            reservoir: floodRaw.reservoir,
            groundwater: floodRaw.groundwater,
            overallRisk: floodRaw.overallRisk,
            commentary:
              floodRaw.unavailable
                ? "Flood risk data is currently unavailable for this postcode. Try the Environment Agency long-term flood risk service directly."
                : floodRaw.scotland
                  ? "Environment Agency flood data covers England only. For Scotland use SEPA's flood maps."
                  : floodRaw.overallRisk === "High"
                    ? "Overall flood risk is High. Some insurers refuse cover or charge 3-5x standard premiums, and lenders may require flood-resilience measures. Get an insurance quote and a flood-history search before exchange."
                    : floodRaw.overallRisk === "Medium"
                      ? "Overall flood risk is Medium. Insurance is normally available but premiums may be higher than average. Confirm cover and excess before exchange."
                      : "Overall flood risk is low. Standard buildings insurance should be readily available.",
            autoRedFlag: floodRaw.overallRisk === "High",
            scotland: floodRaw.scotland ?? null,
            unavailable: floodRaw.unavailable ?? null,
          }
        : null;

      const nearbySchools: AnalysisResult["nearbySchools"] = schoolsRaw
        ? {
            schools: schoolsRaw.schools ?? [],
            unavailable: schoolsRaw.unavailable ?? null,
            aiSourced: schoolsRaw.aiSourced ?? null,
          }
        : null;

      const crime: AnalysisResult["crime"] = crimeRawResult
        ? {
            totalCrimes: crimeRawResult.totalCrimes,
            month: crimeRawResult.month,
            topCategories: crimeRawResult.topCategories,
            riskLevel: crimeRawResult.riskLevel,
            commentary: crimeRawResult.commentary,
            autoRedFlag: crimeRawResult.autoRedFlag,
            coordinates: crimeRawResult.coordinates,
            unavailable: crimeRawResult.unavailable ?? null,
          }
        : null;

      const broadband: AnalysisResult["broadband"] = broadbandRawResult
        ? {
            downloadSpeed: broadbandRawResult.downloadSpeed,
            uploadSpeed: broadbandRawResult.uploadSpeed,
            connectionType: broadbandRawResult.connectionType,
            suitableForRemoteWork: broadbandRawResult.suitableForRemoteWork,
            mobileSignal: broadbandRawResult.mobileSignal,
            commentary: broadbandRawResult.commentary,
            speedRating: broadbandRawResult.speedRating,
            source: broadbandRawResult.source,
            unavailable: broadbandRawResult.unavailable ?? null,
            autoRedFlag: broadbandRawResult.autoRedFlag ?? null,
          }
        : null;

      const transport: AnalysisResult["transport"] = transportRawResult
        ? {
            nearestStation: transportRawResult.nearestStation,
            distanceToStation: transportRawResult.distanceToStation,
            journeyToNearestCity: transportRawResult.journeyToNearestCity,
            nearestCity: transportRawResult.nearestCity,
            busLinks: transportRawResult.busLinks,
            motorwayAccess: transportRawResult.motorwayAccess,
            airportAccess: transportRawResult.airportAccess,
            transportRating: transportRawResult.transportRating,
            commentary: transportRawResult.commentary,
            parkingNotes: transportRawResult.parkingNotes ?? null,
            unavailable: transportRawResult.unavailable ?? null,
            autoRedFlag: transportRawResult.autoRedFlag ?? null,
          }
        : null;

      // 6. Patch the saved analysis row (admin client bypasses RLS).
      const merged: AnalysisResult = { ...analysis, floodRisk, nearbySchools, crime, broadband, transport };
      try {
        await supabaseAdmin
          .from("saved_analyses")
          .update({ analysis_json: merged as any })
          .eq("id", row.id as string);
      } catch (err) {
        console.error("[fetchBuyerPassExtras] update failed:", err);
      }

      return { ok: true, floodRisk, nearbySchools, crime, broadband, transport };
    } catch (err) {
      console.error("[fetchBuyerPassExtras] failed:", err);
      return {
        ok: false,
        floodRisk: null,
        nearbySchools: null,
        crime: null,
        broadband: null,
        transport: null,
        error: (err as Error).message ?? "Unknown error",
      };
    }
  });

// ---------------- Manual postcode refetch ----------------
// When a listing only yields a partial postcode (e.g. "BA1"), the user can
// supply the full postcode from the results page. We re-run the four
// postcode-driven datasets (flood, schools, crime, broadband) with the
// supplied postcode and patch the saved_analyses row so the values persist
// across reloads. Works for any paying user (single or buyer pass) — gating
// on the section UI itself prevents free users from triggering this.
export const refetchLocalDataForPostcode = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      email: z.string().email().max(320),
      listingUrl: z.string().max(2000),
      postcode: z
        .string()
        .min(5)
        .max(10)
        .regex(/^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/i, "Enter a full UK postcode"),
    }),
  )
  .handler(async ({ data }): Promise<{
    ok: boolean;
    floodRisk: AnalysisResult["floodRisk"] | null;
    nearbySchools: AnalysisResult["nearbySchools"] | null;
    crime: AnalysisResult["crime"] | null;
    broadband: AnalysisResult["broadband"] | null;
    error?: string;
  }> => {
    const fail = (error: string) => ({
      ok: false,
      floodRisk: null,
      nearbySchools: null,
      crime: null,
      broadband: null,
      error,
    });
    try {
      const raw = data.postcode.replace(/\s+/g, "").toUpperCase();
      const postcode = `${raw.slice(0, -3)} ${raw.slice(-3)}`;

      const { data: rows } = await supabaseAdmin
        .from("saved_analyses")
        .select("id, analysis_json, created_at")
        .ilike("user_email", data.email)
        .eq("listing_url", data.listingUrl)
        .order("created_at", { ascending: false })
        .limit(1);
      const row = rows?.[0];
      if (!row) return fail("No saved analysis");
      const existing = (row.analysis_json as AnalysisResult) ?? null;
      if (!existing) return fail("Empty analysis");

      const apiKey = process.env.ANTHROPIC_API_KEY;
      const [floodRaw, schoolsRaw, crimeRawResult, broadbandRawResult] = await Promise.all([
        fetchFloodRisk(postcode).catch((err) => {
          console.error("[refetchLocalDataForPostcode] flood failed:", err);
          return null;
        }),
        fetchNearbySchools(postcode, existing.property?.address ?? "", apiKey).catch((err) => {
          console.error("[refetchLocalDataForPostcode] schools failed:", err);
          return null;
        }),
        fetchCrimeStats(postcode, existing.property?.address ?? "", apiKey).catch((err) => {
          console.error("[refetchLocalDataForPostcode] crime failed:", err);
          return null;
        }),
        fetchBroadband(postcode, apiKey).catch((err) => {
          console.error("[refetchLocalDataForPostcode] broadband failed:", err);
          return null;
        }),
      ]);

      const floodRisk: AnalysisResult["floodRisk"] = floodRaw
        ? {
            riversAndSea: floodRaw.riversAndSea,
            surfaceWater: floodRaw.surfaceWater,
            reservoir: floodRaw.reservoir,
            groundwater: floodRaw.groundwater,
            overallRisk: floodRaw.overallRisk,
            commentary: floodRaw.unavailable
              ? "Flood risk data is currently unavailable for this postcode."
              : floodRaw.scotland
                ? "Environment Agency flood data covers England only. For Scotland use SEPA's flood maps."
                : floodRaw.overallRisk === "High"
                  ? "Overall flood risk is High. Some insurers refuse cover or charge 3-5x standard premiums."
                  : floodRaw.overallRisk === "Medium"
                    ? "Overall flood risk is Medium. Insurance is normally available but premiums may be higher than average."
                    : "Overall flood risk is low. Standard buildings insurance should be readily available.",
            autoRedFlag: floodRaw.overallRisk === "High",
            scotland: floodRaw.scotland ?? null,
            unavailable: floodRaw.unavailable ?? null,
          }
        : null;

      const nearbySchools: AnalysisResult["nearbySchools"] = schoolsRaw
        ? {
            schools: schoolsRaw.schools ?? [],
            unavailable: schoolsRaw.unavailable ?? null,
            aiSourced: schoolsRaw.aiSourced ?? null,
          }
        : null;

      const crime: AnalysisResult["crime"] = crimeRawResult
        ? {
            totalCrimes: crimeRawResult.totalCrimes,
            month: crimeRawResult.month,
            topCategories: crimeRawResult.topCategories,
            riskLevel: crimeRawResult.riskLevel,
            commentary: crimeRawResult.commentary,
            autoRedFlag: crimeRawResult.autoRedFlag,
            coordinates: crimeRawResult.coordinates,
            unavailable: crimeRawResult.unavailable ?? null,
          }
        : null;

      const broadband: AnalysisResult["broadband"] = broadbandRawResult
        ? {
            downloadSpeed: broadbandRawResult.downloadSpeed,
            uploadSpeed: broadbandRawResult.uploadSpeed,
            connectionType: broadbandRawResult.connectionType,
            suitableForRemoteWork: broadbandRawResult.suitableForRemoteWork,
            mobileSignal: broadbandRawResult.mobileSignal,
            commentary: broadbandRawResult.commentary,
            speedRating: broadbandRawResult.speedRating,
            source: broadbandRawResult.source,
            unavailable: broadbandRawResult.unavailable ?? null,
            autoRedFlag: broadbandRawResult.autoRedFlag ?? null,
          }
        : null;

      const merged: AnalysisResult = {
        ...existing,
        floodRisk: floodRisk ?? existing.floodRisk,
        nearbySchools: nearbySchools ?? existing.nearbySchools,
        crime: crime ?? existing.crime,
        broadband: broadband ?? existing.broadband,
        partialPostcode: null,
      };
      try {
        await supabaseAdmin
          .from("saved_analyses")
          .update({ analysis_json: merged as any })
          .eq("id", row.id as string);
      } catch (err) {
        console.error("[refetchLocalDataForPostcode] update failed:", err);
      }

      return { ok: true, floodRisk, nearbySchools, crime, broadband };
    } catch (err) {
      console.error("[refetchLocalDataForPostcode] failed:", err);
      return fail((err as Error).message ?? "Unknown error");
    }
  });
// Generates an EPC commentary for a user-entered band when the listing
// didn't show one. Optionally patches the saved_analyses row so the EPC
// data persists for paying users without re-running the main analysis.
const epcSchema = z.object({
  rating: z.string(),
  estimatedAnnualCost: z.string().nullable(),
  commentary: z.string(),
  potentialRating: z.string().nullable().optional(),
  score: z.number().nullable().optional(),
  estimatedAnnualEnergyCost: z.string().nullable().optional(),
});

export const analyseEpcRating = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      epcRating: z.string().regex(/^[A-Ga-g]$/),
      propertyType: z.string().max(120).nullable().optional(),
      sqft: z.number().nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      price: z.number().nullable().optional(),
      email: z.string().email().max(320).nullable().optional(),
      listingUrl: z.string().max(2000).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const rating = data.epcRating.toUpperCase();
    const propertyType = data.propertyType ?? "property";
    const sqft = data.sqft && data.sqft > 0 ? `${data.sqft}` : "unknown";
    const address = data.address ?? "this address";
    const priceStr =
      data.price && data.price > 0 ? data.price.toLocaleString("en-GB") : "unknown";

    const prompt = `Generate an EPC analysis for a ${propertyType} at ${address} priced at £${priceStr} with ${sqft} sq ft, rated EPC band ${rating}.

Return ONLY valid JSON (no prose, no markdown fences) matching exactly this shape:
{
  "rating": "${rating}",
  "estimatedAnnualCost": "£X,XXX - £X,XXX",
  "commentary": "3-4 sentences: what this rating means for running costs at this property size, what improvement to the next band would cost and save, mortgage lender implications if below C, whether this rating is typical for this property type and age."
}`;

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      system:
        "You are a UK energy performance specialist. Return ONLY a single valid JSON object. Use realistic 2026 UK energy prices and typical retrofit costs.",
      messages: [{ role: "user", content: prompt }],
    });
    const raw =
      message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed: z.infer<typeof epcSchema>;
    try {
      parsed = epcSchema.parse(JSON.parse(cleaned));
    } catch (err) {
      console.error("[analyseEpcRating] parse failed:", err, raw);
      throw new Error("Could not parse EPC analysis");
    }

    const epcOut = {
      rating,
      score: parsed.score ?? null,
      potentialRating: parsed.potentialRating ?? null,
      estimatedAnnualEnergyCost:
        parsed.estimatedAnnualEnergyCost ?? parsed.estimatedAnnualCost ?? null,
      commentary: parsed.commentary,
    };

    // Best-effort patch into saved_analyses (paying users only — RLS bypass via admin).
    if (data.email && data.listingUrl) {
      try {
        const { data: rows } = await supabaseAdmin
          .from("saved_analyses")
          .select("id, analysis_json, created_at")
          .ilike("user_email", data.email)
          .eq("listing_url", data.listingUrl)
          .order("created_at", { ascending: false })
          .limit(1);
        const row = rows?.[0];
        if (row) {
          const merged = { ...((row.analysis_json as any) ?? {}), epc: epcOut };
          await supabaseAdmin
            .from("saved_analyses")
            .update({ analysis_json: merged })
            .eq("id", row.id as string);
        }
      } catch (err) {
        console.error("[analyseEpcRating] save failed:", err);
      }
    }

    return { ok: true as const, epc: epcOut };
  });

const floodZoneSchema = z.object({
  zone: z.string(),
  riskLevel: z.string(),
  insuranceImplications: z.string(),
  mortgageImplications: z.string(),
  resaleImpact: z.string(),
  commentary: z.string(),
  autoRedFlag: z.boolean(),
});

export const analyseFloodZone = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      floodZone: z.enum(["1", "2", "3a", "3b"]),
      propertyType: z.string().max(120).nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      price: z.number().nullable().optional(),
      email: z.string().email().max(320).nullable().optional(),
      listingUrl: z.string().max(2000).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const zone = data.floodZone;
    const propertyType = data.propertyType ?? "property";
    const address = data.address ?? "this address";
    const priceStr =
      data.price && data.price > 0 ? data.price.toLocaleString("en-GB") : "unknown";

    const prompt = `Generate a flood risk assessment for a ${propertyType} at ${address} priced at £${priceStr} in Flood Zone ${zone}.

Explain what this means for: buildings insurance (likelihood of refusal or premium increase), mortgage availability, future resale value, and what mitigation measures exist.

Return ONLY valid JSON (no prose, no markdown fences) matching exactly this shape:
{
  "zone": "${zone}",
  "riskLevel": "Low" | "Medium" | "High" | "Very High",
  "insuranceImplications": "2-3 sentences on buildings insurance availability and premiums",
  "mortgageImplications": "2-3 sentences on mortgage availability and lender attitudes",
  "resaleImpact": "2 sentences on impact to future resale value",
  "commentary": "2-3 sentences summary plus mitigation measures (flood doors, air-brick covers, sump pumps, Flood Re scheme)",
  "autoRedFlag": ${zone === "3a" || zone === "3b" ? "true" : "false"}
}`;

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 800,
      system:
        "You are a UK flood risk and home insurance specialist. Return ONLY a single valid JSON object. Use realistic 2026 UK insurance and mortgage market context, including the Flood Re scheme.",
      messages: [{ role: "user", content: prompt }],
    });
    const raw =
      message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed: z.infer<typeof floodZoneSchema>;
    try {
      parsed = floodZoneSchema.parse(JSON.parse(cleaned));
    } catch (err) {
      console.error("[analyseFloodZone] parse failed:", err, raw);
      throw new Error("Could not parse flood zone analysis");
    }

    const floodOut = {
      riversAndSea: null,
      surfaceWater: null,
      reservoir: null,
      groundwater: null,
      overallRisk: parsed.riskLevel,
      commentary: parsed.commentary,
      autoRedFlag: parsed.autoRedFlag,
      manualZone: zone,
      riskLevel: parsed.riskLevel,
      insuranceImplications: parsed.insuranceImplications,
      mortgageImplications: parsed.mortgageImplications,
      resaleImpact: parsed.resaleImpact,
    };

    // Best-effort patch into saved_analyses (paying users only).
    if (data.email && data.listingUrl) {
      try {
        const { data: rows } = await supabaseAdmin
          .from("saved_analyses")
          .select("id, analysis_json, created_at")
          .ilike("user_email", data.email)
          .eq("listing_url", data.listingUrl)
          .order("created_at", { ascending: false })
          .limit(1);
        const row = rows?.[0];
        if (row) {
          const existing = (row.analysis_json as any) ?? {};
          const existingFlags = Array.isArray(existing.redFlags) ? existing.redFlags : [];
          const newFlags = parsed.autoRedFlag
            ? [
                ...existingFlags.filter(
                  (f: any) => !(typeof f?.title === "string" && f.title.startsWith("High flood risk — Zone")),
                ),
                {
                  severity: "high" as const,
                  title: `High flood risk — Zone ${zone}`,
                  detail: parsed.commentary,
                },
              ]
            : existingFlags;
          const merged = { ...existing, floodRisk: floodOut, redFlags: newFlags };
          await supabaseAdmin
            .from("saved_analyses")
            .update({ analysis_json: merged })
            .eq("id", row.id as string);
        }
      } catch (err) {
        console.error("[analyseFloodZone] save failed:", err);
      }
    }

    return { ok: true as const, floodRisk: floodOut };
  });

// ---------------- Manual sq ft analysis ----------------
// Computes price per sq ft and area comparison when the listing didn't
// include square footage. Optionally patches the saved_analyses row so the
// value persists.
const manualSqftSchema = z.object({
  pricePerSqFt: z.number(),
  vsAreaAvg: z.string(),
  vsAreaAvgLabel: z.enum(["above", "below"]),
  commentary: z.string(),
});

export const analyseManualSqft = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      sqft: z.number().min(50).max(50000),
      price: z.number().min(1),
      propertyType: z.string().max(120).nullable().optional(),
      address: z.string().max(500).nullable().optional(),
      areaAvgPricePerSqFt: z.number().nullable().optional(),
      email: z.string().email().max(320).nullable().optional(),
      listingUrl: z.string().max(2000).nullable().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");

    const ppsf = Math.round(data.price / data.sqft);
    const propertyType = data.propertyType ?? "property";
    const address = data.address ?? "this address";
    const areaAvg =
      typeof data.areaAvgPricePerSqFt === "number" && data.areaAvgPricePerSqFt > 0
        ? data.areaAvgPricePerSqFt
        : null;

    const prompt = `The user has provided the square footage as ${data.sqft} sq ft for this ${propertyType} at ${address} priced at £${data.price.toLocaleString("en-GB")}. Calculate price per sq ft as £${ppsf}. The area average is ${areaAvg ? `£${areaAvg}/sqft` : "unknown"}. Return ONLY valid JSON (no prose, no markdown fences) matching: { "pricePerSqFt": number, "vsAreaAvg": string (e.g. "+8.2%" or "-4.1%", or "n/a" if area avg unknown), "vsAreaAvgLabel": "above" | "below", "commentary": string (2 sentences: is this good or bad value per sq ft for this area and property type, and what does it mean for the buyer) }`;

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 400,
      system:
        "You are a UK property valuation specialist. Return ONLY a single valid JSON object.",
      messages: [{ role: "user", content: prompt }],
    });
    const raw =
      message.content[0]?.type === "text" ? message.content[0].text.trim() : "";
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    let parsed: z.infer<typeof manualSqftSchema>;
    try {
      parsed = manualSqftSchema.parse(JSON.parse(cleaned));
    } catch (err) {
      console.error("[analyseManualSqft] parse failed:", err, raw);
      // Fallback to local computation if Claude misbehaves.
      const pct =
        areaAvg != null
          ? ((ppsf - areaAvg) / areaAvg) * 100
          : null;
      parsed = {
        pricePerSqFt: ppsf,
        vsAreaAvg:
          pct == null ? "n/a" : `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`,
        vsAreaAvgLabel: pct != null && pct < 0 ? "below" : "above",
        commentary:
          "Price per sq ft computed from your entered size. Compare against similar nearby listings before drawing conclusions.",
      };
    }

    const out = {
      sqft: data.sqft,
      pricePerSqFt: parsed.pricePerSqFt || ppsf,
      vsAreaAvg: parsed.vsAreaAvg,
      vsAreaAvgLabel: parsed.vsAreaAvgLabel,
      commentary: parsed.commentary,
    };

    // Best-effort patch into saved_analyses for paying users.
    if (data.email && data.listingUrl) {
      try {
        const { data: rows } = await supabaseAdmin
          .from("saved_analyses")
          .select("id, analysis_json, created_at")
          .ilike("user_email", data.email)
          .eq("listing_url", data.listingUrl)
          .order("created_at", { ascending: false })
          .limit(1);
        const row = rows?.[0];
        if (row) {
          const existing = (row.analysis_json as any) ?? {};
          const property = { ...(existing.property ?? {}), sqft: data.sqft };
          const metrics = {
            ...(existing.metrics ?? {}),
            pricePerSqFt: out.pricePerSqFt,
          };
          const merged = {
            ...existing,
            property,
            metrics,
            manualSqftAnalysis: out,
          };
          await supabaseAdmin
            .from("saved_analyses")
            .update({ analysis_json: merged })
            .eq("id", row.id as string);
        }
      } catch (err) {
        console.error("[analyseManualSqft] save failed:", err);
      }
    }

    return { ok: true as const, manualSqftAnalysis: out };
  });

// ---------------- Pre-analysis precheck ----------------
// Lightweight check that fetches the listing HTML once and reports
// whether EPC rating and square footage can be extracted from the
// listing text. Used to prompt the user for the missing fields BEFORE
// the full analysis starts so the report is accurate first time.
function detectSqftInText(text: string): boolean {
  if (!text) return false;
  // Match e.g. "1,180 sq ft", "1180 sqft", "1180 sq. ft", "1180 ft2",
  // "850 square feet", "850 square foot"
  const patterns: RegExp[] = [
    /\b\d{2,3}(?:[,\s]?\d{3})\s*(?:sq\.?\s*ft|sqft|ft\.?\s*²|ft2|square\s+f(?:ee|oo)t)\b/i,
    /\b\d{3,5}\s*(?:sq\.?\s*ft|sqft|ft\.?\s*²|ft2|square\s+f(?:ee|oo)t)\b/i,
    // Square metres — convertible
    /\b\d{2,4}(?:\.\d+)?\s*(?:sq\.?\s*m|sqm|m²|m2|square\s+met(?:re|er)s?)\b/i,
  ];
  return patterns.some((re) => re.test(text));
}

function detectEpcInText(text: string): string | null {
  if (!text) return null;
  const patterns: RegExp[] = [
    /\bEPC\b(?:\s+(?:rating|band|certificate))?\s*[:\-–—]?\s*([A-G])\b/i,
    /\benergy\s+(?:performance\s+)?(?:rating|band|efficiency\s+rating)\b\s*[:\-–—]?\s*([A-G])\b/i,
    /\b(?:EPC|energy)\b[^.]{0,80}\b(?:rating|band)\b[^.]{0,24}\b([A-G])\b/i,
    /\b(?:rating|band)\b\s*[:\-–—]?\s*([A-G])\b[^.]{0,60}\b(?:EPC|energy)\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return m[1].toUpperCase();
  }
  return null;
}

export const precheckListing = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      url: z.string().max(2000).optional(),
      text: z.string().max(50000).optional(),
    })
  )
  .handler(async ({ data }): Promise<{
    epcFound: boolean;
    sqftFound: boolean;
    epcRating: string | null;
    textLength: number;
    skipped: boolean;
  }> => {
    const url = data.url?.trim() ?? "";
    const pastedText = data.text?.trim() ?? "";
    console.log("[precheckListing] invoked", { hasUrl: Boolean(url), hasPastedText: Boolean(pastedText) });
    if (!url && !pastedText) {
      return { epcFound: false, sqftFound: false, epcRating: null, textLength: 0, skipped: false };
    }
    if (pastedText) {
      const epcRating = detectEpcInText(pastedText);
      const sqftFound = detectSqftInText(pastedText);
      return { epcFound: Boolean(epcRating), sqftFound, epcRating, textLength: pastedText.length, skipped: false };
    }
    try {
      validateListingUrl(url);
    } catch {
      console.log("[precheckListing] invalid url, treating details as missing");
      return { epcFound: false, sqftFound: false, epcRating: null, textLength: 0, skipped: false };
    }

    let html = "";
    try {
      html = await basicFetchListingHtml(url);
    } catch (err) {
      console.warn("[precheckListing] fetch threw, treating as both-missing:", (err as Error)?.message);
    }

    const textForScan = html ? htmlToCleanText(html) : "";
    let epcRating: string | null = null;
    if (html) {
      epcRating = extractEpcAndCouncilTax(html).epc;
    }
    if (!epcRating) {
      epcRating = detectEpcInText(textForScan);
    }
    const sqftFound = detectSqftInText(textForScan);

    console.log("[precheckListing] scan complete", {
      url,
      textLength: textForScan.length,
      epcFound: Boolean(epcRating),
      epcRating,
      sqftFound,
      source: html ? "fetch" : "none",
    });

    return {
      epcFound: Boolean(epcRating),
      sqftFound,
      epcRating,
      textLength: textForScan.length,
      skipped: false,
    };
  });
