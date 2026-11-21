/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import {
  Activity,
  Database,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import type {
  ActiveEvidenceTelemetry,
  DebugDrawerTab,
} from './debugTypes';
import type {
  DeviceRecord,
  OrchestrationReport,
  OrchestrationStepEvent,
  SplunkEvent,
} from '../shared/types';

interface PortalDebugDrawerProps {
  devices: DeviceRecord[];
  steps: OrchestrationStepEvent[];
  report: OrchestrationReport | null;
  isRunning: boolean;
  turnLabel: string;
  onClose: () => void;
}

const SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;

export function PortalDebugDrawer({
  devices,
  steps,
  report,
  isRunning,
  turnLabel,
  onClose,
}: PortalDebugDrawerProps) {
  const [activeTab, setActiveTab] = useState<DebugDrawerTab>('stream');
  const [selectedStepIdx, setSelectedStepIdx] = useState<number>(0);

  // Ad-hoc Splunk query state
  const [splunkHost, setSplunkHost] = useState<string>('');
  const [splunkStart, setSplunkStart] = useState<string>('2025-11-17T00:00:00Z');
  const [splunkEnd, setSplunkEnd] = useState<string>('2025-11-17T23:59:59Z');
  const [splunkRegex, setSplunkRegex] = useState<string>('');
  const [splunkSeverities, setSplunkSeverities] = useState<string[]>([
    'WARNING',
    'ERROR',
    'CRITICAL',
  ]);
  const [splunkLoading, setSplunkLoading] = useState<boolean>(false);
  const [splunkError, setSplunkError] = useState<string | null>(null);
  const [splunkMatched, setSplunkMatched] = useState<number | null>(null);
  const [splunkResults, setSplunkResults] = useState<SplunkEvent[]>([]);

  // Auto-select latest step as stream progresses
  useEffect(() => {
    if (steps.length > 0) {
      setSelectedStepIdx(steps.length - 1);
    }
  }, [steps.length]);

  // Pre-seed ad-hoc Splunk query filters from latest report or intake telemetry
  useEffect(() => {
    const intakeStep = steps.find((s) => s.step === 'intake');
    const norm =
      report?.normalized_request ??
      (intakeStep?.telemetry?.normalized_request as
        | { target_host?: string; window_start?: string; window_end?: string }
        | undefined);
    if (norm?.target_host) {
      setSplunkHost(norm.target_host);
    }
    if (norm?.window_start) {
      setSplunkStart(norm.window_start);
    }
    if (norm?.window_end) {
      setSplunkEnd(norm.window_end);
    }
  }, [report, steps]);

  // Extract live evidence either from completed report or streamed evidence step
  const evidenceStep = steps.find((s) => s.step === 'evidence');
  const liveEvidence: ActiveEvidenceTelemetry | null = report
    ? {
        splunk_matched_count: report.evidence.splunk_matched_count,
        too_broad_gt_10000: report.evidence.too_broad_gt_10000,
        timeout_error: report.evidence.timeout_error ?? null,
        splunk_events: report.evidence.splunk_events,
        corroborating_events: report.evidence.corroborating_events,
        approved_crs: report.evidence.approved_crs,
        incidents: report.evidence.incidents,
        active_moratoriums: report.evidence.active_moratoriums,
      }
    : evidenceStep?.telemetry
      ? (evidenceStep.telemetry as unknown as ActiveEvidenceTelemetry)
      : null;

  const citedSet = new Set(report?.cited_splunk_event_ids ?? []);
  const activeStep = steps[selectedStepIdx] ?? steps[0] ?? null;

  const runAdhocSplunk = async () => {
    setSplunkLoading(true);
    setSplunkError(null);
    try {
      const res = await fetch('/api/splunk/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: splunkHost || null,
          window_start: splunkStart || null,
          window_end: splunkEnd || null,
          window_padding_hours: 2,
          severity_in: splunkSeverities,
          keyword_regex: splunkRegex || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Splunk query failed');
      }
      setSplunkMatched(data.matched_count ?? 0);
      setSplunkResults(data.events ?? []);
    } catch (err) {
      setSplunkError(err instanceof Error ? err.message : 'Splunk query failed');
    } finally {
      setSplunkLoading(false);
    }
  };

  const toggleSeverity = (sev: string) => {
    setSplunkSeverities((prev) =>
      prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev],
    );
  };

  const severityColor = (sev: string) => {
    if (sev === 'CRITICAL' || sev === 'ERROR') return 'text-red-700';
    if (sev === 'WARNING') return 'text-amber-700';
    return 'text-slate-600';
  };

  return (
    <aside
      aria-label="Debug Telemetry Drawer"
      className="bg-white border border-slate-200 rounded-xl flex flex-col h-full overflow-hidden shadow-2xs"
    >
      {/* Drawer Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-slate-700 shrink-0" />
            <h2 className="text-xs font-semibold text-slate-900 truncate">
              Debug Telemetry · {turnLabel}
            </h2>
          </div>
          <p className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">
            {isRunning
              ? `Streaming live (${steps.length} events)`
              : `${steps.length} step(s) captured`}
            {report ? ` · ${report.duration_ms}ms total` : ''}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close Debug Telemetry"
          className="p-1.5 text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 rounded-md transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="px-3 pt-2.5 border-b border-slate-200 flex items-center gap-1 shrink-0 bg-white">
        <button
          type="button"
          onClick={() => setActiveTab('stream')}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === 'stream'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Stream & Envelopes</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('evidence')}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === 'evidence'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          <span>
            Evidence
            {liveEvidence ? ` (${liveEvidence.splunk_matched_count})` : ''}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('splunk')}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
            activeTab === 'splunk'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Search className="w-3.5 h-3.5" />
          <span>Splunk Query</span>
        </button>
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'stream' && (
          <>
            {steps.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500">
                Submit a request in the chat to inspect live NL parser outputs,
                SSE step timings, and raw AgentEnvelope payloads.
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  {steps.map((s, idx) => {
                    const selected = idx === selectedStepIdx;
                    return (
                      <button
                        key={`${s.step}-${idx}`}
                        type="button"
                        onClick={() => setSelectedStepIdx(idx)}
                        className={`w-full text-left p-2.5 rounded-md border text-xs transition-colors cursor-pointer ${
                          selected
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-slate-50 text-slate-800 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-mono">
                          <span className="font-semibold truncate">
                            [{idx + 1}] {s.label}
                          </span>
                          <span
                            className={`text-[11px] shrink-0 tabular-nums ${
                              selected ? 'text-slate-300' : 'text-slate-500'
                            }`}
                          >
                            +{s.duration_ms}ms
                          </span>
                        </div>
                        <div
                          className={`text-[11px] mt-0.5 truncate ${
                            selected ? 'text-slate-300' : 'text-slate-600'
                          }`}
                        >
                          {s.detail}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {activeStep && (
                  <div className="space-y-3 pt-2 border-t border-slate-200">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-900">
                        Step Payload & Telemetry
                      </span>
                      <span className="font-mono text-[11px] text-slate-500">
                        step={activeStep.step}
                      </span>
                    </div>

                    {activeStep.envelope && (
                      <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md text-[11px] font-mono space-y-1">
                        <div className="text-slate-700">
                          Route: {activeStep.envelope.source_agent} &rarr;{' '}
                          {activeStep.envelope.target_agent} (
                          {activeStep.envelope.communication_mode})
                        </div>
                        <div className="text-slate-500">
                          Untrusted fields:{' '}
                          {activeStep.envelope.untrusted_data_fields.length > 0
                            ? activeStep.envelope.untrusted_data_fields.join(
                                ', ',
                              )
                            : 'none'}
                        </div>
                      </div>
                    )}

                    {activeStep.telemetry && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-600 mb-1">
                          Streamed Step Telemetry
                        </div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-md font-mono text-[11px] leading-relaxed overflow-x-auto max-h-64">
                          {JSON.stringify(activeStep.telemetry, null, 2)}
                        </pre>
                      </div>
                    )}

                    {activeStep.envelope && (
                      <div>
                        <div className="text-[11px] font-semibold text-slate-600 mb-1">
                          Validated AgentEnvelope Payload
                        </div>
                        <pre className="p-3 bg-slate-900 text-slate-100 rounded-md font-mono text-[11px] leading-relaxed overflow-x-auto max-h-56">
                          {JSON.stringify(activeStep.envelope.payload, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {activeTab === 'evidence' && (
          <>
            {!liveEvidence ? (
              <div className="py-12 text-center text-xs text-slate-500">
                No evidence telemetry captured yet for this turn. Evidence
                populates live as soon as EvidenceAgent finishes its MCP lookup.
              </div>
            ) : (
              <div className="space-y-4 text-xs">
                {liveEvidence.timeout_error && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-md text-amber-900">
                    Telemetry timeout fallback: {liveEvidence.timeout_error}
                  </div>
                )}

                {/* ITSM & Moratorium Summary */}
                <div className="grid grid-cols-3 gap-2 font-mono text-center">
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md">
                    <div className="text-[10px] text-slate-500">
                      Approved CRs
                    </div>
                    <div className="text-sm font-semibold text-slate-900 mt-0.5 tabular-nums">
                      {liveEvidence.approved_crs.length}
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md">
                    <div className="text-[10px] text-slate-500">Incidents</div>
                    <div className="text-sm font-semibold text-slate-900 mt-0.5 tabular-nums">
                      {liveEvidence.incidents.length}
                    </div>
                  </div>
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-md">
                    <div className="text-[10px] text-slate-500">
                      Moratoriums
                    </div>
                    <div
                      className={`text-sm font-semibold mt-0.5 tabular-nums ${
                        liveEvidence.active_moratoriums.length > 0
                          ? 'text-red-700'
                          : 'text-slate-900'
                      }`}
                    >
                      {liveEvidence.active_moratoriums.length}
                    </div>
                  </div>
                </div>

                {liveEvidence.active_moratoriums.length > 0 && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-md space-y-1">
                    <div className="font-semibold text-red-800">
                      Active Freeze / Moratorium
                    </div>
                    {liveEvidence.active_moratoriums.map((m) => (
                      <div
                        key={m.moratorium_id}
                        className="font-mono text-[11px] text-red-700"
                      >
                        {m.moratorium_id} ({m.target_zones.join(', ')}):{' '}
                        {m.reason}
                      </div>
                    ))}
                  </div>
                )}

                {(liveEvidence.approved_crs.length > 0 ||
                  liveEvidence.incidents.length > 0) && (
                  <div className="space-y-2">
                    {liveEvidence.approved_crs.map((cr) => (
                      <div
                        key={cr.cr_id}
                        className="p-2.5 bg-green-50/70 border border-green-200 rounded-md font-mono text-[11px]"
                      >
                        <span className="font-semibold text-green-800">
                          {cr.cr_id}
                        </span>{' '}
                        · {cr.status} · {cr.change_type} ({cr.window_start} ..{' '}
                        {cr.window_end})
                      </div>
                    ))}
                    {liveEvidence.incidents.map((inc) => (
                      <div
                        key={inc.inc_id}
                        className="p-2.5 bg-amber-50/70 border border-amber-200 rounded-md font-mono text-[11px]"
                      >
                        <span className="font-semibold text-amber-800">
                          {inc.inc_id}
                        </span>{' '}
                        · {inc.status}: {inc.summary}
                      </div>
                    ))}
                  </div>
                )}

                {/* Splunk & Corroborating Events */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-slate-800">
                      Matched Splunk & Firewall Events
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {liveEvidence.splunk_events.length} host ·{' '}
                      {liveEvidence.corroborating_events.length} fw-edge-01
                    </span>
                  </div>

                  {liveEvidence.splunk_events.length === 0 &&
                  liveEvidence.corroborating_events.length === 0 ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-md text-center text-slate-500">
                      Zero Splunk events matched in the +/-2h window.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 border border-slate-200 rounded-md overflow-hidden">
                      {[
                        ...liveEvidence.splunk_events,
                        ...liveEvidence.corroborating_events,
                      ].map((ev, idx) => {
                        const isCited = citedSet.has(ev.event_id ?? '');
                        return (
                          <div
                            key={`${ev.event_id ?? idx}-${ev.host}`}
                            className={`p-2.5 space-y-1 ${
                              isCited ? 'bg-amber-50/60' : 'bg-white'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 font-mono text-[11px]">
                              <span className="font-semibold text-slate-900">
                                {ev.event_id ?? `ev-${idx}`}
                                {isCited ? ' *Cited' : ''} · {ev.host}
                              </span>
                              <span
                                className={`font-semibold ${severityColor(ev.severity)}`}
                              >
                                {ev.severity}
                              </span>
                            </div>
                            <div className="text-[11px] font-mono text-slate-500">
                              {ev.timestamp}
                            </div>
                            <p className="text-[11px] text-slate-700 leading-snug">
                              {ev.message}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {activeTab === 'splunk' && (
          <div className="space-y-4 text-xs">
            <div className="space-y-3 p-3 bg-slate-50 border border-slate-200 rounded-md">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="dbg-splunk-host"
                    className="block text-[11px] font-medium text-slate-700 mb-1"
                  >
                    Host
                  </label>
                  <select
                    id="dbg-splunk-host"
                    value={splunkHost}
                    onChange={(e) => setSplunkHost(e.target.value)}
                    className="w-full h-8 px-2 text-xs font-mono bg-white border border-slate-300 rounded text-slate-900"
                  >
                    <option value="">All hosts</option>
                    {devices.map((d) => (
                      <option key={d.hostname} value={d.hostname}>
                        {d.hostname}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="dbg-splunk-regex"
                    className="block text-[11px] font-medium text-slate-700 mb-1"
                  >
                    Keyword Regex
                  </label>
                  <input
                    id="dbg-splunk-regex"
                    type="text"
                    value={splunkRegex}
                    onChange={(e) => setSplunkRegex(e.target.value)}
                    placeholder="e.g. TLS|timeout"
                    className="w-full h-8 px-2 text-xs font-mono bg-white border border-slate-300 rounded text-slate-900"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label
                    htmlFor="dbg-splunk-start"
                    className="block text-[11px] font-medium text-slate-700 mb-1"
                  >
                    Window Start (UTC)
                  </label>
                  <input
                    id="dbg-splunk-start"
                    type="text"
                    value={splunkStart}
                    onChange={(e) => setSplunkStart(e.target.value)}
                    className="w-full h-8 px-2 text-[11px] font-mono bg-white border border-slate-300 rounded text-slate-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor="dbg-splunk-end"
                    className="block text-[11px] font-medium text-slate-700 mb-1"
                  >
                    Window End (UTC)
                  </label>
                  <input
                    id="dbg-splunk-end"
                    type="text"
                    value={splunkEnd}
                    onChange={(e) => setSplunkEnd(e.target.value)}
                    className="w-full h-8 px-2 text-[11px] font-mono bg-white border border-slate-300 rounded text-slate-900"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <div className="flex flex-wrap gap-1.5">
                  {SEVERITIES.map((sev) => {
                    const active = splunkSeverities.includes(sev);
                    return (
                      <button
                        key={sev}
                        type="button"
                        onClick={() => toggleSeverity(sev)}
                        className={`px-2 py-1 text-[10px] font-mono rounded border cursor-pointer ${
                          active
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-300'
                        }`}
                      >
                        {sev}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => void runAdhocSplunk()}
                  disabled={splunkLoading}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                >
                  <Search className="w-3 h-3" />
                  {splunkLoading ? 'Querying...' : 'Run Query'}
                </button>
              </div>
            </div>

            {splunkError && (
              <div className="p-2.5 bg-red-50 border border-red-200 rounded text-red-800">
                {splunkError}
              </div>
            )}

            {splunkMatched !== null && (
              <div className="space-y-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-slate-600">
                  <span>Matched: {splunkMatched} events</span>
                  <span>Showing {splunkResults.length}</span>
                </div>
                {splunkResults.length === 0 ? (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded text-center text-slate-500">
                    No matching Splunk events.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 border border-slate-200 rounded-md overflow-hidden">
                    {splunkResults.slice(0, 30).map((ev, idx) => (
                      <div key={`${ev.event_id ?? idx}`} className="p-2.5 space-y-1">
                        <div className="flex items-center justify-between font-mono text-[11px]">
                          <span className="font-semibold text-slate-900">
                            {ev.event_id} · {ev.host}
                          </span>
                          <span className={`font-semibold ${severityColor(ev.severity)}`}>
                            {ev.severity}
                          </span>
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">
                          {ev.timestamp}
                        </div>
                        <p className="text-[11px] text-slate-700 leading-snug">
                          {ev.message}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
