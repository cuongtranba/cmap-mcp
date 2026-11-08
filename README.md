# cmap-mcp

A CLI and MCP server that give coding agents (Claude Code, Codex, Cursor and others) read access to the public data on [cmap.vn](https://cmap.vn), the culture map of Vietnam: cultural events, community activities, deals, places and provinces.

Status: under construction. See [docs/design.md](docs/design.md) for the design and the investigation of the upstream API.

The data belongs to cmap.vn and its operator. This project fetches it at runtime from the site's public API, caches it locally, and links every record back to its page on cmap.vn.
