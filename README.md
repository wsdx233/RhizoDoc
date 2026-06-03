# RhizoDoc

RhizoDoc is a local-first AI document workspace that turns long documents, notes, and prompts into an explorable Markdown DAG (directed acyclic graph). It provides an infinite canvas for reading, annotating, expanding, saving, and loading knowledge nodes, with optional LLM generation through OpenAI Responses or Chat Completions compatible APIs.

> UI language is currently Chinese. The server and configuration are intentionally lightweight: plain Node.js + Express, no build step required.

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
- **Provider flexibility**: supports OpenAI Responses API, Chat Completions API, and OpenAI-compatible base URLs.

## Tech Stack

- Node.js 18+
- Express 5
- OpenAI Node SDK
- marked + DOMPurify
- Highlight.js + KaTeX
- Vanilla HTML/CSS/JavaScript

## Quick Start

```bash
git clone https://github.com/wsdx233/RhizoDoc.git
cd RhizoDoc
npm install
cp .env.example .env
```

Edit `.env` and add your own API key:

```env
OPENAI_API_KEY=your-api-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1
OPENAI_API_TYPE=responses
OPENAI_REASONING_EFFORT=
PORT=3000
```

Start the app:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

For development with Node watch mode:

```bash
npm run dev
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `OPENAI_API_KEY` | Yes for LLM features | empty | API key for OpenAI or an OpenAI-compatible provider. |
| `OPENAI_BASE_URL` | No | `https://api.openai.com/v1` | API base URL. Replace it when using a compatible provider. |
| `OPENAI_MODEL` | No | `gpt-4.1` | Model used for node generation. |
| `OPENAI_API_TYPE` | No | `responses` | `responses`, `chat_completions`, or `auto`. |
| `OPENAI_REASONING_EFFORT` | No | empty | Optional reasoning effort. Leave blank if unsupported by your model/provider. |
| `PORT` | No | `3000` | Local server port. |

RhizoDoc asks the model to return plain text where the first line is the node title and the remaining lines are Markdown content. If a provider does not support reasoning parameters, RhizoDoc retries without them automatically.

## Project Structure

```text
.
├── public/              # Main browser app
│   ├── index.html
│   ├── app.js
│   └── styles.css
├── prototype/           # Earlier standalone UI prototypes
├── data/flows/          # Local server-saved flow JSON files (ignored by Git)
├── server.js            # Express server + LLM/flow APIs
├── package.json
├── .env.example         # Safe example configuration
└── .gitignore
```

## Privacy and Security

- Real API keys belong in `.env` only.
- `.env`, `.env.*`, `node_modules/`, logs, and local generated flow JSON files are ignored by Git.
- `.env.example` is safe to commit and contains placeholders only.
- Browser-opened local documents are read in the browser. Server-saved flows are written under `data/flows/` and are treated as local runtime data.

## Useful Scripts

```bash
npm start     # start the server
npm run dev   # start with node --watch
```

## Notes

RhizoDoc is designed as a lightweight research/document exploration tool. It is suitable for local experimentation, knowledge mapping, and iterative document expansion workflows.
