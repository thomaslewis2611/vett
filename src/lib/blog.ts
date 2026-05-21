import type { ComponentType } from "react";

export type PostFrontmatter = {
  title: string;
  slug: string;
  date: string;
  excerpt: string;
  author: string;
  authorRole?: string;
  coverImage: string;
  coverImageAlt: string;
  tags: string[];
  category: string;
  featured?: boolean;
  seoTitle?: string;
  seoDescription?: string;
};

export type Post = PostFrontmatter & {
  readingTime: number;
  Component: ComponentType;
};

const compiledModules = import.meta.glob("../content/blog/*.mdx", { eager: true }) as Record<
  string,
  { default: ComponentType; frontmatter: PostFrontmatter }
>;

const rawModules = import.meta.glob("../content/blog/*.mdx", {
  query: "?raw",
  eager: true,
  import: "default",
}) as Record<string, string>;

function countWords(raw: string): number {
  const withoutFm = raw.replace(/^---[\s\S]*?---\n?/, "");
  const text = withoutFm
    .replace(/```[\s\S]*?```/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/import\s+[\s\S]*?from\s+['"][^'"]+['"]/g, "")
    .replace(/export\s+.*?;/g, "")
    .replace(/[#*_`[\]()!]/g, "");
  return text.trim().split(/\s+/).filter(Boolean).length;
}

let _posts: Post[] | null = null;

export function getAllPosts(): Post[] {
  if (_posts) return _posts;
  _posts = Object.entries(compiledModules)
    .map(([path, mod]) => {
      const raw = rawModules[path] ?? "";
      const fm = mod.frontmatter;
      return {
        ...fm,
        readingTime: Math.max(1, Math.ceil(countWords(raw) / 220)),
        Component: mod.default,
      } as Post;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  return _posts;
}

export function getPostBySlug(slug: string): Post | undefined {
  return getAllPosts().find((p) => p.slug === slug);
}

export function getRelatedPosts(currentSlug: string, tags: string[], limit = 3): Post[] {
  const all = getAllPosts().filter((p) => p.slug !== currentSlug);
  const tagSet = new Set(tags);
  const withOverlap = all.filter((p) => p.tags.some((t) => tagSet.has(t)));
  if (withOverlap.length >= limit) return withOverlap.slice(0, limit);
  const usedSlugs = new Set(withOverlap.map((p) => p.slug));
  const recent = all.filter((p) => !usedSlugs.has(p.slug));
  return [...withOverlap, ...recent].slice(0, limit);
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
