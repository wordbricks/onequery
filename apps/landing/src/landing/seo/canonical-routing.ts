export const CANONICAL_REDIRECT_STATUS = 308;

type CanonicalPathRedirect = {
  pathname: string;
};

const INDEX_HTML_PATH_SUFFIX = "/index.html";
const BLOG_CATEGORY_ARCHIVE_PATTERN =
  /^\/blog\/category\/(?<categorySlug>[^/]+)\/archive$/u;

function stripTrailingSlashes(pathname: string) {
  return pathname.length > 1 ? pathname.replace(/\/+$/u, "") || "/" : pathname;
}

export function getCanonicalPathRedirect(
  pathname: string
): CanonicalPathRedirect | undefined {
  let canonicalPathname = pathname;

  if (canonicalPathname === INDEX_HTML_PATH_SUFFIX) {
    canonicalPathname = "/";
  } else if (canonicalPathname.endsWith(INDEX_HTML_PATH_SUFFIX)) {
    canonicalPathname = canonicalPathname.slice(
      0,
      -INDEX_HTML_PATH_SUFFIX.length
    );
  }

  canonicalPathname = stripTrailingSlashes(canonicalPathname);
  canonicalPathname = redirectBlogArchivePath(canonicalPathname);

  if (canonicalPathname === pathname) {
    return undefined;
  }

  return { pathname: canonicalPathname };
}

function redirectBlogArchivePath(pathname: string) {
  if (pathname === "/blog/archive") {
    return "/blog";
  }

  const categoryArchiveMatch = BLOG_CATEGORY_ARCHIVE_PATTERN.exec(pathname);
  const categorySlug = categoryArchiveMatch?.groups?.categorySlug;

  if (categorySlug) {
    return `/blog/category/${categorySlug}`;
  }

  return pathname;
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
