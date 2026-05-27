import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Config } from './config.js';
import { PKG_NAME, PKG_VERSION } from './version.js';

export interface ToolHandler {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handle(args: Record<string, unknown>): Promise<unknown>;
}

export function buildServer(config: Config, extraTools: ToolHandler[] = []): Server {
  const server = new Server(
    { name: PKG_NAME, version: PKG_VERSION },
    { capabilities: { tools: {} } },
  );

  const tools: ToolHandler[] = [makeHealthTool(config), ...extraTools];
  const byName = new Map(tools.map((t) => [t.name, t]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const tool = byName.get(req.params.name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `tool not found: ${req.params.name}`);
    }
    try {
      const result = await tool.handle((req.params.arguments ?? {}) as Record<string, unknown>);
      return {
        content: [
          {
            type: 'text' as const,
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      if (err instanceof McpError) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      throw new McpError(ErrorCode.InternalError, msg);
    }
  });

  return server;
}

function makeHealthTool(config: Config): ToolHandler {
  return {
    name: 'kie_health',
    description:
      'Health probe for kie-mcp. Returns version, configured base URL, and whether API key is set.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async handle() {
      return {
        package: PKG_NAME,
        version: PKG_VERSION,
        api_base: config.apiBase,
        api_key_set: Boolean(config.apiKey),
        output_dir: config.outputDir,
        db_path: config.dbPath,
      };
    },
  };
}
