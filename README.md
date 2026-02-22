# React Tasks

A React task app with:

- markdown-backed task storage (`server/tasks/*.md`)
- a local Node API (`server/index.js`)
- tag-based filtering (multi-select)
- task edit modal
- logbook view for task/tag delete and completion events

## Run Locally

Install dependencies:

```bash
npm install
```

Start the markdown API (port `3001`):

```bash
npm run api
```

In a second terminal, start the Vite frontend (port `5173`):

```bash
npm run dev
```

Open:

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001`

## Available Scripts

- `npm run dev` - Start Vite dev server
- `npm run api` - Start local Node API for markdown task storage
- `npm run build` - Build production frontend
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## Data Storage

Task files are stored as markdown with frontmatter:

- `server/tasks/*.md`

Example fields:

- `id`
- `title`
- `tags`
- `done`
- `order`
- `createdAt`
- `updatedAt`

Task description content is stored in the markdown body.

## Logbook

The app records task and tag events in a logbook file used by the Logbook view:

- `server/logbook/logbook.jsonl`

This file is runtime data and is intentionally ignored by Git.

## Notes

- The Vite dev server proxies `/api/*` requests to `http://localhost:3001`.
- Sample task markdown files are included so the app has useful first-run data.
