import { defineMiddleware } from "astro:middleware";

import {
  CANONICAL_REDIRECT_STATUS,
  createCanonicalRedirectUrl,
} from "./landing/seo/canonical-routing";

export const onRequest = defineMiddleware((context, next) => {
  const canonicalUrl = createCanonicalRedirectUrl(context.url);

  if (canonicalUrl) {
    return context.redirect(canonicalUrl.toString(), CANONICAL_REDIRECT_STATUS);
  }

  return next();
});
