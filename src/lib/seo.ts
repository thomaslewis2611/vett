// SEO helper library
// Centralises JSON-LD schema generation, canonical URL construction,
// and common meta fields. All schema follows schema.org standards.

export const SITE_URL = "https://vetthome.com";
export const SITE_NAME = "vett";
export const SITE_DESCRIPTION =
  "AI-powered property analysis for UK home buyers. Red flags, true costs, value score and negotiation strategy in minutes. From £4.99.";
export const SITE_LOGO_URL = `${SITE_URL}/logo.png`;
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;
export const TWITTER_HANDLE = "@vett";

// Author info — used for Article schema
export const DEFAULT_AUTHOR_NAME = "Thomas Lewis";
export const DEFAULT_AUTHOR_URL = `${SITE_URL}/about`;

/**
 * Build a canonical URL from a path. Always uses the production domain
 * regardless of where the code is running (dev, preview, prod).
 */
export function canonicalUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${cleanPath}`;
}

/**
 * Organisation schema — describes vett as an entity. Goes on the homepage.
 * Helps Google understand your brand for Knowledge Graph.
 */
export function organisationSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: SITE_LOGO_URL,
    description: SITE_DESCRIPTION,
    sameAs: [
      // Add social profiles here as they go live, e.g.:
      // "https://twitter.com/vett",
      // "https://linkedin.com/company/vett",
    ],
  };
}

/**
 * WebSite schema — describes the site itself. Goes on the homepage.
 * Enables Google sitelinks search box if you add a search action later.
 */
export function websiteSchema() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: SITE_LOGO_URL,
      },
    },
  };
}

/**
 * Article schema for blog posts. Goes on each individual post page.
 * Eligible for Article rich results in Google Search.
 */
export interface ArticleSchemaInput {
  title: string;
  description: string;
  slug: string;
  imageUrl: string;
  datePublished: string; // ISO 8601 (e.g. "2026-05-21")
  dateModified?: string; // ISO 8601, defaults to datePublished
  authorName?: string;
  authorUrl?: string;
}

export function articleSchema(input: ArticleSchemaInput) {
  const url = canonicalUrl(`/blog/${input.slug}`);
  const dateModified = input.dateModified ?? input.datePublished;
  const authorName = input.authorName ?? DEFAULT_AUTHOR_NAME;
  const authorUrl = input.authorUrl ?? DEFAULT_AUTHOR_URL;

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    image: input.imageUrl,
    datePublished: input.datePublished,
    dateModified,
    author: {
      "@type": "Person",
      name: authorName,
      url: authorUrl,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      logo: {
        "@type": "ImageObject",
        url: SITE_LOGO_URL,
      },
    },
    mainEntityOfPage: {
      "@type": "WebPage",
      "@id": url,
    },
  };
}

/**
 * BreadcrumbList schema — improves how Google displays your URLs in results.
 * Optional but recommended for blog posts.
 */
export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbSchema(items: BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * Build standard meta tags for a page in the format TanStack Start expects.
 * Returns an array suitable for the `meta` field of a route's `head()` function.
 *
 * Use this in every route to ensure consistent metadata.
 */
export interface PageMetaInput {
  title: string;
  description: string;
  canonicalPath: string;
  ogImage?: string;
  ogType?: "website" | "article";
  twitterCard?: "summary" | "summary_large_image";
  // Article-only fields
  publishedTime?: string;
  modifiedTime?: string;
  author?: string;
}

export function buildPageMeta(input: PageMetaInput) {
  const ogImage = input.ogImage ?? DEFAULT_OG_IMAGE;
  const ogType = input.ogType ?? "website";
  const twitterCard = input.twitterCard ?? "summary_large_image";
  const canonical = canonicalUrl(input.canonicalPath);

  const meta = [
    { title: input.title },
    { name: "description", content: input.description },
    { property: "og:title", content: input.title },
    { property: "og:description", content: input.description },
    { property: "og:type", content: ogType },
    { property: "og:url", content: canonical },
    { property: "og:image", content: ogImage },
    { property: "og:site_name", content: SITE_NAME },
    { name: "twitter:card", content: twitterCard },
    { name: "twitter:site", content: TWITTER_HANDLE },
    { name: "twitter:title", content: input.title },
    { name: "twitter:description", content: input.description },
    { name: "twitter:image", content: ogImage },
  ];

  // Article-specific OG tags
  if (ogType === "article") {
    if (input.publishedTime) {
      meta.push({ property: "article:published_time", content: input.publishedTime });
    }
    if (input.modifiedTime) {
      meta.push({ property: "article:modified_time", content: input.modifiedTime });
    }
    if (input.author) {
      meta.push({ property: "article:author", content: input.author });
    }
  }

  return meta;
}

/**
 * Build the canonical link tag in TanStack Start's expected format.
 * Returns a single link object to be included in the route's `links` array.
 */
export function buildCanonicalLink(canonicalPath: string) {
  return { rel: "canonical", href: canonicalUrl(canonicalPath) };
}

/**
 * Helper to render JSON-LD as a script tag. Use in route head() functions
 * by adding the returned object to a `scripts` array.
 */
export function jsonLdScript(schema: object | object[]) {
  return {
    type: "application/ld+json",
    children: JSON.stringify(schema),
  };
}