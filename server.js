require('dotenv').config();
const express  = require('express');
const fs       = require('fs');
const path     = require('path');
const vm       = require('vm');
const nodemailer = require('nodemailer');
const fetch    = require('node-fetch');
const { v4: uuid } = require('uuid');

const app  = express();
const PORT = process.env.PORT || 3000;
const DB   = path.join(__dirname, 'workflows.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── DB helpers ────────────────────────────────────────────────────────────
function load() {
    if (!fs.existsSync(DB)) return {};
    try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return {}; }
}
function save(data) { fs.writeFileSync(DB, JSON.stringify(data, null, 2)); }

// ─── Workflow CRUD ──────────────────────────────────────────────────────────
app.get('/api/workflows', (_req, res) => {
    res.json(Object.values(load()));
});

app.post('/api/workflows', (req, res) => {
    const db = load();
    const id = uuid();
    const webhookId = uuid().split('-')[0];
    const wf = { id, webhookId, name: 'New Workflow', ...req.body, createdAt: new Date().toISOString() };
    db[id] = wf;
    save(db);
    res.json(wf);
});

app.get('/api/workflows/:id', (req, res) => {
    const wf = load()[req.params.id];
    if (!wf) return res.status(404).json({ error: 'Not found' });
    res.json(wf);
});

app.put('/api/workflows/:id', (req, res) => {
    const db = load();
    if (!db[req.params.id]) return res.status(404).json({ error: 'Not found' });
    db[req.params.id] = { ...db[req.params.id], ...req.body, updatedAt: new Date().toISOString() };
    save(db);
    res.json(db[req.params.id]);
});

app.delete('/api/workflows/:id', (req, res) => {
    const db = load();
    if (!db[req.params.id]) return res.status(404).json({ error: 'Not found' });
    delete db[req.params.id];
    save(db);
    res.json({ success: true });
});

