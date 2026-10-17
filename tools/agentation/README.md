# Agentation integration — MIDAD Control Room

## Audit result (2026-10-17)

- The deployed Control Room is a static HTML/CSS/vanilla-JavaScript application, not a React app.
- The entry point is `index.html`; the primary runtime is `midad-control-v2.js`; styling is in `midad-control-v2.css`.
- GitHub Pages deploys the repository root via `.github/workflows/pages.yml`.
- Agentation's official toolbar is a React component and requires React 18+. Therefore, do **not** import it into the current vanilla-JS runtime or add a root package.json just to force the integration. That would risk the existing static deployment.
- The MCP server is a local developer tool; registering it in a repository does not make the GitHub Pages site able to reach a developer's localhost, nor does it connect this server to the current ChatGPT conversation.

## Included in this change

`.codex/config.toml` registers the Agentation MCP server for Codex in a trusted local checkout. Codex may ask you to trust the project before using project-level configuration. It runs:

```bash
npx -y agentation-mcp server
```

Node.js 20+ is required by current Agentation MCP documentation; Node.js 24 LTS is recommended.

## Verify the local MCP server

From the repository root on a developer computer with Node.js installed:

```bash
npx -y agentation-mcp doctor
```

Then restart/reload Codex MCP servers and inspect the available Agentation tools. To verify the end-to-end path, a compatible React development preview must mount the `Agentation` component with `endpoint="http://localhost:4747"`; add one test annotation and ask Codex to list pending annotations. Do not mark end-to-end integration verified until the annotation text is returned by the MCP tool.

## Next safe integration step

Keep the production Control Room untouched. If a React-based MIDAD UI already exists in another repository, integrate the official Agentation component there. Otherwise, create an isolated React development preview that loads the existing Control Room UI for visual review, and test it separately before considering any production architecture change. Do not migrate the deployed Control Room from vanilla JS to React as part of this integration without a separate audit and approval.

## Security

- Keep the MCP server bound to localhost for local development.
- Do not expose port 4747 publicly or add secrets to this repository.
- Annotation text may contain user-entered content; treat it as untrusted input.
- MCP setup is a developer-local capability, not a production endpoint.
