export interface McpTrustPolicy {
  enabled: boolean;
  allowTools: string[];
  allowResources?: boolean;
  allowPrompts?: boolean;
  inheritEnv?: string[];
}

export interface McpServerConfig {
  transport?: 'stdio' | 'http';
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  bearerTokenEnv?: string;
  headers?: Record<string, string>;
  trust: McpTrustPolicy;
}

export interface McpClient {
  readonly name: string;
  connect(): Promise<void>;
  listTools(): Promise<McpTool[]>;
  listResources(): Promise<McpResource[]>;
  listPrompts(): Promise<McpPrompt[]>;
  readResource(uri: string, signal?: AbortSignal): Promise<unknown>;
  getPrompt(name: string, args: unknown, signal?: AbortSignal): Promise<unknown>;
  callTool(name: string, args: unknown, signal?: AbortSignal): Promise<unknown>;
  close(): void | Promise<void>;
}

export interface McpConfig { servers: Record<string, McpServerConfig>; }
export interface McpTool { name: string; description?: string; inputSchema: Record<string, unknown>; }
export interface McpResource { uri: string; name: string; description?: string; mimeType?: string; }
export interface McpPrompt { name: string; description?: string; arguments?: unknown[]; }
