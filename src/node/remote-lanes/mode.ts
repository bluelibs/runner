export type RemoteLanesMode = "network" | "transparent" | "local-simulated";

export function resolveRemoteLanesMode(
  mode?: RemoteLanesMode,
): RemoteLanesMode {
  return mode ?? "network";
}
