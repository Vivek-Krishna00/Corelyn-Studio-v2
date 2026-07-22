// Bridges the canvas flow to DeployModal: builds the spec, reports whether
// the daemon is answering, and hands the deploy call over.
import { useEffect, useMemo, useState } from "react";
import * as api from "../api/client";
import DeployModal from "../ros/DeployModal";
import { generateMissionSpec } from "../ros/missionSpec";
import { NODE_DEFS } from "../nodeDefs";

export default function DeployModalWrapper({ flow, onClose, onLog }) {
  // "none"/"disconnected" both mean no live robot link — only "connected" does.
  const [health, setHealth] = useState({ status: null, robot: "none" });
  const mission = useMemo(() => generateMissionSpec(flow, NODE_DEFS), [flow]);

  // Mounted only while the modal is open (see App.jsx), so this already
  // refetches on every open — no polling loop needed.
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: null, robot: "none" }));
  }, []);

  return (
    <DeployModal
      mission={mission}
      apiOnline={health.status === "ok"}
      robotConnected={health.robot === "connected"}
      onClose={onClose}
      onDeploy={api.deploy}
      onLog={onLog}
    />
  );
}
