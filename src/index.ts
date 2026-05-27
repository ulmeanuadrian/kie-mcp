#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { loadConfig, Config } from './config.js';
import { buildServer } from './server.js';
import { KieClient } from './client.js';
import { buildKieTools } from './tools.js';

async function main(): Promise<void> {
  const config: Config = loadConfig(process.env);
  const client = new KieClient(config);
  const tools = buildKieTools({ client, config });
  const server: Server = buildServer(config, tools);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export { ListToolsRequestSchema, CallToolRequestSchema, ErrorCode, McpError };

main().catch((err) => {
  console.error('[kie-mcp] fatal:', err);
  process.exit(1);
});
