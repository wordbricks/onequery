export const CANONICAL_REDIRECT_STATUS = 308;

type CanonicalPathRedirect = {
  pathname: string;
};

const INDEX_HTML_PATH_SUFFIX = "/index.html";
const BLOG_CATEGORY_ARCHIVE_PATTERN =
  /^\/blog\/category\/(?<categorySlug>[^/]+)\/archive\/?$/u;

function toTrailingSlashPagePath(pathname: string) {
  if (pathname === "/" || pathname.endsWith("/")) {
    return pathname;
  }

  return `${pathname}/`;
}

export function getCanonicalPathRedirect(
  pathname: string
): CanonicalPathRedirect | undefined {
  const canonicalPathname =
    redirectIndexHtmlPath(pathname) ?? redirectBlogArchivePath(pathname);

  if (!canonicalPathname || canonicalPathname === pathname) {
    return undefined;
  }

  return { pathname: canonicalPathname };
}

function redirectIndexHtmlPath(pathname: string) {
  if (pathname === INDEX_HTML_PATH_SUFFIX) {
    return "/";
  }

  if (!pathname.endsWith(INDEX_HTML_PATH_SUFFIX)) {
    return undefined;
  }

  return toTrailingSlashPagePath(
    pathname.slice(0, -INDEX_HTML_PATH_SUFFIX.length)
  );
}

function redirectBlogArchivePath(pathname: string) {
  // Cloudflare owns trailing-slash redirects for live page URLs. This middleware
  // only redirects removed inventory aliases that Cloudflare cannot infer.
  if (pathname === "/blog/archive" || pathname === "/blog/archive/") {
    return "/blog/";
  }

  const categoryArchiveMatch = BLOG_CATEGORY_ARCHIVE_PATTERN.exec(pathname);
  const categorySlug = categoryArchiveMatch?.groups?.categorySlug;

  if (categorySlug) {
    return `/blog/category/${categorySlug}/`;
  }

  return undefined;
}

export function createCanonicalRedirectUrl(requestUrl: string | URL) {
  const url = new URL(requestUrl);
  const redirect = getCanonicalPathRedirect(url.pathname);

  if (!redirect) {
    return undefined;
  }

  url.pathname = redirect.pathname;

  return url;
}
