import type { GoogleTagManagerConfig } from "./google-tag-manager-config";

const DATA_LAYER_NAME = "dataLayer";

function toInlineScriptLiteral(value: string) {
  return JSON.stringify(value).replaceAll("<", "\\u003c");
}

export function createGoogleTagManagerScript({
  container,
  domain,
  id,
}: GoogleTagManagerConfig) {
  return `(function(w,d,s,l,i,domain,container){
  w[l]=w[l]||[];
  w[l].push({"gtm.start":new Date().getTime(),event:"gtm.js"});
  var f=d.getElementsByTagName(s)[0];
  var j=d.createElement(s);
  var dl=l!="dataLayer"?"&l="+l:"";
  j.async=true;
  j.src=domain.replace(/\\/$/,"")+"/"+container.replace(/^\\//,"")+"?id="+i+dl;
  if(f&&f.parentNode){
    f.parentNode.insertBefore(j,f);
    return;
  }
  d.head.appendChild(j);
})(window,document,"script",${toInlineScriptLiteral(DATA_LAYER_NAME)},${toInlineScriptLiteral(id)},${toInlineScriptLiteral(domain)},${toInlineScriptLiteral(container)});
`;
}

export function createGoogleTagManagerAfterSwapScript() {
  return `
if(!window.__onequeryGoogleTagManagerAfterSwapAdded){
  window.__onequeryGoogleTagManagerAfterSwapAdded=true;
  document.addEventListener("astro:after-swap",function(){
    window.dataLayer=window.dataLayer||[];
    window.dataLayer.push({
      event:"virtualPageview",
      "gtm.start":new Date().getTime(),
      page_location:window.location.href,
      page_path:window.location.pathname+window.location.search,
      page_title:document.title,
      virtualPagePath:window.location.pathname+window.location.search,
      virtualPageTitle:document.title
    });
  });
}`;
}
