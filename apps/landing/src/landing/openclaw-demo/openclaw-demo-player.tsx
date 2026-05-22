import {
  defaultOpenClawDemoProps,
  getOpenClawDemoDurationInFrames,
  openClawDemoFps,
  openClawDemoHeight,
  openClawDemoWidth,
} from "@onequery/landing-video";
import type { OpenClawDemoProps } from "@onequery/landing-video";
import { useMountEffect } from "@onequery/ui/hooks/use-mount-effect";
import { Player } from "@remotion/player";
import type { PlayerRef, RenderLoading } from "@remotion/player";
import { useRef } from "react";

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
  const playerRef = useRef<PlayerRef>(null);
  const playerShellRef = useRef<HTMLDivElement>(null);

  useMountEffect(() => {
    const playerShell = playerShellRef.current;

    if (!playerShell) {
      return;
    }

    let hasStarted = false;
    const playWhenVisible = () => {
      const player = playerRef.current;

      if (!player || player.isPlaying()) {
        return;
      }

      if (!hasStarted) {
        player.seekTo(0);
        hasStarted = true;
      }

      player.play();
    };
    const pauseWhenHidden = () => playerRef.current?.pause();
    const isPlayerShellInViewport = () => {
      const rect = playerShell.getBoundingClientRect();

      return (
        rect.bottom > 0 &&
        rect.right > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
      );
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          playWhenVisible();
          return;
        }

        pauseWhenHidden();
      },
      { threshold: 0.35 }
    );

    observer.observe(playerShell);

    if (document.visibilityState === "visible") {
      if (isPlayerShellInViewport()) {
        playWhenVisible();
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        pauseWhenHidden();
        return;
      }

      if (isPlayerShellInViewport()) {
        playWhenVisible();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  });

  return (
    <div className="openclaw-demo-player" ref={playerShellRef}>
      <Player
        ref={playerRef}
        lazyComponent={lazyOpenClawDemoScene}
        inputProps={openClawDemoInputProps}
        durationInFrames={openClawDemoDurationInFrames}
        compositionWidth={openClawDemoWidth}
        compositionHeight={openClawDemoHeight}
        fps={openClawDemoFps}
        loop
        initiallyMuted
        clickToPlay
        controls
        showVolumeControls={false}
        doubleClickToFullscreen
        initiallyShowControls
        acknowledgeRemotionLicense
        className="openclaw-demo-player-surface"
        style={{ width: "100%", height: "100%" }}
        renderLoading={renderLoading}
      />
    </div>
  );
}
