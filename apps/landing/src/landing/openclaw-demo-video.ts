import { getImage } from "astro:assets";

import openClawDemoPoster from "../assets/openclaw-demo-poster.png";
import openClawDemoVideoMp4Src from "../assets/openclaw-demo-video.mp4?url";
import openClawDemoVideoWebmSrc from "../assets/openclaw-demo-video.webm?url";

export const OPEN_CLAW_DEMO_VIDEO = {
  description:
    "Demo showing OneQuery granting an AI agent governed access to approved production context without sharing production credentials.",
  duration: "PT20S",
  height: 900,
  mp4Src: openClawDemoVideoMp4Src,
  name: "OneQuery OpenClaw agent access demo",
  posterHeight: openClawDemoPoster.height,
  posterWidth: openClawDemoPoster.width,
  uploadDate: "2026-05-22T00:00:00.000Z",
  webmSrc: openClawDemoVideoWebmSrc,
  width: 1400,
} as const;

export function getOpenClawDemoPosterImage() {
  return getImage({
    format: "avif",
    height: OPEN_CLAW_DEMO_VIDEO.posterHeight,
    quality: 76,
    src: openClawDemoPoster,
    width: OPEN_CLAW_DEMO_VIDEO.posterWidth,
  });
}
