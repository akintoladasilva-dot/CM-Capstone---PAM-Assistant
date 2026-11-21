import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AccessRequestInput } from './src/shared/types.ts';
import {
  buildDefaultBenchmarkSuite,
  runBenchmark,
} from './src/server/benchmark.ts';
import {
  parseNaturalLanguageRequest,
  synthesizeOrchestrationAudit,
} from './src/server/geminiAdvisor.ts';
import { Phase1MockStore } from './src/server/mockStore.ts';
import { HubAndSpokeOrchestrator } from './src/server/orchestrator.ts';

const PORT =
  process.env.NODE_ENV === 'production'
    ? Number(process.env.PORT ?? 3000)
    : 3000;

const store = new Phase1MockStore();
store.loadAll();
const validationReport = store.validateAll();
if (!validationReport.ok) {
  console.error('Fixture validation failed:', validationReport.errors);
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: validationReport.ok,
    gemini_configured: Boolean(process.env.GEMINI_API_KEY),
    stats: validationReport.stats,
  });
});

app.get('/api/fixtures', (_req, res) => {
  res.json({
    validation: validationReport,
    devices: store.devices,
    employees: store.employees,
    change_requests: store.changeRequests,
    incidents: store.incidents,
    moratoriums: store.moratoriums,
    policies: store.policies,
    cyberark_safes: store.cyberarkSafes,
    simulated_runtime_events: store.simulatedRuntimeEvents,
    rubric_config: store.rubricConfig,
    benchmark_presets: buildDefaultBenchmarkSuite(),
  });
});

app.post('/api/splunk/query', (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      host?: string | null;
      window_start?: string | null;
      window_end?: string | null;
      window_padding_hours?: number;
      severity_in?: string[] | null;
      keyword_regex?: string | null;
    };
    const result = store.querySplunk({
      host: body.host || null,
      windowStart: body.window_start || null,
      windowEnd: body.window_end || null,
      windowPaddingHours:
        typeof body.window_padding_hours === 'number'
          ? body.window_padding_hours
          : 2.0,
      severityIn: body.severity_in?.length ? body.severity_in : null,
      keywordRegex: body.keyword_regex || null,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Invalid Splunk query',
    });
  }
});

app.post('/api/orchestrate', async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      request?: AccessRequestInput;
      include_gemini_synthesis?: boolean;
    };
    const rawReq = body.request;
    if (!rawReq || typeof rawReq !== 'object') {
      res.status(400).json({ error: 'Missing request payload' });
      return;
    }
    const orch = new HubAndSpokeOrchestrator(store);
    const report = await orch.runRequest(rawReq);

    if (body.include_gemini_synthesis) {
      try {
        report.gemini_synthesis = await synthesizeOrchestrationAudit(report);
      } catch (gemErr) {
        report.gemini_error =
          gemErr instanceof Error
            ? gemErr.message
            : 'Gemini audit synthesis failed';
      }
    }

    res.json(report);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Orchestration failed',
    });
  }
});

app.post('/api/orchestrate/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const body = (req.body ?? {}) as {
      request?: AccessRequestInput;
      include_gemini_synthesis?: boolean;
    };
    const rawReq = body.request;
    if (!rawReq || typeof rawReq !== 'object') {
      sendEvent('error', { error: 'Missing request payload' });
      res.end();
      return;
    }

    const orch = new HubAndSpokeOrchestrator(store);
    const report = await orch.runRequest(rawReq, (step) => {
      sendEvent('step', step);
    });

    if (body.include_gemini_synthesis) {
      sendEvent('step', {
        step: 'gemini_synthesis',
        label: 'Gemini Agent Audit Synthesis',
        detail: 'Generating grounded security rationale with gemini-4-hydrogen',
        duration_ms: report.duration_ms,
      });
      try {
        report.gemini_synthesis = await synthesizeOrchestrationAudit(report);
      } catch (gemErr) {
        report.gemini_error =
          gemErr instanceof Error
            ? gemErr.message
            : 'Gemini audit synthesis failed';
      }
    }

    sendEvent('complete', report);
    res.end();
  } catch (err) {
    sendEvent('error', {
      error: err instanceof Error ? err.message : 'Orchestration failed',
    });
    res.end();
  }
});

app.post('/api/orchestrate/parse-nl', async (req, res) => {
  try {
    const body = (req.body ?? {}) as { prompt?: string };
    const prompt = (body.prompt ?? '').trim();
    if (!prompt) {
      res.status(400).json({ error: 'Prompt is required.' });
      return;
    }
    const parsed = await parseNaturalLanguageRequest(
      prompt,
      store.devices.map((d) => d.hostname),
      store.employees.map((e) => e.user_id),
    );
    res.json({ request: parsed });
  } catch (err) {
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Failed to parse natural-language request',
    });
  }
});

app.post('/api/benchmark/run', async (_req, res) => {
  try {
    const summary = await runBenchmark(store);
    res.json({
      phase1_validation: validationReport,
      phase4_evaluation: summary,
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'Benchmark execution failed',
    });
  }
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    process.env.DISABLE_HMR = 'true';
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });

    // Serve a WebSocket-free client shim when HMR is disabled so CSS updates
    // and import.meta.hot calls succeed without opening a failing ws://24678 socket.
    app.get('/@vite/client', (_req, res) => {
      res.type('application/javascript; charset=utf-8');
      res.send(`const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== 'undefined') {
  document.querySelectorAll('style[data-vite-dev-id]').forEach((el) => {
    sheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
}
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id)) return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (linkSheetsMap.has(id)) {
    document
      .querySelectorAll('link[rel="stylesheet"][data-vite-dev-id="' + CSS.escape(id) + '"]')
      .forEach((el) => el.remove());
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style) {
    style.remove();
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  return {
    data: {},
    accept() {},
    acceptExports() {},
    dispose() {},
    decline() {},
    invalidate() {},
    on() {},
    off() {},
    send() {},
    prune() {},
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const { search, hash } = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (search ? '&' + search.slice(1) : '') + (hash || '');
}
export class ErrorOverlay extends (globalThis.HTMLElement || class {}) {}
`);
    });

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Build artifacts not found.');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sentinel PAM Orchestrator listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
