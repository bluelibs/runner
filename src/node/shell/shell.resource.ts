import { resource } from "../../definers/builders/resource";
import { runtimeResource } from "../../globals/resources/runtime.resource";
import { Match } from "../../tools/check";
import { defaultShellSocketPath } from "./socketPath";
import { ShellServer } from "./ShellServer";
import type { ShellConfig } from "./types";

/** Opt-in local socket shell attached to this container's live runtime. */
export const shellResource = resource<ShellConfig>("shell")
  .meta({
    title: "Runtime Shell",
    description:
      "Interactive local Unix socket access to this container's live runtime.",
  })
  .configSchema({
    socketPath: Match.Optional(Match.NonEmptyString),
    readOnly: Match.Optional(Boolean),
  })
  .dependencies({ runtime: runtimeResource })
  .init(
    async ({ socketPath = defaultShellSocketPath(), readOnly }, { runtime }) =>
      new ShellServer(socketPath, runtime, readOnly),
  )
  .ready(async (shell) => shell.listen())
  .cooldown(async (shell) => shell.close())
  .dispose(async (shell) => shell.close())
  .build();
