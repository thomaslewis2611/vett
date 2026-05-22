import { createFileRoute } from "@tanstack/react-router";
import { getCloudflareEnv } from "@/lib/cloudflare-env";

const FIELD_MASK =
  "places.id,places.displayName,places.rating,places.userRatingCount,places.reviews,places.googleMapsUri";

interface RawReview {
  authorAttribution?: { displayName?: string; photoUri?: string };
  rating?: number;
  text?: { text?: string };
  relativePublishTimeDescription?: string;
}

const RATE_LIMIT = 50;

export const Route = createFileRoute("/api/place-reviews")({
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
          const kvKey = `reviews:${ip}:${hour}`;
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
        const name = (url.searchParams.get("name") ?? "").trim();
        const address = (url.searchParams.get("address") ?? "").trim();

        if (!name || !address) {
          return json({ error: "name and address are required" }, 400);
        }

        const apiKey =
          process.env.GOOGLE_PLACES_API_KEY ?? (globalThis as any).GOOGLE_PLACES_API_KEY;
        if (!apiKey) {
          return json({ error: "Search service unavailable" }, 503);
        }

        // ── Search Places ─────────────────────────────────────────────────────
        let data: any;
        try {
          const resp = await fetch(
            "https://places.googleapis.com/v1/places:searchText",
            {
              method: "POST",
              headers: {
                "X-Goog-Api-Key": apiKey,
                "X-Goog-FieldMask": FIELD_MASK,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ textQuery: `${name} ${address}` }),
            },
          );
          if (!resp.ok) throw new Error(`Places HTTP ${resp.status}`);
          data = await resp.json();
        } catch (e) {
          console.error("[place-reviews] fetch error", e);
          return json({ error: "Failed to fetch reviews" }, 500);
        }

        const place = data.places?.[0];
        if (!place) {
          return json({ error: "Place not found" }, 404);
        }

        const reviews = ((place.reviews ?? []) as RawReview[])
          .slice(0, 5)
          .map((r) => ({
            author: r.authorAttribution?.displayName ?? "Anonymous",
            authorPhoto: r.authorAttribution?.photoUri ?? null,
            rating: r.rating ?? 0,
            text: r.text?.text ?? "",
            timeAgo: r.relativePublishTimeDescription ?? "",
          }))
          .filter((r) => r.text.length > 0);

        return json({
          name: place.displayName?.text ?? name,
          rating: place.rating ?? 0,
          reviewCount: place.userRatingCount ?? 0,
          googleMapsUrl: place.googleMapsUri ?? "",
          reviews,
        });
      },
    },
  },
});
