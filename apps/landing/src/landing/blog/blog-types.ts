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

export interface BlogPostSection {
  imageAlt?: string;
  imageSrc?: string;
  id: string;
  paragraphs: string[];
  title: string;
}
