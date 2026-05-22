import { createFileRoute } from "@tanstack/react-router";

const FIELD_MASK =
  "places.id,places.displayName,places.rating,places.userRatingCount,places.reviews,places.googleMapsUri";

interface RawReview {
  authorAttribution?: { displayName?: string; photoUri?: string };
  rating?: number;
  text?: { text?: string };
  relativePublishTimeDescription?: string;
}

export const Route = createFileRoute("/api/place-reviews")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const name = (url.searchParams.get("name") ?? "").trim();
        const address = (url.searchParams.get("address") ?? "").trim();

        if (!name || !address) {
          return new Response(
            JSON.stringify({ error: "name and address are required" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        const apiKey =
          process.env.GOOGLE_PLACES_API_KEY ?? (globalThis as any).GOOGLE_PLACES_API_KEY;
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "Search service unavailable" }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }

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
          return new Response(
            JSON.stringify({ error: "Failed to fetch reviews" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        const place = data.places?.[0];
        if (!place) {
          return new Response(
            JSON.stringify({ error: "Place not found" }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          );
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

        return new Response(
          JSON.stringify({
            name: place.displayName?.text ?? name,
            rating: place.rating ?? 0,
            reviewCount: place.userRatingCount ?? 0,
            googleMapsUrl: place.googleMapsUri ?? "",
            reviews,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
