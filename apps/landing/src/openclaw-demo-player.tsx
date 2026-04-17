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
import { useCallback, useMemo } from "react";

const lazyOpenClawDemoScene = () =>
  import("@onequery/landing-video/scene").then((module) => ({
    default: module.OpenClawDemoScene,
  }));

export function OpenClawDemoPlayer() {
  const lazyComponent = useCallback(lazyOpenClawDemoScene, []);

  const inputProps = useMemo<OpenClawDemoProps>(
    () => defaultOpenClawDemoProps,
    []
  );

  const durationInFrames = useMemo(
    () => getOpenClawDemoDurationInFrames(defaultOpenClawDemoProps),
    []
  );

  const renderLoading = useCallback<RenderLoading>(
    () => <div className="openclaw-demo-loading" aria-hidden="true" />,
    []
  );

  return (
    <Player
      lazyComponent={lazyComponent}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      compositionWidth={openClawDemoWidth}
      compositionHeight={openClawDemoHeight}
      fps={openClawDemoFps}
      autoPlay
      loop
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
