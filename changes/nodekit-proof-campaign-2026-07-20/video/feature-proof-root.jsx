import React from "react";
import { AbsoluteFill, Composition } from "remotion";
import {
  Walkthrough,
  WT_FPS,
  WT_H,
  WT_W,
  wtDuration,
} from "./Walkthrough.jsx";
import { WALKTHROUGHS } from "./walkthrough.data.js";

const PORTRAIT_W = 1080;
const PORTRAIT_H = 1920;
const LANDSCAPE_SCALE = PORTRAIT_W / WT_W;
const LANDSCAPE_H = WT_H * LANDSCAPE_SCALE;

const requireWalkthrough = (id) => {
  const walkthrough = WALKTHROUGHS.find((candidate) => candidate.id === id);
  if (!walkthrough) {
    throw new Error(`Missing captured walkthrough data for ${id}`);
  }
  return walkthrough;
};

const PortraitWalkthrough = ({ wt }) => (
  <AbsoluteFill
    style={{
      background:
        "radial-gradient(900px 700px at 50% 5%, #17304a 0%, #0b1220 58%, #070b12 100%)",
      color: "#eaf2ff",
      fontFamily:
        '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
    }}
  >
    <div
      style={{
        position: "absolute",
        top: 132,
        left: 0,
        width: WT_W,
        height: WT_H,
        transform: `scale(${LANDSCAPE_SCALE})`,
        transformOrigin: "top left",
      }}
    >
      <Walkthrough wt={wt} />
    </div>

    <div
      style={{
        position: "absolute",
        top: 54,
        left: 64,
        right: 64,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        fontSize: 28,
        fontWeight: 800,
        letterSpacing: "0.02em",
      }}
    >
      <span>NODEKIT · FOUNDER QUEST</span>
      <span style={{ color: wt.accent }}>PROOF WALKTHROUGH</span>
    </div>

    <div
      style={{
        position: "absolute",
        top: 132 + LANDSCAPE_H + 84,
        left: 72,
        right: 72,
        border: "1px solid rgba(255,255,255,0.14)",
        borderRadius: 24,
        padding: "42px 44px",
        background: "rgba(7, 12, 22, 0.72)",
        boxShadow: "0 28px 80px rgba(0,0,0,0.34)",
      }}
    >
      <div style={{ color: wt.accent, fontSize: 26, fontWeight: 850 }}>
        WHAT THIS PROVES
      </div>
      <div
        style={{
          marginTop: 18,
          fontSize: 42,
          lineHeight: 1.18,
          fontWeight: 800,
        }}
      >
        A blocked quest becomes an inspectable graph path, a sourced answer,
        and an evidence-bound receipt.
      </div>
      <div
        style={{
          marginTop: 26,
          fontSize: 27,
          lineHeight: 1.45,
          color: "#afbed0",
        }}
      >
        Read-only synthetic journey. No bank, investor, legal, or regulatory
        approval is implied.
      </div>
    </div>
  </AbsoluteFill>
);

export const NodeKitCampaignRoot = () => {
  const vertical = requireWalkthrough("FounderQuestVertical");
  const technical = requireWalkthrough("FounderQuestTechnical");

  return (
    <>
      <Composition
        id="WT9-FounderQuestVertical"
        component={PortraitWalkthrough}
        durationInFrames={Math.max(1, wtDuration(vertical))}
        fps={WT_FPS}
        width={PORTRAIT_W}
        height={PORTRAIT_H}
        defaultProps={{ wt: vertical }}
      />
      <Composition
        id="WT-FounderQuestTechnical"
        component={Walkthrough}
        durationInFrames={Math.max(1, wtDuration(technical))}
        fps={WT_FPS}
        width={WT_W}
        height={WT_H}
        defaultProps={{ wt: technical }}
      />
    </>
  );
};