// ─── Webhook trigger ────────────────────────────────────────────────────────
app.all('/webhook/:webhookId', async (req, res) => {
    const wf = Object.values(load()).find(w => w.webhookId === req.params.webhookId);
    if (!wf) return res.status(404).json({ error: 'Webhook not found' });

    console.log(`[webhook] ${req.method} /webhook/${req.params.webhookId}`);
    try {
        const result = await runWorkflow(wf, {
            body: req.body,
            query: req.query,
            headers: req.headers,
            method: req.method,
        });
        res.json({ success: true, result });
    } catch (err) {
        console.error('[webhook error]', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Manuel run ────────────────────────────────────────────────────────────
app.post('/api/workflows/:id/run', async (req, res) => {
    const wf = load()[req.params.id];
    if (!wf) return res.status(404).json({ error: 'Not found' });

    try {
        const result = await runWorkflow(wf, req.body || {});
        res.json({ success: true, result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Execution engine ───────────────────────────────────────────────────────
async function runWorkflow(workflow, inputData) {
    const nodes = workflow.nodes || [];
    const conns = workflow.conns || [];
    if (!nodes.length) throw new Error('Workflow is empty');

    const hasIn  = new Set(conns.map(c => c.t));
    const starts = nodes.filter(n => !hasIn.has(n.id));
    if (!starts.length) starts.push(nodes[0]);

    const results  = {};
    const visited  = new Set();
    let   queue    = [...starts];
    const logs     = [];

    while (queue.length) {
        const level = [...queue];
        queue = [];

        await Promise.all(level.map(async node => {
            if (visited.has(node.id)) return;
            visited.add(node.id);

            const inData = getInput(node.id, conns, results, inputData);
            const t0 = Date.now();
            try {
                results[node.id] = await execNode(node, inData);
                logs.push({ node: node.name, type: node.type, status: 'ok', ms: Date.now()-t0, out: results[node.id] });
                console.log(`[ok] ${node.name} (${Date.now()-t0}ms)`);
            } catch (err) {
                results[node.id] = { error: err.message };
                logs.push({ node: node.name, type: node.type, status: 'error', error: err.message });
                console.error(`[err] ${node.name}: ${err.message}`);
            }

            conns.filter(c => c.f === node.id).forEach(c => {
                const next = nodes.find(n => n.id === c.t);
                if (next && !visited.has(next.id)) queue.push(next);
            });
        }));
    }

    return logs;
}

function getInput(nodeId, conns, results, inputData) {
    const inc = conns.filter(c => c.t === nodeId);
    if (!inc.length) return inputData;
    return results[inc[inc.length - 1].f] ?? inputData;
}

// ─── Node executor ──────────────────────────────────────────────────────────
async function execNode(node, data) {
    const s = node.settings || {};

    switch (node.type) {
        // Triggers — pass data through
        case 'webhook':
        case 'schedule':
            return data;

        // HTTP Request
        case 'http': {
            let headers = { 'Content-Type': 'application/json' };
            try { Object.assign(headers, s.headers ? JSON.parse(s.headers) : {}); } catch {}
            const opts = { method: s.method || 'GET', headers };
            if (['POST','PUT','PATCH'].includes(opts.method)) {
                opts.body = JSON.stringify(data);
            }
            const resp = await fetch(s.url, opts);
            const text = await resp.text();
            try { return JSON.parse(text); } catch { return { body: text, status: resp.status }; }
        }

        // Email
        case 'email': {
            if (!process.env.SMTP_USER) throw new Error('SMTP_USER not set in .env file');
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: false,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            });
            const info = await transporter.sendMail({
                from: process.env.SMTP_FROM || process.env.SMTP_USER,
                to:      interpolate(s.to,      data),
                subject: interpolate(s.subject, data),
                text:    interpolate(s.body,    data),
            });
            return { sent: true, messageId: info.messageId, to: s.to };
        }

        // Slack (Incoming Webhook)
        case 'slack': {
            const url = s.webhookUrl;
            if (!url) throw new Error('Slack Webhook URL is required (set it in node settings)');
            await fetch(url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ text: interpolate(s.message, data) || JSON.stringify(data) }),
            });
            return { sent: true, channel: s.channel };
        }

        // Database (placeholder — add DB_URL to .env for real connection)
        case 'database':
            return { note: 'Database node: add DB_URL to .env for a real connection', data };

        // Run custom code
        case 'code': {
            const sandbox = { data, items: Array.isArray(data) ? data : [data], result: undefined };
            const script  = new vm.Script(`result = (function(data, items){ ${s.code || 'return data;'} })(data, items)`);
            vm.createContext(sandbox);
            script.runInContext(sandbox, { timeout: 3000 });
            return sandbox.result !== undefined ? sandbox.result : data;
        }

        // IF condition
        case 'if': {
            const sandbox = { item: data, data };
            vm.createContext(sandbox);
            let pass = false;
            try {
                const script = new vm.Script(s.condition || 'true');
                pass = !!script.runInContext(sandbox, { timeout: 1000 });
            } catch {}
            return { ...( typeof data === 'object' ? data : {value:data} ), _passed: pass };
        }

        // Filter
        case 'filter': {
            const arr = Array.isArray(data) ? data : [data];
            return arr.filter(item => {
                const val = item[s.field];
                switch (s.operator) {
                    case 'eq':       return String(val) === String(s.value);
                    case 'contains': return String(val).includes(s.value);
                    case 'gt':       return parseFloat(val) > parseFloat(s.value);
                    case 'lt':       return parseFloat(val) < parseFloat(s.value);
                    default:         return true;
                }
            });
        }

        // Transform
        case 'transform': {
            const arr = Array.isArray(data) ? data : [data];
            return arr.map(item => {
                let val = item[s.source];
                if (s.operation === 'uppercase') val = String(val).toUpperCase();
                else if (s.operation === 'lowercase') val = String(val).toLowerCase();
                else if (s.operation === 'trim') val = String(val).trim();
                return { ...item, [s.target || s.source]: val };
            });
        }

        // Merge
        case 'merge':
            return Array.isArray(data) ? data.flat() : data;

        default:
            return data;
    }
}

// {{field}} template interpolation
function interpolate(str, data) {
    if (!str || typeof data !== 'object') return str || '';
    return str.replace(/\{\{(\w+)\}\}/g, (_, k) => data[k] ?? '');
}

// ─── Start ─────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║  Workflow Builder                      ║
║  http://localhost:${PORT}                  ║
║  Webhook: http://localhost:${PORT}/webhook/ID ║
╚════════════════════════════════════════╝
`);
});
