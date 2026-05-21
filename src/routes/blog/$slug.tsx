import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { getPostBySlug, getRelatedPosts, formatDate, type Post } from "@/lib/blog";
import { SiteHeader, SiteFooter } from "@/components/site-chrome";

const SITE_URL = "https://vetthome.com";

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = getPostBySlug(params.slug);
    if (!post) throw notFound();
    return post;
  },
  head: ({ loaderData: post }) => {
    if (!post) return {};
    const title = post.seoTitle || post.title;
    const description = post.seoDescription || post.excerpt;
    const url = `${SITE_URL}/blog/${post.slug}`;
    const image = post.coverImage.startsWith("http") ? post.coverImage : `${SITE_URL}${post.coverImage}`;

    const articleSchema = {
      "@context": "https://schema.org",
      "@type": "Article",
      headline: post.title,
      image,
      datePublished: post.date,
      dateModified: post.date,
      author: { "@type": "Person", name: post.author },
      publisher: {
        "@type": "Organization",
        name: "vett",
        logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png` },
      },
      description,
    };

    const breadcrumbSchema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE_URL}/blog` },
        { "@type": "ListItem", position: 3, name: post.title, item: url },
      ],
    };

    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:image", content: image },
        { property: "og:type", content: "article" },
        { property: "og:url", content: url },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: image },
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        { type: "application/ld+json", children: JSON.stringify(articleSchema) },
        { type: "application/ld+json", children: JSON.stringify(breadcrumbSchema) },
      ],
    };
  },
  component: BlogPost,
});

const HEADING = "'Playfair Display', Georgia, serif";
const BODY = "'Inter', -apple-system, sans-serif";
const C = {
  bg: "#F1EFE8",
  card: "#FFFDF9",
  dark: "#1A1108",
  green: "#2D6A4F",
  greenTint: "#EAF3DE",
  muted: "#5F5E5A",
  veryMuted: "#888780",
  border: "rgba(26,17,8,0.12)",
};

const proseStyles = `
  .vett-prose { color: ${C.dark}; font-family: ${BODY}; font-size: 18px; line-height: 1.75; }
  .vett-prose h2 { font-family: ${HEADING}; font-size: 28px; font-weight: 400; letter-spacing: -0.3px; line-height: 1.2; margin: 2.5em 0 0.8em; color: ${C.dark}; }
  .vett-prose h3 { font-family: ${HEADING}; font-size: 22px; font-weight: 400; letter-spacing: -0.2px; line-height: 1.3; margin: 2em 0 0.6em; color: ${C.dark}; }
  .vett-prose p { margin: 0 0 1.4em; }
  .vett-prose a { color: ${C.green}; text-decoration: underline; text-underline-offset: 3px; }
  .vett-prose a:hover { opacity: 0.8; }
  .vett-prose strong { font-weight: 600; }
  .vett-prose em { font-style: italic; }
  .vett-prose ul { margin: 0 0 1.4em; padding-left: 1.5em; list-style: disc; }
  .vett-prose ol { margin: 0 0 1.4em; padding-left: 1.5em; list-style: decimal; }
  .vett-prose li { margin-bottom: 0.5em; }
  .vett-prose blockquote { border-left: 3px solid ${C.green}; padding: 0.5em 0 0.5em 1.25em; margin: 1.5em 0; font-style: italic; color: ${C.muted}; }
  .vett-prose code { font-family: 'Menlo', 'Courier New', monospace; font-size: 0.875em; background: #E8E4D8; padding: 2px 6px; border-radius: 4px; }
  .vett-prose pre { background: #E8E4D8; border-radius: 12px; padding: 20px 24px; overflow-x: auto; margin: 1.5em 0; }
  .vett-prose pre code { background: none; padding: 0; font-size: 0.85em; }
  .vett-prose img { border-radius: 12px; max-width: 100%; height: auto; display: block; margin: 1.5em 0; }
  .vett-prose hr { border: none; border-top: 0.5px solid ${C.border}; margin: 2.5em 0; }
  .vett-prose table { width: 100%; border-collapse: collapse; margin: 1.5em 0; font-size: 15px; }
  .vett-prose th { text-align: left; padding: 10px 14px; background: ${C.bg}; font-weight: 500; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: ${C.muted}; border-bottom: 0.5px solid ${C.border}; }
  .vett-prose td { padding: 10px 14px; border-bottom: 0.5px solid ${C.border}; vertical-align: top; }
  .vett-prose tr:last-child td { border-bottom: none; }
`;

