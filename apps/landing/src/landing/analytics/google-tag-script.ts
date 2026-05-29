import type { GoogleTagConfig } from "./google-tag-config";

function toInlineScriptLiteral(value: string) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function createGoogleTagScriptSrc({
  domain,
  id,
  script,
}: GoogleTagConfig) {
  return `${domain}/${script}?id=${id}`;
}

export function createGoogleTagEventBridgeScript() {
  return `
window.dataLayer=window.dataLayer||[];
window.gtag=window.gtag||function gtag(){window.dataLayer.push(arguments);};
`;
}

export function createGoogleTagBootstrapScript({ id }: GoogleTagConfig) {
  return `
(function(){
  window.dataLayer=window.dataLayer||[];
  function gtag(){window.dataLayer.push(arguments);}
  gtag("js",new Date());
  gtag("config",${toInlineScriptLiteral(id)});
})();
`;
}

export function createGoogleTagAfterSwapScript({ id }: GoogleTagConfig) {
  return `
if(!window.__onequeryGoogleTagAfterSwapAdded){
  window.__onequeryGoogleTagAfterSwapAdded=true;
  document.addEventListener("astro:after-swap",function(){
    if(typeof window.gtag!=="function"){
      return;
    }

    window.gtag("config",${toInlineScriptLiteral(id)},{
      page_location:window.location.href,
      page_path:window.location.pathname+window.location.search,
      page_title:document.title
    });
  });
}`;
}
