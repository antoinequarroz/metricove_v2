import "server-only";
import { toolByName, ToolError, TOOLS } from "./tools";

/**
 * A Model Context Protocol server, "Streamable HTTP" transport, stateless: every POST carries one
 * JSON-RPC message (or a batch) and gets its answer as plain JSON. No session, no stream to keep
 * open: it fits a Next.js route. See https://modelcontextprotocol.io/specification
 */

export const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_VERSION = SUPPORTED_VERSIONS[0];

const INSTRUCTIONS = `Metricove est le calendrier éditorial et l'outil de publication multi-comptes d'Antoine (Instagram, TikTok, YouTube, Facebook, X, LinkedIn).
Accès en lecture seule : tu peux lire le calendrier, les comptes, les projets, les posts, la médiathèque et les statistiques, sans rien modifier ni publier.
Un projet regroupe les comptes d'une marque (par exemple LivreMatch) : passe project à get_calendar ou list_posts pour ne voir que ses posts.
Les heures et les jours sont donnés dans le fuseau d'Antoine.`;

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const result = (id: unknown, value: unknown) => ({ jsonrpc: "2.0", id, result: value });
const error = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Answers one message. Null for a notification (no id): nothing to send back. */
export function handleMessage(msg: unknown): Json | null {
  if (!isObj(msg) || msg.jsonrpc !== "2.0") return error(null, -32600, "Invalid Request");
  const { id, method, params } = msg;
  if (id === undefined) return null;
  if (typeof method !== "string") return error(id, -32600, "Invalid Request");
  if (typeof id !== "string" && typeof id !== "number") return error(null, -32600, "Invalid Request");
  const p = isObj(params) ? params : {};

  switch (method) {
    case "initialize": {
      const asked = typeof p.protocolVersion === "string" ? p.protocolVersion : "";
      return result(id, {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : LATEST_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "metricove", title: "Metricove", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return result(id, {});
    case "tools/list":
      return result(id, {
        tools: TOOLS.map(({ name, title, description, inputSchema }) => ({ name, title, description, inputSchema, annotations: { title, readOnlyHint: true, openWorldHint: false } })),
      });
    case "tools/call": {
      const tool = toolByName(p.name);
      if (!tool) return error(id, -32602, `Unknown tool: ${String(p.name)}`);
      try {
        const out = tool.run(isObj(p.arguments) ? p.arguments : {});
        return result(id, { content: [{ type: "text", text: JSON.stringify(out, null, 1) }], isError: false });
      } catch (e) {
        if (e instanceof ToolError) return result(id, { content: [{ type: "text", text: e.message }], isError: true });
        console.error("[mcp]", tool.name, e);
        return result(id, { content: [{ type: "text", text: "Erreur interne de Metricove." }], isError: true });
      }
    }
    // Asked by some clients even when not announced: empty lists rather than an error.
    case "resources/list":
      return result(id, { resources: [] });
    case "resources/templates/list":
      return result(id, { resourceTemplates: [] });
    case "prompts/list":
      return result(id, { prompts: [] });
    default:
      return error(id, -32601, `Method not found: ${method}`);
  }
}

/** Answers a POST body: one message or a batch. Null when only notifications came (HTTP 202). */
export function handleBody(body: unknown): Json | Json[] | null {
  if (Array.isArray(body)) {
    if (!body.length || body.length > 50) return error(null, -32600, "Invalid Request");
    const out = body.map(handleMessage).filter((r): r is Json => r !== null);
    return out.length ? out : null;
  }
  return handleMessage(body);
}
