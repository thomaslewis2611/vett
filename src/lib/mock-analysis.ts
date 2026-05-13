// Mock analysis result for the Roovr MVP UI.
// This will be replaced by a real Claude API call in a follow-up.

export type AnalysisResult = {
  property: {
    address: string;
    price: number;
    beds: number;
    baths: number;
    type: string;
    sqft: number;
    listingUrl: string;
  };
  score: number;
  scoreLabel: string;
  subScores: {
    valueForMoney: number;
    locationQuality: number;
    listingTransparency: number;
    marketTiming: number;
    riskLevel: number;
    resalePotential: number;
  };
  metrics: {
    pricePerSqFt: number;
    daysOnMarket: number;
    councilTaxBand: string;
    estimatedStampDuty: number;
  };
  areaContext: {
    avgPricePerSqFtArea: number | null;
    avgSoldPriceArea: number | null;
    priceVsAreaPercent: number | null;
    areaDescription: string;
    comparableNote: string;
  };
  redFlags: {
    severity: "high" | "medium" | "low";
    title: string;
    detail: string;
  }[];
  costs: {
    purchasePrice: number;
    stampDuty: number;
    legalFees: number;
    surveyFees: number;
    mortgageFees: number;
    totalUpfront: number;
    monthlyMortgage: number;
    mortgageAssumptions: string;
  };
  viewingQuestions: string[];
  negotiation: {
    isAuction?: boolean;
    maxBid?: number;
    recommendedOffer: { low: number; high: number };
    rationale: string;
    leverage: string[];
  };
  comparables: {
    address: string;
    soldPrice: number;
    soldDate: string;
    distance: string;
  }[];
};

export const mockAnalysis: AnalysisResult = {
  property: {
    address: "42 Elmwood Avenue, London SW18 3QN",
    price: 685000,
    beds: 3,
    baths: 2,
    type: "End of terrace house",
    sqft: 1180,
    listingUrl: "https://www.rightmove.co.uk/properties/example",
  },
  score: 7.2,
  scoreLabel: "Solid buy with room to negotiate",
  subScores: {
    valueForMoney: 7,
    locationQuality: 8,
    listingTransparency: 6,
    marketTiming: 5,
    riskLevel: 6,
    resalePotential: 8,
  },
  metrics: {
    pricePerSqFt: 580,
    daysOnMarket: 47,
    councilTaxBand: "E",
    estimatedStampDuty: 21750,
  },
  areaContext: {
    avgPricePerSqFtArea: 620,
    avgSoldPriceArea: 705000,
    priceVsAreaPercent: -3,
    areaDescription: "SW18 is a well-connected south London postcode with strong transport links and good schools. Prices have softened slightly in the last 12 months.",
    comparableNote: "This property is priced just below the local average but needs cosmetic work that comparable refurbished homes already have.",
  },
  redFlags: [
    {
      severity: "high",
      title: "Listed 47 days — above local average of 28",
      detail:
        "Properties in SW18 typically go under offer within 4 weeks. The extended listing time suggests pricing or condition concerns and gives you negotiating leverage.",
    },
    {
      severity: "high",
      title: "'Scope to modernise' phrasing",
      detail:
        "Estate agent code for dated kitchen and bathroom. Budget £25–40k for refurbishment based on size.",
    },
    {
      severity: "medium",
      title: "Leasehold mentioned — 89 years remaining",
      detail:
        "Below the 90-year mortgage threshold. Lease extension will cost roughly £8–14k and is worth raising at offer stage.",
    },
    {
      severity: "medium",
      title: "No EPC rating disclosed in listing",
      detail:
        "By law the EPC should be visible. Request it before viewing — properties hiding low ratings (E/F/G) face upcoming MEES regulations.",
    },
    {
      severity: "low",
      title: "Photos taken in poor light",
      detail:
        "May indicate north-facing rooms or damp the agent doesn't want to highlight. Visit at midday to verify natural light.",
    },
  ],
  costs: {
    purchasePrice: 685000,
    stampDuty: 21750,
    legalFees: 1800,
    surveyFees: 850,
    mortgageFees: 1200,
    totalUpfront: 710600,
    monthlyMortgage: 3120,
    mortgageAssumptions:
      "Based on 15% deposit (£102,750), 25-year term at 4.8% fixed.",
  },
  viewingQuestions: [
    "Why is the property being sold and how flexible is the seller on timing?",
    "Has there been any subsidence, damp or structural work in the past 10 years?",
    "What is the current EPC rating and have any insulation upgrades been made?",
    "How many years remain on the lease and what are the ground rent and service charges?",
    "When were the boiler, electrics and roof last serviced or replaced?",
    "Have any offers been made and rejected, and at what level?",
    "Are there any planning applications pending on neighbouring properties?",
    "What is included in the sale — appliances, fixtures, garden shed?",
  ],
  negotiation: {
    recommendedOffer: { low: 635000, high: 655000 },
    rationale:
      "Listed 47 days with cosmetic refurb required and a short lease. A 4–7% discount is realistic given comparable sales and current local demand softening.",
    leverage: [
      "47 days on market vs 28 day local average",
      "Lease extension cost of approx £11,000",
      "Comparable at 38 Elmwood sold £642k in March",
      "Refurb budget of £30k+ for kitchen and bathroom",
    ],
  },
  comparables: [
    {
      address: "38 Elmwood Avenue",
      soldPrice: 642000,
      soldDate: "Mar 2024",
      distance: "Same street",
    },
    {
      address: "12 Oakfield Road",
      soldPrice: 670000,
      soldDate: "Jan 2024",
      distance: "0.2 miles",
    },
    {
      address: "7 Birch Close",
      soldPrice: 625000,
      soldDate: "Nov 2023",
      distance: "0.3 miles",
    },
  ],
};

export function formatGBP(n: number): string {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);
}
