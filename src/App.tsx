/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  Database,
  FileCheck2,
  GitFork,
  Menu,
  Play,
  ShieldCheck,
  X,
} from 'lucide-react';
import type {
  AccessRequestInput,
  BenchmarkCase,
  BenchmarkSummary,
  DeviceRecord,
  EmployeeRecord,
  JiraChangeRequest,
  JiraIncident,
  MoratoriumRecord,
  OrchestrationReport,
  OrchestrationStepEvent,
  PolicyChunk,
  SafeConfig,
  SimulatedRuntimeEvent,
  ToTRubricConfig,
  ValidationReport,
} from './shared/types';
import { AccessPortalView } from './components/AccessPortalView';
import { BenchmarkView } from './components/BenchmarkView';
import { FixturesView } from './components/FixturesView';
import { TelemetryView } from './components/TelemetryView';
import { WorkbenchView } from './components/WorkbenchView';

type ViewMode = 'portal' | 'workbench' | 'benchmark' | 'telemetry' | 'fixtures';

interface FixturesPayload {
  validation: ValidationReport;
  devices: DeviceRecord[];
  employees: EmployeeRecord[];
  change_requests: JiraChangeRequest[];
  incidents: JiraIncident[];
  moratoriums: MoratoriumRecord[];
  policies: PolicyChunk[];
  cyberark_safes: Record<string, SafeConfig>;
  simulated_runtime_events: SimulatedRuntimeEvent[];
  rubric_config: ToTRubricConfig;
  benchmark_presets: BenchmarkCase[];
}

const DEFAULT_REQUEST: AccessRequestInput = {
  request_id: 'portal-req-01',
  user_id: 'app_svc_01',
  target_host: 'srv-web-01',
  window_start: '2025-11-17T06:00:00Z',
  window_end: '2025-11-17T06:30:00Z',
  is_break_fix: false,
  claimed_issue: 'Renew expired TLS certificate for portal.corp.local',
  requested_ttl_minutes: 25,
};

const NAV_ITEMS: Array<{
  id: ViewMode;
  label: string;
  breadcrumb: string;
  icon: typeof GitFork;
}> = [
  {
    id: 'workbench',
    label: 'Orchestrator Workbench',
    breadcrumb: 'Hub-and-Spoke Workbench',
    icon: GitFork,
  },
  {
    id: 'benchmark',
    label: 'Adversarial & Safety Evaluation Suite',
    breadcrumb: 'Adversarial & Safety Evaluation',
    icon: ShieldCheck,
  },
  {
    id: 'telemetry',
    label: 'Splunk MCP',
    breadcrumb: 'Scoped Telemetry Explorer',
    icon: Activity,
  },
  {
    id: 'fixtures',
    label: 'Policies & PAM',
    breadcrumb: 'Policy Store, Safes & Inventory',
    icon: Database,
  },
];

