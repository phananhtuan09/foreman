import { useAgent, useRpc } from "@getpaseo/plugin/client";
import { useEffect, useRef, useState } from "react";
import { snapshotRpc, type Snapshot, type TaskSummary } from "../shared/foreman";
import type { AgentView } from "../shared/status";

// Reads the in-memory snapshot of the plugin server on a timer; the server never spawns a process for a fetch.
export function useSnapshot(intervalMs: number): { snapshot: Snapshot | null; error: string | null } {
  const fetchSnapshot = useRpc(snapshotRpc);
  const fetchRef = useRef(fetchSnapshot);
  fetchRef.current = fetchSnapshot;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const load = () => {
      fetchRef.current({}).then(
        (value) => { if (active) { setSnapshot(value); setError(null); } },
        (reason) => { if (active) setError(String(reason?.message ?? reason)); },
      );
    };
    load();
    const timer = setInterval(load, intervalMs);
    return () => { active = false; clearInterval(timer); };
  }, [intervalMs]);
  return { snapshot, error };
}

// Agent state comes from the app's cached agent state only: no RPC, no polling, no timeline.
export function useAgentView(task: TaskSummary): AgentView | null {
  const agentId = task.backend === "paseo" && task.endpoint ? task.endpoint : "";
  let view: AgentView | null = null;
  try {
    view = useAgent(agentId, (agent) => ({
      status: agent.status,
      attentionReason: agent.attentionReason,
      paseoProfileName: agent.labels["foreman.paseoProfileName"] ?? null,
      routingProfile: agent.labels["foreman.routingProfile"] ?? null,
    }));
  } catch {
    // Surfaces without agent state fall back to the Foreman task status.
    view = null;
  }
  return view;
}
