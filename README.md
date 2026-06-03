# RhizoDoc

RhizoDoc is a local-first AI document workspace that turns long documents, notes, and prompts into an explorable Markdown DAG (directed acyclic graph). It provides an infinite canvas for reading, annotating, expanding, saving, and loading knowledge nodes, with optional LLM generation through the Pi model registry.

> UI language is currently Chinese. The app uses a Vite + TypeScript browser client and a lightweight Express + TypeScript API server.

## Features

- **Infinite document canvas**: drag, zoom, fit-to-screen, and navigate a graph of Markdown nodes.
- **Markdown rendering**: node content is rendered with `marked` and sanitized with `DOMPurify`, with syntax highlighting powered by Highlight.js and LaTeX formula rendering powered by KaTeX.
- **AI-assisted expansion**:
  - generate the first/root document from a prompt;
  - select text and generate linked child nodes;
  - right-click nodes to expand or regenerate content;
  - right-click the canvas to create independent nodes.
- **Traceable annotations**: selected text is highlighted and visually connected to generated child nodes.
- **Persistence**:
  - download/load flow JSON files in the browser;
  - save/load flow JSON files through the local Node server.
- **Provider flexibility**: uses Pi's model registry/auth settings by default, with RhizoDoc-specific overrides in `rhizodoc.config.json`.
- **Runtime validation**: shared browser/server schemas validate config, LLM payloads, and flow JSON.

## Tech Stack

- Node.js 20+
- TypeScript
- Express 5
- Vite 8
- Vanilla browser ESM
- marked + DOMPurify
- Highlight.js + KaTeX
- Zod
- Vitest, ESLint, Prettier

## Quick Start

```bash
git clone https://github.com/wsdx233/RhizoDoc.git
cd RhizoDoc
pnpm install
```

Create a RhizoDoc config file:

```bash
cp rhizodoc.config.example.json rhizodoc.config.json
```

Configure your default model in Pi:

```bash
pi
# then use /model to select a provider/model and configure credentials
```

Optionally edit `rhizodoc.config.json` to override the Pi provider/model for this project only.

Start a production-style local server:

```bash
pnpm build
pnpm start
```

Open:

```text
http://localhost:3000
```

For development, run the API server and Vite dev server together:

```bash
pnpm dev
```

Then open the Vite URL, usually:

```text
http://localhost:5173
```

## Configuration

RhizoDoc uses `rhizodoc.config.json` for app-specific settings. The file is intentionally ignored by Git; commit `rhizodoc.config.example.json` instead.

```json
{
  "$schema": "./src/shared/config.schema.json",
  "server": {
    "port": 3000,
    "jsonLimit": "20mb"
  },
  "pi": {
    "provider": "",
    "model": "",
    "thinkingLevel": "off",
    "maxTokens": 12000
  },
  "storage": {
    "flowsDir": "data/flows"
  }
}
```

| Field | Default | Description |
| --- | --- | --- |
| `server.port` | `3000` | Express server port. Can also be overridden by `--port`. |
| `server.jsonLimit` | `20mb` | JSON request body limit. |
| `pi.provider` | Pi default provider | Optional project-only Pi provider override. Empty string means use Pi default. |
| `pi.model` | Pi default model | Optional project-only Pi model override. Empty string means use Pi default. |
| `pi.thinkingLevel` | Pi default thinking level or `off` | Thinking/reasoning level passed to compatible models. |
| `pi.maxTokens` | `12000` | Max output tokens requested from the model, capped by model settings. |
| `storage.flowsDir` | `data/flows` | Directory for server-saved flow JSON files. Relative paths resolve from the project root. |

CLI options use Node's built-in `node:util.parseArgs`:

```bash
pnpm start -- --port 3003
pnpm start -- --config ./my.rhizodoc.json
```

RhizoDoc asks the model to return plain text where the first line is the node title and the remaining lines are Markdown content.

## Project Structure

```text
.
├── index.html                    # Vite HTML entry
├── src/
│   ├── client/                   # Browser app modules
│   │   ├── main.ts
│   │   ├── api.ts
│   │   └── styles.css
│   ├── shared/                   # Browser/server shared schemas and types
│   │   ├── config.ts
│   │   ├── config.schema.json
│   │   ├── schemas.ts
│   │   ├── schemas.test.ts
│   │   └── types.ts
│   └── vite-env.d.ts
├── prototype/                    # Earlier standalone UI prototypes
├── data/flows/                   # Local server-saved flow JSON files (ignored by Git)
├── dist/                         # Vite build output (ignored by Git)
├── server.ts                     # Express server + LLM/flow APIs
├── rhizodoc.config.example.json  # Commit-safe example config
├── rhizodoc.config.json          # Local config (ignored by Git)
├── tsconfig.json
├── vite.config.js
├── eslint.config.js
├── pnpm-workspace.yaml
├── package.json
└── .gitignore
```

## Privacy and Security

- Real API keys should stay in Pi auth storage or other local secret storage only.
- `rhizodoc.config.json`, `.env`, `.env.*`, `node_modules/`, `dist/`, logs, and local generated flow JSON files are ignored by Git.
- Browser-opened local documents are read in the browser. Server-saved flows are written under `data/flows/` and are treated as local runtime data.

## Useful Scripts

```bash
pnpm start       # start Express; requires pnpm build for the browser client
pnpm dev         # run Express API + Vite dev server
pnpm dev:api     # API server only
pnpm dev:web     # Vite dev server only
pnpm build       # production client build into dist/
pnpm preview     # build, then serve with Express
pnpm typecheck   # run TypeScript checks
pnpm test        # run Vitest tests
pnpm lint        # run ESLint
pnpm format      # run Prettier
pnpm check       # typecheck + lint + test + build
```

## Notes

RhizoDoc is designed as a local-first research/document exploration tool. It is suitable for local experimentation, knowledge mapping, and iterative document expansion workflows.
