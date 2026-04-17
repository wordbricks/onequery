import { initialTransition, setup, transition } from "xstate";

import type { OpenClawTimeline } from "./timing";

const OPEN_CLAW_SCENE_EVENT = {
  SHOW_CHROME: "openClawScene/showChrome",
  SHOW_USER_PROMPT: "openClawScene/showUserPrompt",
  SHOW_RUN_MESSAGE: "openClawScene/showRunMessage",
  SHOW_RUN_CARD: "openClawScene/showRunCard",
  SHOW_REPORT_MESSAGE: "openClawScene/showReportMessage",
  SHOW_REPORT_CARD: "openClawScene/showReportCard",
  COMPLETE: "openClawScene/complete",
} as const;

type OpenClawSceneEvent =
  | { type: typeof OPEN_CLAW_SCENE_EVENT.SHOW_CHROME }
  | { type: typeof OPEN_CLAW_SCENE_EVENT.SHOW_USER_PROMPT }
  | { type: typeof OPEN_CLAW_SCENE_EVENT.SHOW_RUN_MESSAGE }
  | { type: typeof OPEN_CLAW_SCENE_EVENT.SHOW_RUN_CARD }
  | { type: typeof OPEN_CLAW_SCENE_EVENT.SHOW_REPORT_MESSAGE }
  | { type: typeof OPEN_CLAW_SCENE_EVENT.SHOW_REPORT_CARD }
  | { type: typeof OPEN_CLAW_SCENE_EVENT.COMPLETE };

type OpenClawScenePhase =
  | "booting"
  | "chromeVisible"
  | "promptVisible"
  | "runMessageVisible"
  | "runCardVisible"
  | "reportMessageVisible"
  | "reportCardVisible"
  | "complete";

export type OpenClawSceneState = {
  phase: OpenClawScenePhase;
  hasChrome: boolean;
  hasUserPrompt: boolean;
  hasRunMessage: boolean;
  hasRunCard: boolean;
  hasReportMessage: boolean;
  hasReportCard: boolean;
};

const OPEN_CLAW_SCENE_COMPLETE_DELAY = 12;

// Comment: phase remains the source of truth; these booleans are a thin
// projection for layout branches that only care about visibility.
const OPEN_CLAW_SCENE_VISIBILITY: Record<
  OpenClawScenePhase,
  Omit<OpenClawSceneState, "phase">
> = {
  booting: {
    hasChrome: false,
    hasUserPrompt: false,
    hasRunMessage: false,
    hasRunCard: false,
    hasReportMessage: false,
    hasReportCard: false,
  },
  chromeVisible: {
    hasChrome: true,
    hasUserPrompt: false,
    hasRunMessage: false,
    hasRunCard: false,
    hasReportMessage: false,
    hasReportCard: false,
  },
  promptVisible: {
    hasChrome: true,
    hasUserPrompt: true,
    hasRunMessage: false,
    hasRunCard: false,
    hasReportMessage: false,
    hasReportCard: false,
  },
  runMessageVisible: {
    hasChrome: true,
    hasUserPrompt: true,
    hasRunMessage: true,
    hasRunCard: false,
    hasReportMessage: false,
    hasReportCard: false,
  },
  runCardVisible: {
    hasChrome: true,
    hasUserPrompt: true,
    hasRunMessage: true,
    hasRunCard: true,
    hasReportMessage: false,
    hasReportCard: false,
  },
  reportMessageVisible: {
    hasChrome: true,
    hasUserPrompt: true,
    hasRunMessage: true,
    hasRunCard: true,
    hasReportMessage: true,
    hasReportCard: false,
  },
  reportCardVisible: {
    hasChrome: true,
    hasUserPrompt: true,
    hasRunMessage: true,
    hasRunCard: true,
    hasReportMessage: true,
    hasReportCard: true,
  },
  complete: {
    hasChrome: true,
    hasUserPrompt: true,
    hasRunMessage: true,
    hasRunCard: true,
    hasReportMessage: true,
    hasReportCard: true,
  },
};

const openClawSceneMachine = setup({
  types: {} as {
    events: OpenClawSceneEvent;
  },
}).createMachine({
  id: "openClawScene",
  initial: "booting",
  states: {
    booting: {
      on: {
        [OPEN_CLAW_SCENE_EVENT.SHOW_CHROME]: "chromeVisible",
      },
    },
    chromeVisible: {
      on: {
        [OPEN_CLAW_SCENE_EVENT.SHOW_USER_PROMPT]: "promptVisible",
      },
    },
    promptVisible: {
      on: {
        [OPEN_CLAW_SCENE_EVENT.SHOW_RUN_MESSAGE]: "runMessageVisible",
      },
    },
    runMessageVisible: {
      on: {
        [OPEN_CLAW_SCENE_EVENT.SHOW_RUN_CARD]: "runCardVisible",
      },
    },
    runCardVisible: {
      on: {
        [OPEN_CLAW_SCENE_EVENT.SHOW_REPORT_MESSAGE]: "reportMessageVisible",
      },
    },
    reportMessageVisible: {
      on: {
        [OPEN_CLAW_SCENE_EVENT.SHOW_REPORT_CARD]: "reportCardVisible",
      },
    },
    reportCardVisible: {
      on: {
        [OPEN_CLAW_SCENE_EVENT.COMPLETE]: "complete",
      },
    },
    complete: {},
  },
});

const buildSceneMilestones = (timeline: OpenClawTimeline) =>
  [
    {
      frame: timeline.window,
      event: { type: OPEN_CLAW_SCENE_EVENT.SHOW_CHROME } as const,
    },
    {
      frame: timeline.userMessage,
      event: { type: OPEN_CLAW_SCENE_EVENT.SHOW_USER_PROMPT } as const,
    },
    {
      frame: timeline.runMessageHeader,
      event: { type: OPEN_CLAW_SCENE_EVENT.SHOW_RUN_MESSAGE } as const,
    },
    {
      frame: timeline.runCard,
      event: { type: OPEN_CLAW_SCENE_EVENT.SHOW_RUN_CARD } as const,
    },
    {
      frame: timeline.reportMessageHeader,
      event: { type: OPEN_CLAW_SCENE_EVENT.SHOW_REPORT_MESSAGE } as const,
    },
    {
      frame: timeline.reportCard,
      event: { type: OPEN_CLAW_SCENE_EVENT.SHOW_REPORT_CARD } as const,
    },
    {
      frame: timeline.reportPRs + OPEN_CLAW_SCENE_COMPLETE_DELAY,
      event: { type: OPEN_CLAW_SCENE_EVENT.COMPLETE } as const,
    },
  ] as const;

export const resolveOpenClawSceneState = (
  frame: number,
  timeline: OpenClawTimeline
): OpenClawSceneState => {
  // Comment: Remotion renders must stay seek-safe, so we replay milestone
  // events from the current frame instead of running a long-lived actor.
  let [snapshot] = initialTransition(openClawSceneMachine);

  for (const milestone of buildSceneMilestones(timeline)) {
    if (frame < milestone.frame) {
      break;
    }

    [snapshot] = transition(openClawSceneMachine, snapshot, milestone.event);
  }

  const phase = snapshot.value as OpenClawScenePhase;

  return {
    phase,
    ...OPEN_CLAW_SCENE_VISIBILITY[phase],
  };
};
