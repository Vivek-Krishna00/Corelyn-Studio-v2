// Bridges the canvas flow to DeployModal: builds the spec, reports whether
// the daemon is answering, and hands the deploy call over.
import { useEffect, useMemo, useState } from "react";
import * as api from "../api/client";
import DeployModal from "../ros/DeployModal";
import { generateMissionSpec } from "../ros/missionSpec";
import { NODE_DEFS } from "../nodeDefs";

export default function DeployModalWrapper({ flow, onClose }) {
  const [apiOnline, setApiOnline] = useState(false);
  const mission = useMemo(() => generateMissionSpec(flow, NODE_DEFS), [flow]);

  useEffect(() => {
    api.health().then(setApiOnline).catch(() => setApiOnline(false));
  }, []);

  return (
    <DeployModal
      mission={mission}
      rosConnected={apiOnline}
      onClose={onClose}
      onDeploy={api.deploy}
    />
  );
}
