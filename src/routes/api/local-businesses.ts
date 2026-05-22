import { createFileRoute } from "@tanstack/react-router";
import { getCloudflareEnv } from "@/lib/cloudflare-env";

const POSTCODE_REGEX = /^[A-Z]{1,2}[0-9][0-9A-Z]?\s*[0-9][A-Z]{2}$/i;

const FIELD_MASK =
  "places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.websiteUri,places.nationalPhoneNumber,places.regularOpeningHours,places.businessStatus";

const TEXT_QUERIES: Record<string, string> = {
  surveyors: "{postcode} chartered surveyors RICS",
  solicitors: "{postcode} property solicitors conveyancing",
  architects: "{postcode} architects",
  "mortgage-brokers": "{postcode} mortgage brokers advisers",
  contractors: "{postcode} renovation contractors builders",
  "removal-companies": "{postcode} removal companies",
  plumbers: "{postcode} plumbers emergency plumbing",
  electricians: "{postcode} electricians NICEIC",
  landscapers: "{postcode} landscape gardeners",
};

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

const RATE_LIMIT = 20;

export const Route = createFileRoute("/api/local-businesses")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // ── Rate limiting ─────────────────────────────────────────────────────
        const kv = getCloudflareEnv().RATE_LIMIT_KV as
          | { get(k: string): Promise<string | null>; put(k: string, v: string, o?: { expirationTtl?: number }): Promise<void> }
          | undefined;

        let remaining = RATE_LIMIT - 1;

        if (kv) {
          const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
          const hour = Math.floor(Date.now() / 3600000);
          const kvKey = `search:${ip}:${hour}`;
          const countStr = await kv.get(kvKey);
          const count = countStr ? parseInt(countStr, 10) : 0;

          if (count >= RATE_LIMIT) {
            return new Response(
              JSON.stringify({ error: "Rate limit exceeded. Please try again in an hour." }),
              {
                status: 429,
                headers: {
                  "Content-Type": "application/json",
                  "X-RateLimit-Limit": String(RATE_LIMIT),
                  "X-RateLimit-Remaining": "0",
                },
              },
            );
          }

          remaining = RATE_LIMIT - count - 1;
          kv.put(kvKey, String(count + 1), { expirationTtl: 7200 }).catch(() => {});
        }

        const rl = {
          "X-RateLimit-Limit": String(RATE_LIMIT),
          "X-RateLimit-Remaining": String(remaining),
        };
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "Content-Type": "application/json", ...rl },
          });

        // ── Parse params ──────────────────────────────────────────────────────
        const url = new URL(request.url);
        const postcode = (url.searchParams.get("postcode") ?? "").trim();
        const category = url.searchParams.get("category") ?? "surveyors";

        if (!POSTCODE_REGEX.test(postcode)) {
          return json({ error: "Invalid postcode format" }, 400);
        }

        const radiusRaw = parseInt(url.searchParams.get("radius") ?? "8000", 10);
        const radius = isNaN(radiusRaw) || radiusRaw < 1000 ? 8000 : Math.min(radiusRaw, 50000);

        const excludeRaw = url.searchParams.get("exclude") ?? "";
        const excludeSet = excludeRaw
          ? new Set(
              excludeRaw
                .split(",")
                .map((n) => n.trim().toLowerCase())
                .filter(Boolean),
            )
          : null;

        const apiKey =
          process.env.GOOGLE_PLACES_API_KEY ?? (globalThis as any).GOOGLE_PLACES_API_KEY;
        if (!apiKey) {
          return json({ error: "Search service unavailable" }, 503);
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
            return json({ error: "Postcode not found" }, 400);
          }
          lat = geo.results[0].geometry.location.lat;
          lng = geo.results[0].geometry.location.lng;
        } catch (e) {
          console.error("[local-businesses] geocode error", e);
          return json({ error: "Failed to look up postcode" }, 500);
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
                    circle: { center: { latitude: lat, longitude: lng }, radius },
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
            const queryTemplate = TEXT_QUERIES[category] ?? `{postcode} ${category}`;
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
                    circle: { center: { latitude: lat, longitude: lng }, radius },
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
          return json({ error: "Search failed — please try again" }, 500);
        }

        // ── Step 3: Filter, normalise, sort ───────────────────────────────────
        const results = rawPlaces
          .filter(
            (p) =>
              (p.businessStatus === "OPERATIONAL" || p.businessStatus === undefined) &&
              (!excludeSet ||
                !excludeSet.has((p.displayName?.text ?? "").toLowerCase())),
          )
          .map(normalisePlace)
          .sort((a, b) => {
            const rDiff = (b.rating ?? 0) - (a.rating ?? 0);
            if (rDiff !== 0) return rDiff;
            return b.reviewCount - a.reviewCount;
          });

        return json({ postcode: postcode.toUpperCase(), category, lat, lng, results });
      },
    },
  },
});