function CoverImage({
  src,
  alt,
  title,
  style,
}: {
  src: string;
  alt: string;
  title: string;
  style?: CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        style={{
          width: "100%",
          background: C.bg,
          borderRadius: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "48px 24px",
          marginBottom: 48,
          ...style,
        }}
      >
        <span
          style={{
            fontFamily: HEADING,
            fontSize: "clamp(20px, 3vw, 28px)",
            color: C.green,
            textAlign: "center",
            lineHeight: 1.3,
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
      loading="eager"
      width={720}
      height={400}
      onError={() => setFailed(true)}
      style={{ width: "100%", height: "auto", borderRadius: 16, display: "block", marginBottom: 48, ...style }}
    />
  );
}

function RelatedCover({ src, alt, title }: { src: string; alt: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div
        style={{
          width: "100%",
          height: 160,
          background: C.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 16px",
        }}
      >
        <span style={{ fontFamily: HEADING, fontSize: 13, color: C.green, textAlign: "center", lineHeight: 1.35 }}>
          {title}
        </span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      width={360}
      height={200}
      onError={() => setFailed(true)}
      style={{ width: "100%", height: 160, objectFit: "cover" }}
    />
  );
}

function RelatedCard({ post }: { post: Post }) {
  return (
    <Link
      to="/blog/$slug"
      params={{ slug: post.slug }}
      style={{
        display: "flex",
        flexDirection: "column",
        background: C.card,
        border: `0.5px solid ${C.border}`,
        borderRadius: 16,
        overflow: "hidden",
        textDecoration: "none",
        color: C.dark,
      }}
      className="hover:opacity-90 transition-opacity"
    >
      <RelatedCover src={post.coverImage} alt={post.coverImageAlt} title={post.title} />
      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: C.green,
          }}
        >
          {post.category}
        </span>
        <h3 style={{ fontFamily: HEADING, fontSize: 16, fontWeight: 400, color: C.dark, margin: 0, lineHeight: 1.3 }}>
          {post.title}
        </h3>
        <span style={{ fontSize: 11, color: C.veryMuted }}>
          {formatDate(post.date)} · {post.readingTime} min read
        </span>
      </div>
    </Link>
  );
}

