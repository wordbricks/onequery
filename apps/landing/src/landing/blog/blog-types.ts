import type { ComponentType } from "react";

export type BlogCategory =
  | "All"
  | "Product"
  | "Engineering"
  | "Safety"
  | "Usecase"
  | "Research";

export interface BlogPost {
  body: string[];
  category: Exclude<BlogCategory, "All">;
  date: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  imageSrc?: string;
  readTime: string;
  sections?: BlogPostSection[];
  slug: string;
  thumbnail: string;
  title: string;
}

export type BlogPostSummary = Omit<BlogPost, "body" | "sections">;

export interface BlogPostSection {
  imageAlt?: string;
  imagePlacement?: "after-title" | "after-paragraphs";
  imageSrc?: string;
  inlineImages?: {
    alt: string;
    beforeParagraphIndex: number;
    src: string;
  }[];
  images?: {
    alt: string;
    src: string;
  }[];
  id: string;
  paragraphs: string[];
  table?: {
    headers: string[];
    rows: string[][];
  };
  title: string;
}
