import { createFileRoute } from "@tanstack/react-router";

const POSTCODE_REGEX = /^[A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2}$/i;

const FIELD_MASK =
  "places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,places.regularOpeningHours,places.businessStatus";

// Categories that use text search
const TEXT_QUERIES: Record<string, string> = {
  surveyors: "{postcode} chartered surveyors RICS",
  solicitors: "{postcode} property solicitors conveyancing",
  architects: "{postcode} architects",
  "mortgage-brokers": "{postcode} mortgage brokers advisers",
  contractors: "{postcode} renovation contractors builders",
  "removal-companies": "{postcode} removal companies",
};

// Categories that use nearby search with a Google Places type
const NEARBY_TYPES: Record<string, string[]> = {
  "estate-agents": ["real_estate_agency"],
};

interface RawPlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: { openNow?: boolean };
  businessStatus?: string;
}

function normalisePlace(p: RawPlace) {
  return {
    name: p.displayName?.text ?? "Unknown",
    address: p.formattedAddress ?? "",
    rating: typeof p.rating === "number" ? p.rating : null,
    reviewCount: p.userRatingCount ?? 0,
    website: p.websiteUri ?? null,
    phone: p.nationalPhoneNumber ?? null,
    isOpen: p.regularOpeningHours?.openNow ?? null,
  };
}

export const Route = createFileRoute("/api/local-businesses")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const postcode = (url.searchParams.get("postcode") ?? "").trim();
        const category = url.searchParams.get("category") ?? "surveyors";

        if (!POSTCODE_REGEX.test(postcode)) {
          return new Response(JSON.stringify({ error: "Invalid postcode format" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const apiKey =
          process.env.GOOGLE_PLACES_API_KEY ?? (globalThis as any).GOOGLE_PLACES_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "Search service unavailable" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }

        // ── Step 1: Geocode postcode ──────────────────────────────────────────
        let lat: number, lng: number;
        try {
          const geoResp = await fetch(
            `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(postcode)}&region=uk&key=${apiKey}`,
          );
          if (!geoResp.ok) throw new Error(`Geocode HTTP ${geoResp.status}`);
          const geo = (await geoResp.json()) as any;
          if (!geo.results?.length) {
            return new Response(JSON.stringify({ error: "Postcode not found" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          lat = geo.results[0].geometry.location.lat;
          lng = geo.results[0].geometry.location.lng;
        } catch (e) {
          console.error("[local-businesses] geocode error", e);
          return new Response(JSON.stringify({ error: "Failed to look up postcode" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        // ── Step 2: Search Places ─────────────────────────────────────────────
        let rawPlaces: RawPlace[] = [];
        try {
          if (NEARBY_TYPES[category]) {
            const resp = await fetch(
              "https://places.googleapis.com/v1/places:searchNearby",
              {
                method: "POST",
                headers: {
                  "X-Goog-Api-Key": apiKey,
                  "X-Goog-FieldMask": FIELD_MASK,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  includedTypes: NEARBY_TYPES[category],
                  maxResultCount: 10,
                  locationRestriction: {
                    circle: { center: { latitude: lat, longitude: lng }, radius: 8000 },
                  },
                }),
              },
            );
            if (!resp.ok) {
              const errText = await resp.text();
              throw new Error(`Places nearby HTTP ${resp.status}: ${errText}`);
            }
            rawPlaces = ((await resp.json()) as any).places ?? [];
          } else {
            const queryTemplate =
              TEXT_QUERIES[category] ?? `{postcode} ${category}`;
            const textQuery = queryTemplate.replace("{postcode}", postcode.toUpperCase());
            const resp = await fetch(
              "https://places.googleapis.com/v1/places:searchText",
              {
                method: "POST",
                headers: {
                  "X-Goog-Api-Key": apiKey,
                  "X-Goog-FieldMask": FIELD_MASK,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  textQuery,
                  locationBias: {
                    circle: { center: { latitude: lat, longitude: lng }, radius: 8000 },
                  },
                  maxResultCount: 10,
                }),
              },
            );
            if (!resp.ok) {
              const errText = await resp.text();
              throw new Error(`Places text HTTP ${resp.status}: ${errText}`);
            }
            rawPlaces = ((await resp.json()) as any).places ?? [];
          }
        } catch (e) {
          console.error("[local-businesses] places error", e);
          return new Response(
            JSON.stringify({ error: "Search failed — please try again" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        // ── Step 3: Filter, normalise, sort ───────────────────────────────────
        const results = rawPlaces
          .filter(
            (p) =>
              p.businessStatus === "OPERATIONAL" || p.businessStatus === undefined,
          )
          .map(normalisePlace)
          .sort((a, b) => {
            const rDiff = (b.rating ?? 0) - (a.rating ?? 0);
            if (rDiff !== 0) return rDiff;
            return b.reviewCount - a.reviewCount;
          });

        return new Response(
          JSON.stringify({
            postcode: postcode.toUpperCase(),
            category,
            lat,
            lng,
            results,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
