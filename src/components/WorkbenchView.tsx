import { useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Play,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';
import type {
  AccessRequestInput,
  BenchmarkCase,
  DeviceRecord,
  EmployeeRecord,
  OrchestrationReport,
  OrchestrationStepEvent,
} from '../shared/types';
import { HubSpokeDiagram } from './HubSpokeDiagram';

interface WorkbenchViewProps {
  devices: DeviceRecord[];
  employees: EmployeeRecord[];
  presets: BenchmarkCase[];
  geminiConfigured: boolean;
  request: AccessRequestInput;
  onChangeRequest: (next: AccessRequestInput) => void;
  report: OrchestrationReport | null;
  steps: OrchestrationStepEvent[];
  isRunning: boolean;
  error: string | null;
  includeGemini: boolean;
  onToggleGemini: (val: boolean) => void;
  onRunOrchestration: () => void;
}

export function WorkbenchView({
  devices,
  employees,
  presets,
  geminiConfigured,
  request,
  onChangeRequest,
  report,
  steps,
  isRunning,
  error,
  includeGemini,
  onToggleGemini,
  onRunOrchestration,
}: WorkbenchViewProps) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    presets[0]?.case_id ?? 'custom',
  );
  const [selectedEnvelopeIdx, setSelectedEnvelopeIdx] = useState<number>(0);
  const [nlPrompt, setNlPrompt] = useState<string>('');
  const [nlLoading, setNlLoading] = useState<boolean>(false);
  const [nlError, setNlError] = useState<string | null>(null);

  const handleSelectPreset = (caseId: string) => {
    setSelectedPresetId(caseId);
    const found = presets.find((p) => p.case_id === caseId);
    if (found) {
      onChangeRequest({ ...found.request });
    }
  };

  const handleParseNl = async () => {
    if (!nlPrompt.trim()) return;
    setNlLoading(true);
    setNlError(null);
    try {
      const res = await fetch('/api/orchestrate/parse-nl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: nlPrompt }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to parse request');
      }
      setSelectedPresetId('custom');
      onChangeRequest(data.request);
    } catch (err) {
      setNlError(err instanceof Error ? err.message : 'Natural-language parse error');
    } finally {
      setNlLoading(false);
    }
  };

  const envelopes = report?.message_trace ?? steps.map((s) => s.envelope).filter((e): e is NonNullable<typeof e> => Boolean(e));
  const activeEnvelope = envelopes[selectedEnvelopeIdx] ?? envelopes[0] ?? null;

  const renderFindingBadge = (finding: OrchestrationReport['finding']) => {
    if (finding === 'Supported') {
      return (
        <span className="inline-flex items-center gap-1.5 font-semibold text-green-700">
          <CheckCircle2 className="w-4 h-4" />
          Supported
        </span>
      );
    }
    if (finding === 'PolicyBlocked_Moratorium') {
      return (
        <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
          <Ban className="w-4 h-4" />
          PolicyBlocked_Moratorium
        </span>
      );
    }
    if (finding === 'NotSupported') {
      return (
        <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
          <ShieldAlert className="w-4 h-4" />
          NotSupported
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 font-semibold text-amber-700">
        <AlertTriangle className="w-4 h-4" />
        Inconclusive
      </span>
    );
  };

  const knownHosts = devices.map((d) => d.hostname);
  const hostInInventory = knownHosts.includes(request.target_host);
  const userInRoster = employees.some((e) => e.user_id === request.user_id);

  return (
    <div className="space-y-6">
      {/* Request Configuration Panel */}
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Access Request & Scenario Runner
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Load a Phase 4 verification scenario, draft from natural language,
              or customize request parameters.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label
              htmlFor="preset-select"
              className="text-xs font-medium text-slate-700 whitespace-nowrap"
            >
              Scenario Preset
            </label>
            <select
              id="preset-select"
              value={selectedPresetId}
              onChange={(e) => handleSelectPreset(e.target.value)}
              className="h-9 px-3 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            >
              <option value="custom">Custom Request</option>
              {presets.map((p) => (
                <option key={p.case_id} value={p.case_id}>
                  {p.case_id}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Optional Natural-Language Request Extractor */}
        <div className="mt-4 flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={nlPrompt}
            onChange={(e) => setNlPrompt(e.target.value)}
            placeholder="Describe an access request (e.g. 'netadmin needs 45m emergency break-fix on vpn-gw-01 at 02:00Z after reboot failure')"
            className="flex-1 h-10 px-3 text-sm bg-slate-50 border border-slate-200 rounded-md text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
          />
          <button
            type="button"
            onClick={() => void handleParseNl()}
            disabled={nlLoading || !nlPrompt.trim() || !geminiConfigured}
            title={
              geminiConfigured
                ? 'Extract structured payload using gemini-4-hydrogen'
                : 'GEMINI_API_KEY not configured'
            }
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {nlLoading ? 'Parsing...' : 'Draft with Gemini'}
          </button>
        </div>
        {nlError && (
          <p className="mt-2 text-xs text-red-700">{nlError}</p>
        )}

        {/* Structured Input Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mt-5">
          <div>
            <label
              htmlFor="req-user"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Operator (user_id)
            </label>
            <select
              id="req-user"
              value={userInRoster ? request.user_id : '__custom__'}
              onChange={(e) => {
                setSelectedPresetId('custom');
                if (e.target.value !== '__custom__') {
                  onChangeRequest({ ...request, user_id: e.target.value });
                }
              }}
              className="w-full h-9 px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
            >
              {employees.map((emp) => (
                <option key={emp.user_id} value={emp.user_id}>
                  {emp.user_id} (max {emp.max_session_ttl_minutes}m)
                </option>
              ))}
              {!userInRoster && (
                <option value="__custom__">{request.user_id} (unlisted)</option>
              )}
            </select>
          </div>

          <div>
            <label
              htmlFor="req-host"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Target Host
            </label>
            <select
              id="req-host"
              value={hostInInventory ? request.target_host : '__custom__'}
              onChange={(e) => {
                setSelectedPresetId('custom');
                if (e.target.value !== '__custom__') {
                  onChangeRequest({ ...request, target_host: e.target.value });
                }
              }}
              className="w-full h-9 px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
            >
              {devices.map((d) => (
                <option key={d.hostname} value={d.hostname}>
                  {d.hostname}
                </option>
              ))}
              {!hostInInventory && (
                <option value="__custom__">
                  {request.target_host || '(empty)'} (unlisted)
                </option>
              )}
            </select>
          </div>

          <div>
            <label
              htmlFor="req-start"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Window Start (UTC)
            </label>
            <input
              id="req-start"
              type="text"
              value={request.window_start}
              onChange={(e) => {
                setSelectedPresetId('custom');
                onChangeRequest({ ...request, window_start: e.target.value });
              }}
              className="w-full h-9 px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
            />
          </div>

          <div>
            <label
              htmlFor="req-end"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Window End (UTC)
            </label>
            <input
              id="req-end"
              type="text"
              value={request.window_end}
              onChange={(e) => {
                setSelectedPresetId('custom');
                onChangeRequest({ ...request, window_end: e.target.value });
              }}
              className="w-full h-9 px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
            />
          </div>

          <div>
            <label
              htmlFor="req-ttl"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Requested TTL (min)
            </label>
            <input
              id="req-ttl"
              type="number"
              min={1}
              max={240}
              value={request.requested_ttl_minutes ?? 30}
              onChange={(e) => {
                setSelectedPresetId('custom');
                onChangeRequest({
                  ...request,
                  requested_ttl_minutes: Number(e.target.value),
                });
              }}
              className="w-full h-9 px-2.5 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900"
            />
          </div>
        </div>

        <div className="mt-4">
          <label
            htmlFor="req-claim"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Claimed Issue / Justification (Untrusted Input Field)
          </label>
          <textarea
            id="req-claim"
            rows={2}
            value={request.claimed_issue}
            onChange={(e) => {
              setSelectedPresetId('custom');
              onChangeRequest({ ...request, claimed_issue: e.target.value });
            }}
            className="w-full p-2.5 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-4 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-5 text-xs text-slate-700">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={request.is_break_fix}
                onChange={(e) => {
                  setSelectedPresetId('custom');
                  onChangeRequest({
                    ...request,
                    is_break_fix: e.target.checked,
                  });
                }}
                className="rounded border-slate-300 text-slate-900"
              />
              <span>Emergency Break-Fix (is_break_fix)</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(request.simulate_timeout)}
                onChange={(e) => {
                  setSelectedPresetId('custom');
                  onChangeRequest({
                    ...request,
                    simulate_timeout: e.target.checked,
                  });
                }}
                className="rounded border-slate-300 text-slate-900"
              />
              <span>Simulate Telemetry Timeout</span>
            </label>

            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={includeGemini}
                disabled={!geminiConfigured}
                onChange={(e) => onToggleGemini(e.target.checked)}
                className="rounded border-slate-300 text-slate-900 disabled:opacity-40"
              />
              <span className={!geminiConfigured ? 'text-slate-400' : ''}>
                Include Gemini Audit Synthesis
              </span>
            </label>
          </div>

          <button
            type="button"
            onClick={onRunOrchestration}
            disabled={isRunning}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            {isRunning ? 'Executing Pipeline...' : 'Run Orchestration'}
          </button>
        </div>
      </section>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Decision Summary Strip */}
      {report && (
        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div>
              <div className="text-xs text-slate-500">Policy Finding</div>
              <div className="mt-1.5 text-base">
                {renderFindingBadge(report.finding)}
              </div>
              <div className="mt-1 text-xs font-mono text-slate-500">
                Winner: {report.winning_hypothesis} · Depth{' '}
                {report.max_depth_evaluated}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">
                Access Broker Decision
              </div>
              <div
                className={`mt-1.5 font-mono text-base font-semibold ${
                  report.pam_decision === 'APPROVED_JIT'
                    ? 'text-green-700'
                    : 'text-slate-900'
                }`}
              >
                {report.pam_decision}
                {report.grant_final_state
                  ? ` · ${report.grant_final_state.status}`
                  : ''}
              </div>
              <div className="mt-1 text-xs text-slate-600 truncate" title={report.pam_reason}>
                {report.grant_final_state
                  ? `${report.grant_final_state.safe_name} · ${report.grant_final_state.ttl_minutes}m TTL`
                  : report.pam_reason}
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">
                Protected Null (H4) & Margin
              </div>
              <div className="mt-1.5 font-mono text-base font-semibold text-slate-900 tabular-nums">
                H4 {report.h4_score.toFixed(4)} ·{' '}
                {report.margin_over_h4 >= 0 ? '+' : ''}
                {report.margin_over_h4.toFixed(4)}
              </div>
              <div className="mt-1 text-xs font-mono text-slate-500 tabular-nums">
                Tie gap: {report.tie_gap.toFixed(4)} (delta{' '}
                {report.policy_eval.tie_delta.toFixed(2)})
              </div>
            </div>

            <div>
              <div className="text-xs text-slate-500">Blind Critic Audit</div>
              <div
                className={`mt-1.5 font-mono text-base font-semibold ${
                  report.critic_verdict === 'APPROVED'
                    ? 'text-green-700'
                    : 'text-amber-700'
                }`}
              >
                {report.critic_verdict}
              </div>
              <div className="mt-1 text-xs font-mono text-slate-500 tabular-nums">
                {report.trace_message_count} envelopes · {report.duration_ms} ms
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Hub-and-Spoke Topology & Envelope Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Hub-and-Spoke Topology & Live Execution
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                All inter-agent traffic routes through the central orchestrator
                with validated message envelopes.
              </p>
            </div>
            {isRunning && (
              <span className="inline-flex items-center gap-1.5 text-xs font-mono text-slate-700">
                <Clock className="w-3.5 h-3.5" />
                Streaming...
              </span>
            )}
          </div>

          <div className="mt-4">
            <HubSpokeDiagram
              steps={steps}
              envelopes={envelopes}
              isRunning={isRunning}
              selectedEnvelopeIndex={selectedEnvelopeIdx}
              onSelectEnvelope={(idx) => setSelectedEnvelopeIdx(idx)}
            />
          </div>

          {steps.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-200 space-y-2">
              <div className="text-xs font-semibold text-slate-700">
                Execution Hop Log
              </div>
              <div className="divide-y divide-slate-100 text-xs">
                {steps.map((s, idx) => (
                  <div
                    key={`${s.step}-${idx}`}
                    className="py-2 flex items-baseline justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-900">
                        {s.label}
                      </span>
                      <span aria-hidden="true" className="mx-2 text-slate-300">
                        ·
                      </span>
                      <span className="text-slate-600">{s.detail}</span>
                    </div>
                    <span className="font-mono text-slate-500 shrink-0 tabular-nums">
                      +{s.duration_ms}ms
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 flex flex-col">
          <div className="pb-3 border-b border-slate-200">
            <h3 className="text-base font-semibold text-slate-900">
              Validated AgentEnvelope Trace
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Select a hop to inspect communication mode, untrusted field
              tagging, and payload.
            </p>
          </div>

          {envelopes.length === 0 ? (
            <div className="flex-1 flex items-center justify-center py-12 text-xs text-slate-500">
              Run an orchestration request to inspect validated AgentEnvelopes.
            </div>
          ) : (
            <div className="mt-4 flex-1 flex flex-col gap-4">
              <div className="flex flex-wrap gap-1 p-1 bg-slate-100 rounded-md">
                {envelopes.map((env, idx) => (
                  <button
                    key={`${env.source_agent}-${env.target_agent}-${idx}`}
                    type="button"
                    onClick={() => setSelectedEnvelopeIdx(idx)}
                    className={`px-2.5 py-1.5 text-xs font-mono rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedEnvelopeIdx === idx
                        ? 'bg-white text-slate-900 shadow-xs font-semibold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {idx + 1}. {env.target_agent}
                  </button>
                ))}
              </div>

              {activeEnvelope && (
                <div className="space-y-3 text-xs">
                  <dl className="grid grid-cols-2 gap-2 p-3 bg-slate-50 border border-slate-200 rounded-md">
                    <div>
                      <dt className="text-slate-500">Route</dt>
                      <dd className="font-mono font-medium text-slate-900">
                        {activeEnvelope.source_agent} &rarr;{' '}
                        {activeEnvelope.target_agent}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Communication Mode</dt>
                      <dd className="font-mono font-medium text-slate-900">
                        {activeEnvelope.communication_mode}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Untrusted Fields</dt>
                      <dd className="font-mono text-slate-800">
                        {activeEnvelope.untrusted_data_fields.length > 0
                          ? activeEnvelope.untrusted_data_fields.join(', ')
                          : 'none'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-slate-500">Clarification Retries</dt>
                      <dd className="font-mono text-slate-800">
                        {activeEnvelope.clarification_attempts} / 1
                      </dd>
                    </div>
                  </dl>

                  <pre className="p-3 bg-slate-900 text-slate-100 rounded-md font-mono text-[11px] leading-relaxed overflow-x-auto max-h-64">
                    {JSON.stringify(activeEnvelope.payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Gemini 4 Hydrogen Audit Synthesis */}
      {report?.gemini_synthesis && (
        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <h3 className="text-base font-semibold text-slate-900">
              Gemini Audit Synthesis ({report.gemini_synthesis.model})
            </h3>
            <span className="text-xs font-mono text-slate-500">
              Structured Grounded Brief
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-4 text-sm">
            <div>
              <h4 className="text-xs font-semibold text-slate-700 mb-1.5">
                Executive Summary
              </h4>
              <p className="text-slate-700 leading-relaxed text-xs">
                {report.gemini_synthesis.executive_summary}
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-700 mb-1.5">
                Hypothesis & ToT Rationale
              </h4>
              <p className="text-slate-700 leading-relaxed text-xs">
                {report.gemini_synthesis.hypothesis_narrative}
              </p>
            </div>
            <div>
              <h4 className="text-xs font-semibold text-slate-700 mb-1.5">
                Security Posture Note
              </h4>
              <p className="text-slate-700 leading-relaxed text-xs">
                {report.gemini_synthesis.security_posture_note}
              </p>
            </div>
          </div>
        </section>
      )}

      {report?.gemini_error && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
          Gemini synthesis unavailable: {report.gemini_error}
        </div>
      )}

      {/* Tree-of-Thought Beam Search Matrix & Security Controls */}
      {report && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex items-baseline justify-between gap-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Tree-of-Thought Hypothesis Matrix
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Beam width 2 + protected H4 null hypothesis evaluated across 3
                  reasoning depths.
                </p>
              </div>
              <div className="font-mono text-xs text-slate-600">
                Retained: {report.policy_eval.beam_retained.join(', ')}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-2.5 px-4">Hypothesis</th>
                    <th className="py-2.5 px-3 text-right">Evid (0.35)</th>
                    <th className="py-2.5 px-3 text-right">Corrob (0.25)</th>
                    <th className="py-2.5 px-3 text-right">Fit (0.20)</th>
                    <th className="py-2.5 px-3 text-right">NoCon (0.20)</th>
                    <th className="py-2.5 px-4 text-right">Weighted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {report.policy_eval.all_scores.map((h) => {
                    const isWinner = h.id === report.winning_hypothesis;
                    const isPruned =
                      report.policy_eval.pruned_hypotheses.includes(h.id);
                    return (
                      <tr
                        key={h.id}
                        className={isWinner ? 'bg-slate-50 font-medium' : ''}
                      >
                        <td className="py-3 px-4">
                          <div className="font-mono font-semibold text-slate-900">
                            {h.id}
                            {h.id === 'H4' ? ' (Protected Null)' : ''}
                            {isWinner ? ' · Winner' : ''}
                            {isPruned ? ' · Pruned' : ''}
                          </div>
                          <div className="text-slate-600 mt-0.5">{h.label}</div>
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                          {h.scores.evidence_match.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                          {h.scores.independent_corroboration.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                          {h.scores.fit_to_requested_change.toFixed(2)}
                        </td>
                        <td className="py-3 px-3 text-right font-mono tabular-nums text-slate-700">
                          {h.scores.no_contradiction.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-slate-900">
                          {h.weighted_score.toFixed(4)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 flex flex-wrap gap-6 text-xs font-mono text-slate-600">
              {report.policy_eval.depth_traces.map((dt) => (
                <span key={dt.depth}>
                  Depth {dt.depth}: retained [{dt.retained_ids.join(',')}] · top{' '}
                  {dt.top_non_null} ({dt.top_non_null_score.toFixed(3)}) vs H4 (
                  {dt.h4_score.toFixed(3)})
                </span>
              ))}
            </div>
          </section>

          <section className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-6 space-y-5">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Security Guardrails & PAM Runtime Audit
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Sanitization, policy filtering, Blind Critic objections, and
                CyberArk command revocation.
              </p>
            </div>

            <div className="space-y-3 text-xs border-t border-slate-200 pt-4">
              <div>
                <span className="font-semibold text-slate-800">
                  Prompt Injection Sanitizer:
                </span>{' '}
                {report.redacted_directives.length > 0 ? (
                  <span className="text-red-700 font-medium">
                    Redacted {report.redacted_directives.length} directive(s):{' '}
                    <span className="font-mono">
                      {report.redacted_directives.join(', ')}
                    </span>
                  </span>
                ) : (
                  <span className="text-slate-600">
                    No injection directives detected.
                  </span>
                )}
              </div>

              <div>
                <span className="font-semibold text-slate-800">
                  Policies Evaluated:
                </span>{' '}
                <span className="font-mono text-green-700">
                  Active [{report.policies_used.join(', ')}]
                </span>
                <span aria-hidden="true" className="mx-1.5 text-slate-300">
                  ·
                </span>
                <span className="font-mono text-slate-500">
                  Ignored [{report.superseded_policies_ignored.join(', ')}]
                </span>
              </div>

              <div>
                <span className="font-semibold text-slate-800">
                  Intake Retry & Timeout State:
                </span>{' '}
                <span className="text-slate-600">
                  Clarification retried:{' '}
                  {report.clarification_retried ? 'Yes (1/1)' : 'No'} · Timeout
                  fallback: {report.timeout_fallback ? 'Triggered' : 'No'}
                </span>
              </div>

              <div>
                <span className="font-semibold text-slate-800">
                  Blind Critic Objections:
                </span>{' '}
                {report.critic_objections.length > 0 ? (
                  <span className="text-amber-800">
                    {report.critic_objections.join(' ')}
                  </span>
                ) : (
                  <span className="text-slate-600">None</span>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <div className="text-xs font-semibold text-slate-800 mb-2">
                CyberArk PAM Grant & Runtime Audit Log
              </div>
              {report.grant_final_state ? (
                <div className="space-y-2 text-xs">
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-md font-mono space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-600">Grant ID:</span>
                      <span className="text-slate-900 font-semibold">
                        {report.grant_final_state.grant_id}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Safe / TTL:</span>
                      <span className="text-slate-900">
                        {report.grant_final_state.safe_name} ·{' '}
                        {report.grant_final_state.ttl_minutes}m
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-600">Final Status:</span>
                      <span
                        className={
                          report.grant_final_state.status === 'REVOKED'
                            ? 'text-red-700 font-semibold'
                            : 'text-green-700 font-semibold'
                        }
                      >
                        {report.grant_final_state.status}
                      </span>
                    </div>
                    {report.grant_final_state.revoked_reason && (
                      <div className="pt-1 text-red-700">
                        {report.grant_final_state.revoked_reason}
                      </div>
                    )}
                  </div>

                  {report.runtime_audit.length > 0 && (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-md">
                      {report.runtime_audit.map((ev) => (
                        <div key={ev.event_id} className="p-2.5 space-y-1">
                          <div className="flex justify-between font-mono">
                            <span className="text-slate-600">{ev.event_id}</span>
                            <span
                              className={
                                ev.action === 'SESSION_REVOKED'
                                  ? 'text-red-700 font-semibold'
                                  : 'text-green-700'
                              }
                            >
                              {ev.action}
                            </span>
                          </div>
                          <div className="font-mono text-slate-800">
                            {ev.command}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-xs text-slate-600">
                  No JIT grant issued ({report.pam_reason}).
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Evidence Telemetry Table */}
      {report && (
        <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-wrap items-baseline justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Scoped Evidence & Corroborating Telemetry
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Target host Splunk events (+/-2h window) and fw-edge-01
                corroboration logs.
              </p>
            </div>
            <div className="font-mono text-xs text-slate-600">
              Cited IDs:{' '}
              {report.cited_splunk_event_ids.length > 0
                ? report.cited_splunk_event_ids.join(', ')
                : 'None'}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4 whitespace-nowrap">Event ID</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Timestamp</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Host</th>
                  <th className="py-2.5 px-4 whitespace-nowrap">Severity</th>
                  <th className="py-2.5 px-4">Message</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {report.evidence.splunk_events.length === 0 &&
                report.evidence.corroborating_events.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="py-8 px-4 text-center text-slate-500"
                    >
                      No telemetry events collected in the requested window.
                    </td>
                  </tr>
                ) : (
                  [
                    ...report.evidence.splunk_events,
                    ...report.evidence.corroborating_events,
                  ]
                    .slice(0, 25)
                    .map((ev) => {
                      const isCited = report.cited_splunk_event_ids.includes(
                        ev.event_id ?? '',
                      );
                      return (
                        <tr
                          key={`${ev.event_id}-${ev.host}`}
                          className={isCited ? 'bg-slate-50/80' : ''}
                        >
                          <td className="py-2.5 px-4 font-mono text-slate-700 whitespace-nowrap">
                            {ev.event_id}
                            {isCited ? ' *' : ''}
                          </td>
                          <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                            {ev.timestamp}
                          </td>
                          <td className="py-2.5 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                            {ev.host}
                          </td>
                          <td
                            className={`py-2.5 px-4 font-mono font-semibold whitespace-nowrap ${
                              ev.severity === 'CRITICAL' ||
                              ev.severity === 'ERROR'
                                ? 'text-red-700'
                                : ev.severity === 'WARNING'
                                  ? 'text-amber-700'
                                  : 'text-slate-600'
                            }`}
                          >
                            {ev.severity}
                          </td>
                          <td className="py-2.5 px-4 text-slate-700">
                            {ev.message}
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
