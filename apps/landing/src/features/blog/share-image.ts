import type { BlogPost } from "./types";

export function getBlogShareImageSource(post: Pick<BlogPost, "coverImage">) {
  return post.coverImage.src;
}
