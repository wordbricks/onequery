const pages = [
  ["index.html", "Overview"],
  ["brand-logo.html", "Brand Logo"],
  ["buttons.html", "Buttons"],
  ["cards.html", "Cards"],
  ["colors-brand.html", "Brand Colors"],
  ["colors-semantic.html", "Semantic Colors"],
  ["colors-surfaces.html", "Surfaces"],
  ["forms.html", "Forms"],
  ["iconography.html", "Iconography"],
  ["pills-badges.html", "Pills & Badges"],
  ["radii.html", "Radii"],
];

export const tokens = {
  colors: {
    pageWhite: "#ffffff",
    coreInk: "#0a0a0a",
    iconTileBlack: "#121212",
    whaleMark: "#d8e0e7",
    surfaceMuted: "rgba(0, 0, 0, 0.02)",
    mutedText: "rgba(0, 0, 0, 0.62)",
    softText: "rgba(0, 0, 0, 0.45)",
    line: "rgba(0, 0, 0, 0.12)",
    strongLine: "rgba(0, 0, 0, 0.18)",
    wash: "rgba(0, 0, 0, 0.05)",
    strongWash: "rgba(0, 0, 0, 0.07)",
    successBg: "rgba(22, 163, 74, 0.12)",
    successText: "#15803d",
    warningBg: "rgba(217, 119, 6, 0.12)",
    warningText: "#92400e",
    errorBg: "rgba(220, 38, 38, 0.1)",
    errorText: "#b91c1c",
    terminalBg: "#0b0b0c",
    terminalText: "#f4f4f5",
  },
  radii: {
    xs: "4px",
    sm: "7px",
    md: "8px",
    lg: "10px",
    xl: "12px",
    frame: "14px",
    pill: "999px",
  },
};

const iconPaths = {
  check: '<path d="m4 12 4 4 8-9" />',
  database:
    '<ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" /><path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />',
  key: '<circle cx="7.5" cy="14.5" r="3.5" /><path d="M10 12 21 1" /><path d="m16 6 2 2" /><path d="m13 9 2 2" />',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1" />',
  lock: '<rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />',
  play: '<path d="m8 5 11 7-11 7z" />',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />',
  terminal: '<path d="m4 17 6-6-6-6" /><path d="M12 19h8" />',
  x: '<path d="M18 6 6 18" /><path d="m6 6 12 12" />',
};

export function icon(name) {
  const path = iconPaths[name] || iconPaths.check;
  return `<svg class="oq-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function button({ label, variant = "primary", size = "", iconName, disabled = false } = {}) {
  const classes = ["oq-button", `oq-button-${variant}`];
  if (size) classes.push(`oq-button-${size}`);
  return `<button class="${classes.join(" ")}" type="button" ${disabled ? "disabled" : ""}>${iconName ? icon(iconName) : ""}<span>${label}</span></button>`;
}

export function iconButton({ iconName, label, variant = "outline" }) {
  return `<button class="oq-button oq-button-${variant} oq-button-icon" type="button" aria-label="${label}" title="${label}">${icon(iconName)}</button>`;
}

export function badge({ label, variant = "default", iconName }) {
  return `<span class="oq-badge oq-badge-${variant}">${iconName ? icon(iconName) : ""}${label}</span>`;
}

export function card({ title, description, footer, badgeLabel, compact = false }) {
  return `<article class="oq-card ${compact ? "oq-card-sm" : ""}">
    ${badgeLabel ? badge({ label: badgeLabel, variant: "secondary" }) : ""}
    <div class="oq-stack">
      <h3 class="oq-card-title">${title}</h3>
      <p class="oq-card-description">${description}</p>
    </div>
    ${footer ? `<div class="oq-card-footer">${footer}</div>` : ""}
  </article>`;
}

export function field({ label, value = "", help = "", type = "text", textarea = false, select = false }) {
  const control = textarea
    ? `<textarea class="oq-textarea">${value}</textarea>`
    : select
      ? `<select class="oq-select"><option>${value}</option></select>`
      : `<input class="oq-input" type="${type}" value="${value}" />`;
  return `<label class="oq-field">
    <span class="oq-label">${label}</span>
    ${control}
    ${help ? `<span class="oq-help">${help}</span>` : ""}
  </label>`;
}

export function swatch({ name, value, usage }) {
  return `<div class="oq-swatch">
    <div class="oq-swatch-chip" style="--value: ${value}"></div>
    <div class="oq-swatch-meta">
      <span class="oq-swatch-name">${name}</span>
      <span class="oq-code">${value}</span>
      <span class="oq-help">${usage}</span>
    </div>
  </div>`;
}

export function terminal(lines) {
  return `<div class="oq-terminal">
    <div class="oq-terminal-bar"><span class="oq-terminal-dot"></span><span class="oq-terminal-dot"></span><span class="oq-terminal-dot"></span></div>
    <div>${lines.map((line) => `<div>${line}</div>`).join("")}</div>
  </div>`;
}

export function section({ title, description, content }) {
  return `<section class="oq-section">
    <div class="oq-section-head">
      <h2>${title}</h2>
      ${description ? `<p>${description}</p>` : ""}
    </div>
    <div class="oq-demo-surface">${content}</div>
  </section>`;
}

export function grid(items, columns = 3) {
  return `<div class="oq-grid" style="--columns: ${columns}">${items.join("")}</div>`;
}

export function row(items) {
  return `<div class="oq-row">${items.join("")}</div>`;
}

export function renderPage({ title, eyebrow = "OneQuery Design System", description, sections }) {
  const current = location.pathname.split("/").pop() || "index.html";
  document.title = `${title} - OneQuery Design System`;
  document.body.innerHTML = `<div class="oq-shell">
    <aside class="oq-sidebar">
      <a class="oq-brand" href="index.html" aria-label="OneQuery design system overview">
        <img src="../assets/icon-192.png" alt="" />
        <span><strong>OneQuery</strong><br /><span>Design System</span></span>
      </a>
      <nav class="oq-nav" aria-label="Preview pages">
        ${pages.map(([href, label]) => `<a href="${href}" ${href === current ? 'aria-current="page"' : ""}>${label}</a>`).join("")}
      </nav>
    </aside>
    <main class="oq-main">
      <header class="oq-page-header">
        <span class="oq-eyebrow">${eyebrow}</span>
        <h1>${title}</h1>
        <p>${description}</p>
      </header>
      ${sections.join("")}
    </main>
  </div>`;
}
