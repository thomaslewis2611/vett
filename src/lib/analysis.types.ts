// Mock analysis result for the vett MVP UI.
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
  scoreReasons?: {
    valueForMoney?: string | null;
    locationQuality?: string | null;
    listingTransparency?: string | null;
    marketTiming?: string | null;
    riskLevel?: string | null;
    resalePotential?: string | null;
  };
  metrics: {
    pricePerSqFt: number;
    daysOnMarket: number;
    councilTaxBand: string;
    estimatedStampDuty: number;
  };
  epc?: {
    rating: string | null;
    score: number | null;
    potentialRating: string | null;
    estimatedAnnualEnergyCost: string | null;
    commentary: string | null;
  } | null;
  priceHistory?: {
    entries:
      | {
          date: string;
          price: number;
          event: "sold" | "listed" | "reduced" | "relisted";
        }[]
      | null;
    firstSalePrice: number | null;
    firstSaleDate: string | null;
    totalAppreciation: number | null;
    annualGrowthRate: number | null;
    yearsHeld: number | null;
    commentary: string;
    source?: "land_registry" | null;
    nearbyMode?: boolean | null;
    scotland?: boolean | null;
  } | null;
  floodRisk?: {
    riversAndSea: string | null;
    surfaceWater: string | null;
    reservoir: boolean | null;
    groundwater: string | null;
    overallRisk: string | null;
    commentary: string;
    autoRedFlag: boolean;
    scotland?: boolean | null;
    unavailable?: boolean | null;
    manualZone?: string | null;
    riskLevel?: string | null;
    insuranceImplications?: string | null;
    mortgageImplications?: string | null;
    resaleImpact?: string | null;
  } | null;
  nearbySchools?: {
    schools: {
      name: string;
      ofstedRating: number | null;
      schoolType: string | null;
      phase: "primary" | "secondary" | "other";
      distanceMiles: number;
      urn?: string | null;
    }[];
    unavailable?: boolean | null;
    aiSourced?: boolean | null;
  } | null;
  crime?: {
    totalCrimes: number;
    month: string; // "YYYY-MM"
    topCategories: { category: string; count: number; label: string }[];
    riskLevel: "Low" | "Moderate" | "High" | "Very High";
    commentary: string;
    autoRedFlag: boolean;
    coordinates?: { lat: number; lng: number } | null;
    unavailable?: boolean | null;
  } | null;
  broadband?: {
    downloadSpeed: string;
    uploadSpeed: string;
    connectionType: "Full fibre" | "Fibre to cabinet" | "ADSL" | "Limited";
    suitableForRemoteWork: boolean;
    mobileSignal: "Excellent" | "Good" | "Limited" | "Poor";
    commentary: string;
    speedRating: "Excellent" | "Good" | "Average" | "Poor";
    source?: string | null;
    unavailable?: boolean | null;
    autoRedFlag?: boolean | null;
  } | null;
  transport?: {
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
  } | null;
  ptal?: {
    grade: string;
    band: number | null;
    label: string;
    explanation: string;
    source?: string | null;
  } | null;
  areaContext: {
    avgPricePerSqFtArea: number | null;
    avgSoldPriceArea: number | null;
    priceVsAreaPercent: number | null;
    areaDescription: string;
    comparableNote: string;
  };
  planningReference?: {
    found: boolean;
    reference: string | null;
    relatesTo: string | null;
    applicationType:
      | "Householder"
      | "Full Planning"
      | "Change of Use"
      | "Listed Building Consent"
      | "Unknown"
      | null;
    commentary: string | null;
  } | null;
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
    valuationFee?: number;
    landRegistryFee?: number;
    electronicTransferFee?: number;
    removalCosts?: number;
    indemnityInsurance?: number;
    buildingsInsurance?: number;
    serviceCharge?: number;
    groundRent?: number;
    leaseholdYears?: number;
    councilTaxMonthly?: number;
    buildingsInsuranceMonthly?: number;
    serviceChargeMonthly?: number;
    totalUpfront: number;
    monthlyMortgage: number;
    mortgageAssumptions: string;
  };
  viewingQuestions: string[];
  nextSteps?: string[] | null;
  sellerMotivation?: {
    score: number;
    label: "Low" | "Moderate" | "High" | "Very High";
    signals: string[];
    commentary: string;
  } | null;
  viewingChecklist?: {
    items: {
      category: "Structure" | "Legal" | "Running costs" | "Negotiation" | "Practical";
      item: string;
      why: string;
    }[];
  } | null;
  partialPostcode?: string | null;
  inferredPostcode?: boolean | null;
  inferredPostcodeValue?: string | null;
  renovationCosts?: {
    items: {
      issue: string;
      estimatedCost: string;
      priority: "High priority" | "Medium priority" | "Low priority";
      notes: string;
    }[];
    totalEstimatedMin: number;
    totalEstimatedMax: number;
    commentary: string;
  } | null;
  manualSqftAnalysis?: {
    sqft: number;
    pricePerSqFt: number;
    vsAreaAvg: string;
    vsAreaAvgLabel: "above" | "below";
    commentary: string;
  } | null;
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
  propertyData?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    soldPrices?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    floodRisk?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    schools?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    crime?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    internetSpeed?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    energyEfficiency?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    floorAreas?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    growth?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    planningApplications?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    listedBuildings?: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    conservationArea?: any;
  } | null;
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
  scoreReasons: {
    valueForMoney: "At £685,000 (£580/sq ft) the home undercuts the SW18 average of ~£620/sq ft, but it needs cosmetic work that comparable refurbished homes don't. Net-net it's fairly priced rather than a bargain.",
    locationQuality: "SW18 sits between Earlsfield and Wandsworth Common with frequent trains to Waterloo in under 20 minutes and well-rated state primaries. Green space and high-street amenities are within easy walking distance.",
    listingTransparency: "The agent mentions tenure and council tax band but glosses over the dated kitchen and bathrooms, and there's no EPC figure quoted. The phrase 'scope to modernise' is doing a lot of work.",
    marketTiming: "The listing has been live for 47 days with no price reduction yet, suggesting the asking price is testing the top of the market. Comparable end-of-terraces in SW18 are turning over inside 30 days.",
    riskLevel: "Single-storey rear extension flagged 'recently completed' but no building-regs sign-off is referenced, and the description hints at original sash windows in poor condition. Both could mean significant post-purchase spend.",
    resalePotential: "End-of-terrace freehold houses in SW18 with three beds remain the area's most liquid stock, and family demand has been resilient. Resale outlook is strong assuming basic modernisation is completed.",
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
  epc: {
    rating: "D",
    score: 62,
    potentialRating: "B",
    estimatedAnnualEnergyCost: "£1,850 per year",
    commentary:
      "A D rating means typical energy bills around £1,800–£2,000 per year for a 1,180 sq ft end-of-terrace. Upgrading to a C (loft + cavity wall insulation, modern boiler) costs roughly £4–7k and would save ~£300/year. Below-D ratings are starting to attract higher rates from green-focused lenders, though most mainstream lenders are unaffected today.",
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
