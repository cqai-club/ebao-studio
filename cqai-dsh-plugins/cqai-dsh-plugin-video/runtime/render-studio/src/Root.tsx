import React from 'react';
import {AbsoluteFill, Composition, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig} from 'remotion';
import * as Pkg from './motion/MotionPackage';

const definitionMap = new Map(
  (Pkg.MOTION_COMPONENTS as any[]).map((d) => [d.id, d]),
);

const pipBig = (Pkg as any).PIP_BIG_UNTIL ?? 30;
const pipSmall = (Pkg as any).PIP_SMALL_UNTIL ?? 99999;
const PIP_TRANSITION = 0.8;

function videoLayoutForTime(t: number) {
  const big = {left: 0, top: 0, width: 810, height: 1080, radius: 0};
  const pip = {left: 36, top: 60, width: 300, height: 400, radius: 22};
  let m = 1;
  if (t >= pipBig && t < pipSmall) {
    m = 0;
  } else if (t >= pipBig - PIP_TRANSITION && t < pipBig) {
    m = 1 - (t - (pipBig - PIP_TRANSITION)) / PIP_TRANSITION;
  } else if (t >= pipSmall && t < pipSmall + PIP_TRANSITION) {
    m = (t - pipSmall) / PIP_TRANSITION;
  }
  const lerp = (a: number, b: number) => a * m + b * (1 - m);
  return {
    left: lerp(big.left, pip.left),
    top: lerp(big.top, pip.top),
    width: lerp(big.width, pip.width),
    height: lerp(big.height, pip.height),
    borderRadius: lerp(big.radius, pip.radius),
    pipAmount: 1 - m,
  };
}

const PipelineRender: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const layout = videoLayoutForTime(frame / fps);
  const instances = (Pkg.MOTION_TIMELINE as any[]) ?? [];
  return (
    <AbsoluteFill style={{backgroundColor: '#05070a'}}>
      <OffthreadVideo
        src={staticFile('video.mp4')}
        volume={1}
        style={{
          position: 'absolute',
          left: layout.left,
          top: layout.top,
          width: layout.width,
          height: layout.height,
          objectFit: 'contain',
          borderRadius: layout.borderRadius,
          border: `${3 * layout.pipAmount}px solid rgba(103,232,249,${0.92 * layout.pipAmount})`,
          boxShadow: `0 0 34px rgba(103,232,249,${0.4 * layout.pipAmount})`,
          boxSizing: 'border-box',
        }}
      />
      {instances.map((instance, i) => {
        const def = definitionMap.get(instance.componentId);
        if (!def) return null;
        const Comp = def.component as React.ComponentType<Record<string, unknown>>;
        return (
          <Sequence
            key={i}
            from={Math.max(0, Math.round(instance.startFrame))}
            durationInFrames={Math.max(3, Math.round(instance.durationInFrames))}
          >
            <AbsoluteFill
              style={{
                transform: `translate(${instance.position.x}px, ${instance.position.y}px) scale(${instance.position.scale})`,
                transformOrigin: '0 0',
              }}
            >
              <Comp {...instance.props} backgroundOpacity={instance.backgroundOpacity} />
            </AbsoluteFill>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const PipelineRoot: React.FC = () => {
  return (
    <Composition
      id="Main"
      component={PipelineRender}
      width={1920}
      height={1080}
      fps={(Pkg as any).FPS ?? 25}
      durationInFrames={(Pkg as any).DURATION_IN_FRAMES ?? 300}
    />
  );
};
