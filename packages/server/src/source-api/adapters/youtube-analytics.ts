import type { YouTubeAnalyticsCredentials } from "@onequery/db/server";

import { createSimpleRestSourceApiAdapter } from "./simple-rest";

const YOUTUBE_ANALYTICS_DEFAULT_API_BASE_URL =
  "https://youtubeanalytics.googleapis.com/v2";
const YOUTUBE_ANALYTICS_DESCRIPTOR_VERSION = "youtube-analytics.v1";

export const youTubeAnalyticsSourceApiAdapter =
  createSimpleRestSourceApiAdapter<YouTubeAnalyticsCredentials>({
    allowedMethods: ["GET"],
    apiBaseUrl: (credentials) =>
      credentials.apiBaseUrl ?? YOUTUBE_ANALYTICS_DEFAULT_API_BASE_URL,
    auth: (credentials) => ({
      token: credentials.accessToken,
      type: "bearer",
    }),
    buildExamples: (sourceKey) => [
      {
        command: `onequery api --source ${sourceKey} /reports -F 'params.ids="channel==MINE"' -F 'params.startDate="2026-05-01"' -F 'params.endDate="2026-05-07"' -F 'params.metrics="views,estimatedMinutesWatched"' -F 'params.dimensions="day"' -F 'params.sort="day"'`,
        description:
          "Query daily YouTube Analytics metrics for the authorized channel.",
        label: "Query channel metrics",
      },
      {
        command: `onequery api --source ${sourceKey} /reports -F 'params.ids="channel==MINE"' -F 'params.startDate="2026-05-01"' -F 'params.endDate="2026-05-31"' -F 'params.metrics="views,likes,comments"' -F 'params.dimensions="video"' -F 'params.sort="-views"' -F 'params.maxResults=25'`,
        description:
          "Rank videos by views for the authorized channel over a date range.",
        label: "Rank videos",
      },
    ],
    descriptorVersion: YOUTUBE_ANALYTICS_DESCRIPTOR_VERSION,
    notes: [
      "YouTube Analytics private data requires Google OAuth authorization with youtube.readonly and yt-analytics.readonly scopes.",
      "Revenue and ad performance metrics require a token granted the yt-analytics-monetary.readonly scope.",
    ],
    operationNotes: [
      "Use selector `/reports` with query params matching the YouTube Analytics reports.query API.",
      "Common params include `ids`, `startDate`, `endDate`, `metrics`, `dimensions`, `filters`, `sort`, `maxResults`, and `startIndex`.",
    ],
    provider: "youtube_analytics",
    providerLabel: "YouTube Analytics",
  });
