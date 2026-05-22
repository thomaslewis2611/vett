import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { getAllPosts, toSerialized, formatDate, type SerializedPost } from "@/lib/blog";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

export const Route = createFileRoute("/blog/")({
  head: () => ({
    meta: [
      { title: "Blog — vett" },
      {
        name: "description",
        content:
          "Guides and insights for UK property buyers. Understand pricing, red flags, due diligence, and how to negotiate before you make an offer.",
      },
      { property: "og:title", content: "Blog — vett" },
      {
        property: "og:description",
        content: "Guides and insights for UK property buyers. Understand pricing, red flags, due diligence, and how to negotiate.",
      },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "https://vetthome.com/blog" }],
  }),
  loader: () => getAllPosts().map(toSerialized),
  component: BlogIndex,
});

const HEADING = "'Playfair Display', Georgia, serif";
const BODY = "'Inter', -apple-system, sans-serif";
const C = {
  bg: "#F1EFE8",
  card: "#FFFDF9",
  dark: "#1A1108",
  green: "#2D6A4F",
  muted: "#5F5E5A",
  veryMuted: "#888780",
  border: "rgba(26,17,8,0.12)",
};

function CoverImage({
  src,
  alt,
  title,
  height,
  eager,
}: {
  src: string;
  alt: string;
  title: string;
  height: number;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        style={{
          width: "100%",
          height,
          background: C.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 20px",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: HEADING,
            fontSize: 15,
            color: C.green,
            textAlign: "center",
            lineHeight: 1.35,
          }}
        >
          {title}
        </span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      onError={() => setFailed(true)}
      style={{ width: "100%", height, objectFit: "cover", display: "block" }}
    />
  );
}

function PostCard({ post, featured = false }: { post: SerializedPost; featured?: boolean }) {
  return (
    <Link
      to="/blog/$slug"
      params={{ slug: post.slug }}
      style={{
        display: "flex",
        flexDirection: featured ? "row" : "column",
        background: C.card,
        border: `0.5px solid ${C.border}`,
        borderRadius: 20,
        overflow: "hidden",
        textDecoration: "none",
        color: C.dark,
        transition: "border-color 150ms ease, opacity 150ms ease",
      }}
      className="blog-card hover:opacity-90"
    >
      <div style={{ flex: featured ? "0 0 50%" : undefined, position: "relative" }}>
        <CoverImage
          src={post.coverImage}
          alt={post.coverImageAlt}
          title={post.title}
          height={featured ? 340 : 200}
          eager={featured}
        />
      </div>
      <div style={{ padding: featured ? 36 : 24, display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 500,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: C.green,
              background: "#EAF3DE",
              borderRadius: 100,
              padding: "3px 10px",
            }}
          >
            {post.category}
          </span>
        </div>
        <h2
          style={{
            fontFamily: HEADING,
            fontSize: featured ? 28 : 20,
            fontWeight: 400,
            color: C.dark,
            letterSpacing: "-0.3px",
            lineHeight: 1.25,
            margin: 0,
          }}
        >
          {post.title}
        </h2>
        <p style={{ fontSize: 14, fontWeight: 300, color: C.muted, lineHeight: 1.6, margin: 0, flex: 1 }}>
          {post.excerpt}
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 12,
            color: C.veryMuted,
            fontFamily: BODY,
          }}
        >
          <span>{post.author}</span>
          <span>·</span>
          <span>{formatDate(post.date)}</span>
          <span>·</span>
          <span>{post.readingTime} min read</span>
        </div>
      </div>
    </Link>
  );
}

function BlogIndex() {
  const posts = Route.useLoaderData();
  const featured = posts.find((p) => p.featured);
  const rest = posts.filter((p) => !p.featured);

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: BODY, color: C.dark }}>
      <style>{`.blog-hero { padding: 48px 24px 56px; } @media (min-width: 640px) { .blog-hero { padding: 80px 24px 56px; } } .blog-card:hover { border-color: #2D6A4F !important; }`}</style>
      <SiteHeader />
      <main>
        {/* Hero */}
        <section className="blog-hero" style={{ textAlign: "center" }}>
          <div className="mx-auto" style={{ maxWidth: 640 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                color: C.green,
                marginBottom: 16,
              }}
            >
              The vett blog
            </div>
            <h1
              style={{
                fontFamily: HEADING,
                fontSize: "clamp(34px, 5vw, 48px)",
                fontWeight: 400,
                color: C.dark,
                letterSpacing: "-0.5px",
                lineHeight: 1.1,
                margin: 0,
              }}
            >
              Insights for smarter property buyers
            </h1>
            <p
              style={{
                marginTop: 20,
                fontSize: 16,
                fontWeight: 300,
                color: C.muted,
                lineHeight: 1.6,
              }}
            >
              Guides on pricing analysis, due diligence, and how to negotiate — for buyers who want to understand what they're actually buying.
            </p>
          </div>
        </section>

        <div className="mx-auto" style={{ maxWidth: 1100, padding: "0 24px 80px" }}>
          {/* Featured post */}
          {featured && (
            <div style={{ marginBottom: 48 }}>
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 500,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                  color: C.veryMuted,
                  marginBottom: 16,
                }}
              >
                Featured
              </div>
              <PostCard post={featured} featured />
            </div>
          )}

          {/* Post grid */}
          {rest.length > 0 && (
            <>
              {featured && (
                <hr style={{ border: "none", borderTop: `0.5px solid ${C.border}`, margin: "0 0 40px" }} />
              )}
              <div
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
                style={{ gap: 24 }}
              >
                {rest.map((post) => (
                  <PostCard key={post.slug} post={post} />
                ))}
              </div>
            </>
          )}

          {posts.length === 0 && (
            <p style={{ textAlign: "center", color: C.muted, padding: "60px 0" }}>Posts coming soon.</p>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
