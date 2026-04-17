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

export type OpenClawScenePhase =
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
  isComplete: boolean;
};

const OPEN_CLAW_SCENE_TAG = {
  CHROME_VISIBLE: "chrome-visible",
  USER_PROMPT_VISIBLE: "user-prompt-visible",
  RUN_MESSAGE_VISIBLE: "run-message-visible",
  RUN_CARD_VISIBLE: "run-card-visible",
  REPORT_MESSAGE_VISIBLE: "report-message-visible",
  REPORT_CARD_VISIBLE: "report-card-visible",
  COMPLETE: "scene-complete",
} as const;

const OPEN_CLAW_SCENE_COMPLETE_DELAY = 12;

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
      tags: [OPEN_CLAW_SCENE_TAG.CHROME_VISIBLE],
      on: {
        [OPEN_CLAW_SCENE_EVENT.SHOW_USER_PROMPT]: "promptVisible",
      },
    },
    promptVisible: {
      tags: [
        OPEN_CLAW_SCENE_TAG.CHROME_VISIBLE,
        OPEN_CLAW_SCENE_TAG.USER_PROMPT_VISIBLE,
      ],
      on: {
        [OPEN_CLAW_SCENE_EVENT.SHOW_RUN_MESSAGE]: "runMessageVisible",
      },
    },
    runMessageVisible: {
      tags: [
        OPEN_CLAW_SCENE_TAG.CHROME_VISIBLE,
        OPEN_CLAW_SCENE_TAG.USER_PROMPT_VISIBLE,
        OPEN_CLAW_SCENE_TAG.RUN_MESSAGE_VISIBLE,
      ],
      on: {
        [OPEN_CLAW_SCENE_EVENT.SHOW_RUN_CARD]: "runCardVisible",
      },
    },
    runCardVisible: {
      tags: [
        OPEN_CLAW_SCENE_TAG.CHROME_VISIBLE,
        OPEN_CLAW_SCENE_TAG.USER_PROMPT_VISIBLE,
        OPEN_CLAW_SCENE_TAG.RUN_MESSAGE_VISIBLE,
        OPEN_CLAW_SCENE_TAG.RUN_CARD_VISIBLE,
      ],
      on: {
        [OPEN_CLAW_SCENE_EVENT.SHOW_REPORT_MESSAGE]: "reportMessageVisible",
      },
    },
    reportMessageVisible: {
      tags: [
        OPEN_CLAW_SCENE_TAG.CHROME_VISIBLE,
        OPEN_CLAW_SCENE_TAG.USER_PROMPT_VISIBLE,
        OPEN_CLAW_SCENE_TAG.RUN_MESSAGE_VISIBLE,
        OPEN_CLAW_SCENE_TAG.RUN_CARD_VISIBLE,
        OPEN_CLAW_SCENE_TAG.REPORT_MESSAGE_VISIBLE,
      ],
      on: {
        [OPEN_CLAW_SCENE_EVENT.SHOW_REPORT_CARD]: "reportCardVisible",
      },
    },
    reportCardVisible: {
      tags: [
        OPEN_CLAW_SCENE_TAG.CHROME_VISIBLE,
        OPEN_CLAW_SCENE_TAG.USER_PROMPT_VISIBLE,
        OPEN_CLAW_SCENE_TAG.RUN_MESSAGE_VISIBLE,
        OPEN_CLAW_SCENE_TAG.RUN_CARD_VISIBLE,
        OPEN_CLAW_SCENE_TAG.REPORT_MESSAGE_VISIBLE,
        OPEN_CLAW_SCENE_TAG.REPORT_CARD_VISIBLE,
      ],
      on: {
        [OPEN_CLAW_SCENE_EVENT.COMPLETE]: "complete",
      },
    },
    complete: {
      tags: [
        OPEN_CLAW_SCENE_TAG.CHROME_VISIBLE,
        OPEN_CLAW_SCENE_TAG.USER_PROMPT_VISIBLE,
        OPEN_CLAW_SCENE_TAG.RUN_MESSAGE_VISIBLE,
        OPEN_CLAW_SCENE_TAG.RUN_CARD_VISIBLE,
        OPEN_CLAW_SCENE_TAG.REPORT_MESSAGE_VISIBLE,
        OPEN_CLAW_SCENE_TAG.REPORT_CARD_VISIBLE,
        OPEN_CLAW_SCENE_TAG.COMPLETE,
      ],
    },
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

  return {
    phase: snapshot.value as OpenClawScenePhase,
    hasChrome: snapshot.hasTag(OPEN_CLAW_SCENE_TAG.CHROME_VISIBLE),
    hasUserPrompt: snapshot.hasTag(OPEN_CLAW_SCENE_TAG.USER_PROMPT_VISIBLE),
    hasRunMessage: snapshot.hasTag(OPEN_CLAW_SCENE_TAG.RUN_MESSAGE_VISIBLE),
    hasRunCard: snapshot.hasTag(OPEN_CLAW_SCENE_TAG.RUN_CARD_VISIBLE),
    hasReportMessage: snapshot.hasTag(
      OPEN_CLAW_SCENE_TAG.REPORT_MESSAGE_VISIBLE
    ),
    hasReportCard: snapshot.hasTag(OPEN_CLAW_SCENE_TAG.REPORT_CARD_VISIBLE),
    isComplete: snapshot.hasTag(OPEN_CLAW_SCENE_TAG.COMPLETE),
  };
};
