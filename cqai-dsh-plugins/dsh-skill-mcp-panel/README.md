# Desktop-adapted dsh-skill-mcp-panel

This is a source snapshot of [Fishquito7/dsh-skill-mcp-panel](https://github.com/Fishquito7/dsh-skill-mcp-panel) at commit `b85a4a33e51ef2586ab0884a7988a88f37cafd0e` (v2.1.3), licensed under MIT; see [LICENSE](LICENSE).

The product adaptation moves the Skills and MCP page contributions from the home sidebar into 易宝工坊's **Plugin management** left navigation. The server-side skill, MCP, and CLI behavior remains upstream's. Desktop builds compile this workspace before packaging it. When updating from upstream, review the `src/client.ts` slot registration, page back control, and `dsh.client.inject` changes together.
