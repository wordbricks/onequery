import { createFileRoute, notFound } from "@tanstack/react-router";

import { BlogPostPage } from "../../landing/blog/blog-post-page";
import { getBlogPostBySlug } from "../../landing/blog/blog-posts";

export const Route = createFileRoute("/blog_/$postSlug")({
  component: BlogPostRouteComponent,
  loader: ({ params }) => {
    const post = getBlogPostBySlug(params.postSlug);
    if (!post) {
      throw notFound();
    }

    return { post };
  },
});

function BlogPostRouteComponent() {
  const { post } = Route.useLoaderData();

  return <BlogPostPage post={post} />;
}
