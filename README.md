# Workflow Builder

A visual, self-hosted workflow automation tool — similar to n8n or Make. Build automation pipelines by connecting nodes on a drag-and-drop canvas. Triggers, actions, and logic nodes execute real integrations on a Node.js backend.

![Workflow Builder](https://img.shields.io/badge/Node.js-18%2B-green) ![License](https://img.shields.io/badge/license-MIT-blue)

---

## What it does

- **Receive webhooks** — expose a unique URL that triggers your workflow when called
- **Send emails** — real SMTP email delivery via Nodemailer
- **HTTP requests** — call any external API (GET, POST, PUT, DELETE, PATCH)
- **Slack messages** — send notifications via Slack Incoming Webhooks
- **Run custom JS code** — execute JavaScript logic inside a sandboxed node
- **Filter & transform data** — process data flowing between nodes
- **Save & load workflows** — persist workflows to a local JSON file

---

## How it works

```
External request
      │
      ▼
POST /webhook/:id
      │
      ▼
  Execution engine
  (BFS traversal)
      │
  ┌───┴───┐
  ▼       ▼
Node A  Node B   ← runs in parallel if no dependency
  │       │
  └───┬───┘
      ▼
   Node C
      │
      ▼
  JSON response + execution log
```

Each node receives the output of its connected predecessor as input. Data flows as plain JSON objects between nodes. Template interpolation (`{{field}}`) lets you reference incoming data in email subjects, Slack messages, etc.

---

## Getting started

### Requirements

- Node.js 18+
- npm

### Installation

```bash
git clone https://github.com/aliyev-vusal/workflow-app.git
cd workflow-app
npm install
cp .env.example .env
```

### Configuration

Edit `.env`:

```env
PORT=3000

# Email (Gmail recommended)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your_app_password
```

> **Gmail App Password:** Go to [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), enable 2FA, then generate an App Password for "Mail".

### Run

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000)

---

## Node types

### Triggers
| Node | Description |
|------|-------------|
| **Webhook** | Exposes `POST /webhook/:id` — starts the workflow on HTTP request |
| **Schedule** | Placeholder for cron-based execution (configure with a scheduler) |

### Actions
| Node | Description |
|------|-------------|
| **HTTP Request** | Makes a real HTTP call to any URL. Supports GET/POST/PUT/DELETE/PATCH and custom headers |
| **Send Email** | Sends an email via SMTP. Subject and body support `{{field}}` templates |
| **Slack Message** | Posts a message via Slack Incoming Webhook URL |
| **Google Sheets** | Placeholder — connect your own Sheets API credentials |
| **Database** | Placeholder — add `DB_URL` to `.env` for a real DB connection |
| **Code** | Runs sandboxed JavaScript. `data` variable holds input, use `return` to pass output |

### Logic
| Node | Description |
|------|-------------|
| **IF Condition** | Evaluates a JS expression (`data.value > 0`). Adds `_passed: true/false` to output |
| **Filter** | Filters an array by field value. Operators: equal, contains, greater than, less than |
| **Transform** | Maps a field value — uppercase, lowercase, trim, or copy to a new field |
| **Merge** | Flattens arrays from multiple incoming branches |

---

## Webhook usage

1. Add a **Webhook** node to the canvas
2. Save the workflow — a unique webhook URL appears in the top bar
3. Trigger it from anywhere:

```bash
curl -X POST http://localhost:3000/webhook/YOUR_ID \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "email": "alice@example.com"}'
```

The incoming body is passed as `data` to the first node and flows through the entire workflow.

---

## Dynamic templates

In **Send Email** and **Slack Message** nodes, use `{{field}}` to inject values from the incoming data:

```
Subject: Welcome, {{name}}!
Body:    Your account ({{email}}) is ready.
```

---

## Example workflow

```
Webhook → Filter (email contains @) → Send Email (welcome message)
                                    ↘ Slack Message (notify team)
```

1. Drag a **Webhook** node onto the canvas
2. Add a **Filter** node — field: `email`, operator: `contains`, value: `@`
3. Add a **Send Email** node — recipient: `{{email}}`, subject: `Welcome {{name}}`
4. Add a **Slack Message** node — paste your Slack webhook URL, message: `New user: {{name}}`
5. Connect: Webhook → Filter → Send Email & Slack Message
6. Click **Save**, then **Run** or trigger via curl

---

## API reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/workflows` | List all workflows |
| `POST` | `/api/workflows` | Create a new workflow |
| `GET` | `/api/workflows/:id` | Get a workflow by ID |
| `PUT` | `/api/workflows/:id` | Update a workflow |
| `DELETE` | `/api/workflows/:id` | Delete a workflow |
| `POST` | `/api/workflows/:id/run` | Manually run a workflow |
| `ALL` | `/webhook/:webhookId` | Trigger a workflow via webhook |

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl + Scroll` | Zoom in/out |
| `Middle mouse` | Pan canvas |
| `Ctrl + Z` | Undo |
| `Ctrl + Y` | Redo |
| `Ctrl + D` | Duplicate selected node |
| `Double-click` node | Open settings panel |
| `Click` connection line | Delete connection |
| `Delete` / `Backspace` | Delete selected node |
| `Escape` | Deselect / close panel |

---

## Project structure

```
workflow-app/
├── server.js          # Express backend — API, webhook handler, execution engine
├── public/
│   └── index.html     # Frontend — visual canvas (vanilla HTML/CSS/JS)
├── workflows.json     # Saved workflows (auto-created on first save)
├── .env               # Your local config (not committed)
├── .env.example       # Config template
└── package.json
```

---

## License

MIT
