// IDs and constants (enums per repo conventions)

export enum ResourceId {
  // Server
  ServerApp = "example.tunnels.server.app",
  NotesStore = "example.tunnels.server.notesStore",
  AuditStore = "example.tunnels.server.auditStore",
  HttpExposurePolicy = "example.tunnels.server.httpExposurePolicy",
  ServerExposure = "example.tunnels.server.exposure",

  // Client
  ClientApp = "example.tunnels.client.app",
  TunnelClient = "example.tunnels.client.tunnel",
}

export enum TaskId {
  // Server tasks
  CreateNote = "example.tunnels.tasks.notes.create",
  ListNotes = "example.tunnels.tasks.notes.list",
  LogAudit = "example.tunnels.tasks.audit.log",
  ListAudits = "example.tunnels.tasks.audit.list",

  // Client tasks
  Demo = "example.tunnels.tasks.demo",
}

export enum TunnelTransport {
  Http = "http",
}

export enum TunnelMode {
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

