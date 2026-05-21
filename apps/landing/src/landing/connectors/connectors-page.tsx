import { useState } from "react";

import { BrandIcon, hasBrandIcon } from "../content/brand-icons";
import { DATA_SOURCE_CONNECTORS } from "../content/landing-content";
import { SiteFooter, SiteHeader } from "../page/landing-page";

type FilterOption = {
  id: string;
  label: string;
};

const ALL_FILTER = "all";

const connectorCategories = [
  ...new Set(DATA_SOURCE_CONNECTORS.map((connector) => connector.category)),
];

const categoryOptions = [
  { id: ALL_FILTER, label: "All" },
  ...connectorCategories.map((category) => ({
    id: category,
    label: category,
  })),
] satisfies ReadonlyArray<FilterOption>;

function ConnectorIcon({ connectorKey }: { connectorKey: string }) {
  if (hasBrandIcon(connectorKey)) {
    return (
      <BrandIcon
        aria-hidden="true"
        className="connector-icon"
        name={connectorKey}
      />
    );
  }

  return (
    <span className="connector-icon-fallback">
      {connectorKey.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ConnectorFilterGroup({
  active,
  label,
  onChange,
  options,
}: {
  active: string;
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<FilterOption>;
}) {
  return (
    <section className="connector-filter-group">
      <h2>{label}</h2>
      <div className="connector-filter-options">
        {options.map((option) => (
          <label className="connector-filter-option" key={option.id}>
            <input
              type="radio"
              name={`connector-filter-${label}`}
              checked={active === option.id}
              onChange={() => onChange(option.id)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

export function ConnectorsPage() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState(ALL_FILTER);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredConnectors = DATA_SOURCE_CONNECTORS.filter((connector) => {
    const matchesSearch =
      normalizedSearch.length === 0 ||
      [
        connector.label,
        connector.category,
        connector.description,
        connector.key,
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
    const matchesCategory =
      activeCategory === ALL_FILTER || connector.category === activeCategory;

    return matchesSearch && matchesCategory;
  });

  function clearFilters() {
    setSearch("");
    setActiveCategory(ALL_FILTER);
  }

  return (
    <div className="page-shell connectors-shell">
      <SiteHeader />

      <main className="connectors-main">
        <section className="connectors-header">
          <div>
            <p className="eyebrow">Connectors</p>
            <h1>Data sources</h1>
          </div>
          <p>
            {DATA_SOURCE_CONNECTORS.length} supported sources for governed agent
            access.
          </p>
        </section>

        <section className="connectors-browser" aria-label="Data sources">
          <aside className="connectors-filter-panel">
            <div className="connectors-filter-title">
              <div>
                <h2>Filters</h2>
                <p>
                  Showing {filteredConnectors.length} of{" "}
                  {DATA_SOURCE_CONNECTORS.length}
                </p>
              </div>
              <button type="button" onClick={clearFilters}>
                Clear all
              </button>
            </div>

            <label className="connectors-search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Search..."
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>

            <ConnectorFilterGroup
              active={activeCategory}
              label="Use Case"
              onChange={setActiveCategory}
              options={categoryOptions}
            />
          </aside>

          <div className="connector-grid">
            {filteredConnectors.map((connector) => (
              <article className="connector-card" key={connector.key}>
                <span className="connector-glyph" aria-hidden="true">
                  <ConnectorIcon connectorKey={connector.key} />
                </span>
                <div className="connector-card-copy">
                  <div className="connector-tags">
                    {connector.capabilities.map((capability) => (
                      <span key={capability}>{capability}</span>
                    ))}
                  </div>
                  <h2>{connector.label}</h2>
                  <p>{connector.category}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
