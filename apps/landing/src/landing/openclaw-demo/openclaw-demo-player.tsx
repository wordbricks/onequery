import {
  defaultOpenClawDemoProps,
  getOpenClawDemoDurationInFrames,
  openClawDemoFps,
  openClawDemoHeight,
  openClawDemoWidth,
} from "@onequery/landing-video";
import type { OpenClawDemoProps } from "@onequery/landing-video";
import { Player } from "@remotion/player";
import type { RenderLoading } from "@remotion/player";

const lazyOpenClawDemoScene = () =>
  import("@onequery/landing-video/scene").then((module) => ({
    default: module.OpenClawDemoScene,
  }));

const openClawDemoInputProps: OpenClawDemoProps = defaultOpenClawDemoProps;
const openClawDemoDurationInFrames = getOpenClawDemoDurationInFrames(
  defaultOpenClawDemoProps
);

const renderLoading: RenderLoading = () => (
  <div className="openclaw-demo-loading" aria-hidden="true" />
);

export function OpenClawDemoPlayer() {
  return (
    <Player
      lazyComponent={lazyOpenClawDemoScene}
      inputProps={openClawDemoInputProps}
      durationInFrames={openClawDemoDurationInFrames}
      compositionWidth={openClawDemoWidth}
      compositionHeight={openClawDemoHeight}
      fps={openClawDemoFps}
      autoPlay
      loop
      initiallyMuted
      clickToPlay
      controls
      showVolumeControls={false}
      doubleClickToFullscreen
      initiallyShowControls
      acknowledgeRemotionLicense
      className="openclaw-demo-player"
      style={{ width: "100%", height: "100%" }}
      renderLoading={renderLoading}
    />
  );
}
