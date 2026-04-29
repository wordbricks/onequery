import type { BlogPost } from "./blog-posts";
import { thumbnailCells } from "./blog-posts";

export function BlogThumbnail({
  post,
  variant = "card",
}: {
  post: BlogPost;
  variant?: "card" | "hero";
}) {
  if (post.imageSrc) {
    return (
      <div className={`blog-image blog-image-${variant}`}>
        <img
          src={post.imageSrc}
          alt=""
          className="blog-image-media"
          loading={variant === "hero" ? "eager" : "lazy"}
        />
      </div>
    );
  }

  return (
    <div className={`blog-image blog-image-${variant} ${post.thumbnail}`}>
      <div className="blog-image-inner">
        <div className="blog-image-bars">
          <span />
          <span />
          <span />
        </div>
        <div className="blog-image-symbols">
          <post.icon className="blog-image-icon" />
          <div className="blog-image-cells">
            {thumbnailCells.map((cell) => (
              <span key={cell} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
