import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { getAllPosts } from "@/lib/blog";

const BASE_URL = "https://vetthome.com";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export const Route = createFileRoute("/rss.xml")({
  server: {
    handlers: {
      GET: async () => {
        const posts = getAllPosts().slice(0, 20);

        const items = posts
          .map((post) => {
            const url = `${BASE_URL}/blog/${post.slug}`;
            const image = post.coverImage.startsWith("http")
              ? post.coverImage
              : `${BASE_URL}${post.coverImage}`;
            return [
              `  <item>`,
              `    <title>${escapeXml(post.title)}</title>`,
              `    <link>${url}</link>`,
              `    <guid isPermaLink="true">${url}</guid>`,
              `    <description>${escapeXml(post.excerpt)}</description>`,
              `    <pubDate>${new Date(post.date).toUTCString()}</pubDate>`,
              `    <author>noreply@vetthome.com (${escapeXml(post.author)})</author>`,
              `    <category>${escapeXml(post.category)}</category>`,
              `    <enclosure url="${image}" type="image/jpeg" length="0" />`,
              `  </item>`,
            ].join("\n");
          })
          .join("\n");

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`,
          `  <channel>`,
          `    <title>vett blog</title>`,
          `    <link>${BASE_URL}/blog</link>`,
          `    <description>Guides and insights for UK property buyers. Understand pricing, red flags, due diligence, and how to negotiate before you make an offer.</description>`,
          `    <language>en-gb</language>`,
          `    <atom:link href="${BASE_URL}/rss.xml" rel="self" type="application/rss+xml" />`,
          items,
          `  </channel>`,
          `</rss>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/rss+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
