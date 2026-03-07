// IDs and constants (enums per repo conventions)

export enum ResourceId {
  // Server
  ServerApp = "app",
  NotesStore = "notesStore",
  AuditStore = "auditStore",
  ServerCommunicator = "serverCommunicator",
  ServerRpcLanes = "serverRpcLanes",

  // Client
  ClientApp = "app",
  ClientCommunicator = "clientCommunicator",
  MemoryCommunicator = "memoryCommunicator",
  ClientRpcLanes = "clientRpcLanes",
}

export enum TaskId {
  // Server tasks
  CreateNote = "createNote",
  ListNotes = "listNotes",
  LogAudit = "logAudit",
  ListAudits = "listAudits",

  // Client tasks
  Demo = "demo",
}

// rpcLanes transmits resolved runtime task ids, not raw local task ids.
export const RuntimeTaskId = {
  CreateNote: `${ResourceId.ClientApp}.tasks.${TaskId.CreateNote}`,
  ListNotes: `${ResourceId.ClientApp}.tasks.${TaskId.ListNotes}`,
  LogAudit: `${ResourceId.ClientApp}.tasks.${TaskId.LogAudit}`,
  ListAudits: `${ResourceId.ClientApp}.tasks.${TaskId.ListAudits}`,
} as const;

export enum RpcProfile {
  Server = "server",
  Client = "client",
}

export enum HttpConfig {
  BasePath = "/__runner",
  Host = "127.0.0.1",
}

export enum Protocol {
  Http = "http://",
}

export enum AuthToken {
  Dev = "dev-secret",
}

export enum EnvVar {
  Token = "RUNNER_EXAMPLE_TOKEN",
  RunNetTests = "RUNNER_TEST_NET",
}