function BlogPost() {
  const post = Route.useLoaderData();
  const related = getRelatedPosts(post.slug, post.tags);
  const { Component } = post;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: BODY, color: C.dark }}>
      <style>{proseStyles}</style>
      <SiteHeader />

      <main>
        <article>
          {/* Header */}
          <div style={{ padding: "48px 24px 0", maxWidth: 720, margin: "0 auto" }}>
            {/* Breadcrumb */}
            <nav
              style={{ fontSize: 12, color: C.veryMuted, marginBottom: 28, display: "flex", alignItems: "center", gap: 6 }}
              aria-label="Breadcrumb"
            >
              <Link to="/" style={{ color: C.veryMuted, textDecoration: "none" }} className="hover:underline">
                Home
              </Link>
              <span>›</span>
              <Link to="/blog/" style={{ color: C.veryMuted, textDecoration: "none" }} className="hover:underline">
                Blog
              </Link>
              <span>›</span>
              <span
                style={{ color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 200 }}
              >
                {post.title}
              </span>
            </nav>

            {/* Category */}
            <span
              style={{
                display: "inline-block",
                fontSize: 10,
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: C.green,
                background: C.greenTint,
                borderRadius: 100,
                padding: "4px 12px",
                marginBottom: 20,
              }}
            >
              {post.category}
            </span>

            {/* Title */}
            <h1
              style={{
                fontFamily: HEADING,
                fontSize: "clamp(30px, 4vw, 42px)",
                fontWeight: 400,
                color: C.dark,
                letterSpacing: "-0.5px",
                lineHeight: 1.15,
                margin: "0 0 24px",
              }}
            >
              {post.title}
            </h1>

            {/* Meta */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 12,
                fontSize: 13,
                color: C.muted,
                marginBottom: 36,
                paddingBottom: 28,
                borderBottom: `0.5px solid ${C.border}`,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    background: C.green,
                    color: "#FFFDF9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 13,
                    fontWeight: 500,
                    flexShrink: 0,
                  }}
                >
                  {post.author[0]}
                </div>
                <div>
                  <div style={{ fontWeight: 500, color: C.dark, fontSize: 13 }}>{post.author}</div>
                  {post.authorRole && (
                    <div style={{ fontSize: 11, color: C.veryMuted }}>{post.authorRole}</div>
                  )}
                </div>
              </div>
              <span style={{ color: C.border }}>|</span>
              <span>{formatDate(post.date)}</span>
              <span>·</span>
              <span>{post.readingTime} min read</span>
            </div>
          </div>

          {/* Cover image */}
          <div style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px" }}>
            <CoverImage src={post.coverImage} alt={post.coverImageAlt} title={post.title} />
          </div>

          {/* MDX content */}
          <div style={{ maxWidth: 680, margin: "0 auto", padding: "0 24px" }}>
            <div className="vett-prose">
              <Component />
            </div>
          </div>

          {/* Tags */}
          <div style={{ maxWidth: 680, margin: "0 auto", padding: "40px 24px 0" }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {post.tags.map((tag) => (
                <Link
                  key={tag}
                  to="/blog/"
                  search={{ tag }}
                  style={{
                    fontSize: 12,
                    color: C.muted,
                    background: C.card,
                    border: `0.5px solid ${C.border}`,
                    borderRadius: 100,
                    padding: "5px 12px",
                    textDecoration: "none",
                  }}
                  className="hover:opacity-80 transition-opacity"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          </div>

          {/* Author bio */}
          <div
            style={{
              maxWidth: 680,
              margin: "40px auto 0",
              padding: "24px",
              background: C.card,
              border: `0.5px solid ${C.border}`,
              borderRadius: 16,
              display: "flex",
              gap: 16,
              alignItems: "flex-start",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: 999,
                background: C.green,
                color: "#FFFDF9",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 20,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {post.author[0]}
            </div>
            <div>
              <div style={{ fontWeight: 500, fontSize: 14, color: C.dark }}>{post.author}</div>
              {post.authorRole && (
                <div style={{ fontSize: 12, color: C.veryMuted, marginBottom: 6 }}>{post.authorRole}</div>
              )}
              <p style={{ fontSize: 13, color: C.muted, lineHeight: 1.55, margin: 0 }}>
                Thomas founded vett to give UK property buyers an independent, data-driven analysis of any listing — without needing a surveyor before you've even made an offer.
              </p>
            </div>
          </div>
        </article>

        {/* Related posts */}
        {related.length > 0 && (
          <section style={{ maxWidth: 1100, margin: "0 auto", padding: "64px 24px 80px" }}>
            <h2
              style={{
                fontFamily: HEADING,
                fontSize: 24,
                fontWeight: 400,
                color: C.dark,
                letterSpacing: "-0.3px",
                marginBottom: 28,
              }}
            >
              More from vett
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3" style={{ gap: 20 }}>
              {related.map((p) => (
                <RelatedCard key={p.slug} post={p} />
              ))}
            </div>
          </section>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