export default function App() {
  const [viewMode, setViewMode] = useState<ViewMode>('portal');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [fixtures, setFixtures] = useState<FixturesPayload | null>(null);
  const [geminiConfigured, setGeminiConfigured] = useState(false);
  const [fixturesLoading, setFixturesLoading] = useState(true);
  const [fixturesError, setFixturesError] = useState<string | null>(null);

  const [request, setRequest] = useState<AccessRequestInput>(DEFAULT_REQUEST);
  const [includeGemini, setIncludeGemini] = useState(false);
  const [report, setReport] = useState<OrchestrationReport | null>(null);
  const [steps, setSteps] = useState<OrchestrationStepEvent[]>([]);
  const [orchRunning, setOrchRunning] = useState(false);
  const [orchError, setOrchError] = useState<string | null>(null);

  const [benchmarkSummary, setBenchmarkSummary] =
    useState<BenchmarkSummary | null>(null);
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [benchmarkError, setBenchmarkError] = useState<string | null>(null);

  const runOrchestrationStream = useCallback(
    async (reqToRun: AccessRequestInput, withGemini: boolean) => {
      setOrchRunning(true);
      setOrchError(null);
      setSteps([]);
      setReport(null);

      try {
        const res = await fetch('/api/orchestrate/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request: reqToRun,
            include_gemini_synthesis: withGemini,
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error(`Orchestration stream failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';

          for (const block of blocks) {
            const lines = block.split('\n');
            let eventName = 'message';
            let dataStr = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                eventName = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                dataStr = line.slice(6);
              }
            }
            if (!dataStr) continue;
            const parsed = JSON.parse(dataStr);
            if (eventName === 'step') {
              setSteps((prev) => [...prev, parsed as OrchestrationStepEvent]);
            } else if (eventName === 'complete') {
              setReport(parsed as OrchestrationReport);
            } else if (eventName === 'error') {
              throw new Error(parsed.error || 'Orchestration error');
            }
          }
        }
      } catch (err) {
        setOrchError(
          err instanceof Error ? err.message : 'Orchestration failed',
        );
      } finally {
        setOrchRunning(false);
      }
    },
    [],
  );

  const runBenchmarkSuite = useCallback(async () => {
    setBenchmarkRunning(true);
    setBenchmarkError(null);
    try {
      const res = await fetch('/api/benchmark/run', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Benchmark run failed');
      }
      setBenchmarkSummary(data.phase4_evaluation as BenchmarkSummary);
    } catch (err) {
      setBenchmarkError(
        err instanceof Error ? err.message : 'Benchmark execution failed',
      );
    } finally {
      setBenchmarkRunning(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      setFixturesLoading(true);
      setFixturesError(null);
      try {
        const [healthRes, fixRes] = await Promise.all([
          fetch('/api/health'),
          fetch('/api/fixtures'),
        ]);
        if (!healthRes.ok || !fixRes.ok) {
          throw new Error('Failed to load orchestration fixtures from server.');
        }
        const healthData = await healthRes.json();
        const fixData = (await fixRes.json()) as FixturesPayload;
        if (cancelled) return;

        setGeminiConfigured(Boolean(healthData.gemini_configured));
        setFixtures(fixData);

        const initialReq =
          fixData.benchmark_presets[0]?.request ?? DEFAULT_REQUEST;
        setRequest(initialReq);
        void runOrchestrationStream(initialReq, false);
      } catch (err) {
        if (!cancelled) {
          setFixturesError(
            err instanceof Error ? err.message : 'Failed to initialize',
          );
        }
      } finally {
        if (!cancelled) {
          setFixturesLoading(false);
        }
      }
    }
    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, [runOrchestrationStream]);

  const currentNav = NAV_ITEMS.find((n) => n.id === viewMode) ?? NAV_ITEMS[0]!;

  const handleInspectFromBenchmark = (
    req: AccessRequestInput,
    rep: OrchestrationReport,
  ) => {
    setRequest(req);
    setReport(rep);
    setSteps(
      rep.message_trace.map((env) => ({
        step:
          env.target_agent === 'intake'
            ? 'intake'
            : env.target_agent === 'evidence'
              ? 'evidence'
              : env.target_agent === 'access_broker'
                ? 'access_broker'
                : env.target_agent === 'reporter'
                  ? 'reporter'
                  : env.communication_mode === 'tot_internal'
                    ? 'tot_eval'
                    : 'policy_ctx',
        label: `${env.source_agent} -> ${env.target_agent}`,
        detail: `Mode: ${env.communication_mode}`,
        envelope: env,
        duration_ms: env.timestamp_ms ?? 0,
      })),
    );
    setViewMode('workbench');
  };

  if (fixturesLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-700 text-sm font-medium">
        Loading PAM AI Assistant multi-agent orchestration engine & fixtures...
      </div>
    );
  }

  if (fixturesError || !fixtures) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-50 text-red-800 text-sm p-6">
        {fixturesError ?? 'Unable to initialize application.'}
      </div>
    );
  }

  // If in portal view mode, render the minimalist consumer/operator access request portal
  if (viewMode === 'portal') {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 p-4 sm:p-8">
        <AccessPortalView
          devices={fixtures.devices}
          employees={fixtures.employees}
          geminiConfigured={geminiConfigured}
          request={request}
          onChangeRequest={setRequest}
          report={report}
          steps={steps}
          isRunning={orchRunning}
          error={orchError}
          onRunOrchestration={(reqToRun, withGem) => {
            void runOrchestrationStream(reqToRun, withGem);
          }}
          onOpenDashboards={() => setViewMode('workbench')}
        />
      </div>
    );
  }

  // Otherwise, render the policy and validation management dashboards
  return (
    <div className="min-h-screen flex bg-slate-50 text-slate-900">
      {/* Desktop Sidebar (248px) */}
      <aside className="hidden lg:flex lg:flex-col lg:w-62 lg:shrink-0 bg-white border-r border-slate-200">
        <div className="h-16 px-6 flex items-center justify-between border-b border-slate-200">
          <button
            type="button"
            onClick={() => setViewMode('portal')}
            className="font-display text-base font-bold tracking-tight text-slate-900 hover:text-slate-600 transition-colors cursor-pointer"
            title="Return to Access Request Portal"
          >
            PAM AI Assistant
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1" aria-label="Primary Navigation">
          <button
            type="button"
            onClick={() => setViewMode('portal')}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors whitespace-nowrap cursor-pointer mb-3 border border-slate-200 bg-slate-50"
          >
            <span>&larr; Back to Access Portal</span>
          </button>

          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = viewMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setViewMode(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md transition-colors text-left leading-snug cursor-pointer ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {fixtures && (
          <div className="p-4 border-t border-slate-200 text-xs text-slate-600 space-y-1.5">
            <div className="flex items-center gap-1.5 font-medium text-slate-900">
              <FileCheck2 className="w-3.5 h-3.5 text-green-700" />
              <span>
                Fixtures{' '}
                {fixtures.validation.ok ? 'Validated' : 'Validation Error'}
              </span>
            </div>
            <div className="font-mono text-[11px] text-slate-500 tabular-nums">
              {fixtures.validation.stats.splunk_event_count} events ·{' '}
              {fixtures.validation.stats.inventory_device_count} hosts
            </div>
            <div className="font-mono text-[11px] text-slate-500 tabular-nums">
              {fixtures.validation.stats.active_policy_count} active /{' '}
              {fixtures.validation.stats.superseded_policy_count} stale
              policies
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Navigation Drawer */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative w-64 bg-white h-full border-r border-slate-200 flex flex-col z-10">
            <div className="h-16 px-5 flex items-center justify-between border-b border-slate-200">
              <span className="font-display text-base font-bold text-slate-900">
                PAM AI Assistant
              </span>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close navigation"
                className="p-2 text-slate-600 hover:text-slate-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav className="p-4 space-y-1">
              <button
                type="button"
                onClick={() => {
                  setViewMode('portal');
                  setMobileNavOpen(false);
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md text-slate-900 bg-slate-100 mb-2"
              >
                <span>&larr; Back to Access Portal</span>
              </button>
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = viewMode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setViewMode(item.id);
                      setMobileNavOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-md transition-colors ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 px-4 sm:px-8 bg-white border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open navigation"
              className="lg:hidden p-2 -ml-2 text-slate-600 hover:text-slate-900"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <button
                type="button"
                onClick={() => setViewMode('portal')}
                className="text-slate-500 hover:text-slate-900 font-medium transition-colors cursor-pointer hidden sm:inline"
              >
                Access Portal
              </button>
              <span
                aria-hidden="true"
                className="text-slate-300 hidden sm:inline"
              >
                /
              </span>
              <span className="font-semibold text-slate-900 truncate">
                {currentNav.breadcrumb}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('portal')}
              className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors cursor-pointer"
            >
              Back to Portal
            </button>

            {viewMode === 'benchmark' ? (
              <button
                type="button"
                onClick={() => void runBenchmarkSuite()}
                disabled={benchmarkRunning}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                {benchmarkRunning ? 'Running Suite...' : 'Run Benchmark Suite'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setViewMode('benchmark');
                  if (!benchmarkSummary) {
                    void runBenchmarkSuite();
                  }
                }}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                Verify 13-Case Suite
              </button>
            )}
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-8 max-w-[1440px] w-full mx-auto">
          {viewMode === 'workbench' && (
            <WorkbenchView
              devices={fixtures.devices}
              employees={fixtures.employees}
              presets={fixtures.benchmark_presets}
              geminiConfigured={geminiConfigured}
              request={request}
              onChangeRequest={setRequest}
              report={report}
              steps={steps}
              isRunning={orchRunning}
              error={orchError}
              includeGemini={includeGemini}
              onToggleGemini={setIncludeGemini}
              onRunOrchestration={() =>
                void runOrchestrationStream(request, includeGemini)
              }
            />
          )}

          {viewMode === 'benchmark' && (
            <BenchmarkView
              presets={fixtures.benchmark_presets}
              summary={benchmarkSummary}
              running={benchmarkRunning}
              error={benchmarkError}
              onRunBenchmark={() => void runBenchmarkSuite()}
              onInspectReport={handleInspectFromBenchmark}
            />
          )}

          {viewMode === 'telemetry' && (
            <TelemetryView devices={fixtures.devices} />
          )}

          {viewMode === 'fixtures' && (
            <FixturesView
              devices={fixtures.devices}
              employees={fixtures.employees}
              policies={fixtures.policies}
              safes={fixtures.cyberark_safes}
              runtimeEvents={fixtures.simulated_runtime_events}
              changeRequests={fixtures.change_requests}
              incidents={fixtures.incidents}
              moratoriums={fixtures.moratoriums}
              rubricConfig={fixtures.rubric_config}
            />
          )}
        </main>
      </div>
    </div>
  );
}
