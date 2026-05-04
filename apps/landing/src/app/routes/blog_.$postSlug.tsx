import { createFileRoute, notFound } from "@tanstack/react-router";

import { BlogPostPage } from "../../landing/blog/blog-post-page";
import { loadBlogPostBySlug } from "../../landing/blog/blog-posts";
import { getBlogPostHeadMeta } from "../../landing/blog/blog-share-metadata";

export const Route = createFileRoute("/blog_/$postSlug")({
  component: BlogPostRouteComponent,
  loader: async ({ params }) => {
    const post = await loadBlogPostBySlug(params.postSlug);
    if (!post) {
      throw notFound();
    }

    return { post };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {};
    }

    return {
      links: [
        {
          href: `https://onequery.dev/blog/${loaderData.post.slug}`,
          rel: "canonical",
        },
      ],
      // Comment: TanStack Router renders `{ title }` entries at runtime, but
      // the React route type currently narrows `meta` to only `<meta>` props.
      meta: getBlogPostHeadMeta(loaderData.post) as never,
    };
  },
});

function BlogPostRouteComponent() {
  const { post } = Route.useLoaderData();

  return <BlogPostPage post={post} />;
}
