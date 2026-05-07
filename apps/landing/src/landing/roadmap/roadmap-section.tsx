import { SECTION_IDS } from "../config/landing-config";
import { ROADMAP_LANES } from "../content/landing-content";

export function RoadmapSection() {
  return (
    <section className="section roadmap-section" id={SECTION_IDS.roadmap}>
      <div className="section-intro">
        <p className="eyebrow">Roadmap</p>
        <h2>Start with debugging. Build toward governed access.</h2>
      </div>

      <ol className="roadmap-lanes">
        {ROADMAP_LANES.map((lane) => (
          <li
            key={lane.status}
            className="roadmap-lane"
            data-status={lane.status}
          >
            <header className="roadmap-lane-header">
              <span
                className="roadmap-lane-marker"
                data-status={lane.status}
                aria-hidden="true"
              />
              <span className="roadmap-lane-eyebrow">{lane.eyebrow}</span>
            </header>

            <h3 className="roadmap-lane-title">{lane.title}</h3>

            <ol className="roadmap-lane-list">
              {lane.items.map((item) => (
                <li key={item.key} className="roadmap-lane-item">
                  <p className="roadmap-lane-item-title">{item.title}</p>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );
}
