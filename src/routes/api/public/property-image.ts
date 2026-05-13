import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BUCKET = "property-images";
const ALLOWED_HOSTS = [
  "media.rightmove.co.uk",
  "lid.zoocdn.com",
  "st.zoocdn.com",
  "search.savills.com",
];

function contentTypeToExt(ct: string): string {
  if (ct.includes("webp")) return "webp";
  if (ct.includes("png")) return "png";
  if (ct.includes("gif")) return "gif";
  return "jpg";
}

function extToContentType(ext: string): string {
  if (ext === "webp") return "image/webp";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
}

async function findCached(hash: string): Promise<{ data: ArrayBuffer; ext: string } | null> {
  for (const ext of ["jpg", "webp", "png", "gif"]) {
    const path = `${hash}.${ext}`;
    const { data } = await supabaseAdmin.storage.from(BUCKET).download(path);
    if (data) {
      return { data: await data.arrayBuffer(), ext };
    }
  }
  return null;
}

export const Route = createFileRoute("/api/public/property-image")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const imageUrl = url.searchParams.get("url");
        if (!imageUrl) return new Response("Missing url", { status: 400 });

        let parsed: URL;
        try {
          parsed = new URL(imageUrl);
        } catch {
          return new Response("Invalid url", { status: 400 });
        }
        if (parsed.protocol !== "https:") {
          return new Response("Invalid url", { status: 400 });
        }
        if (!ALLOWED_HOSTS.some((h) => parsed.hostname === h || parsed.hostname.endsWith("." + h))) {
          return new Response("Host not allowed", { status: 400 });
        }

        const hash = createHash("sha256").update(imageUrl).digest("hex").slice(0, 32);

        // 1. Cache lookup
        try {
          const cached = await findCached(hash);
          if (cached) {
            return new Response(cached.data, {
              status: 200,
              headers: {
                "Content-Type": extToContentType(cached.ext),
                "Cache-Control": "public, max-age=31536000, immutable",
              },
            });
          }
        } catch (err) {
          console.error("[property-image] cache lookup failed:", err);
        }

        // 2. Fetch from origin
        try {
          const res = await fetch(imageUrl, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
              Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
              Referer: parsed.origin + "/",
            },
            redirect: "follow",
          });
          if (!res.ok) {
            console.error(`[property-image] origin ${res.status} for ${imageUrl}`);
            return new Response("Upstream error", { status: 502 });
          }
          const ct = res.headers.get("content-type") || "image/jpeg";
          if (!ct.startsWith("image/")) {
            return new Response("Not an image", { status: 502 });
          }
          const ext = contentTypeToExt(ct);
          const buf = await res.arrayBuffer();

          // 3. Persist (best-effort)
          try {
            await supabaseAdmin.storage.from(BUCKET).upload(
              `${hash}.${ext}`,
              new Uint8Array(buf),
              { contentType: ct, upsert: true }
            );
          } catch (err) {
            console.error("[property-image] upload failed:", err);
          }

          return new Response(buf, {
            status: 200,
            headers: {
              "Content-Type": ct,
              "Cache-Control": "public, max-age=31536000, immutable",
            },
          });
        } catch (err) {
          console.error("[property-image] fetch failed:", err);
          return new Response("Fetch failed", { status: 502 });
        }
      },
    },
  },
});
