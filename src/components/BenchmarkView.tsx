import { Fragment, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Play,
  ShieldAlert,
} from 'lucide-react';
import type {
  AccessRequestInput,
  BenchmarkCase,
  BenchmarkCaseResult,
  BenchmarkSummary,
  OrchestrationReport,
} from '../shared/types';

interface BenchmarkViewProps {
  presets: BenchmarkCase[];
  summary: BenchmarkSummary | null;
  running: boolean;
  error: string | null;
  onRunBenchmark: () => void;
  onInspectReport: (req: AccessRequestInput, report: OrchestrationReport) => void;
}

const CATEGORY_LABELS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All Cases' },
  { id: 'true_positive', label: 'True Positive' },
  { id: 'pretext_or_healthy', label: 'Pretext' },
  { id: 'adversarial_injection', label: 'Injection' },
  { id: 'stale_policy', label: 'Stale Policy' },
  { id: 'tie_breaking', label: 'Tie-Break' },
  { id: 'timeout_fallback', label: 'Timeout' },
  { id: 'moratorium_or_acl', label: 'Moratorium & ACL' },
  { id: 'edge_validation', label: 'Edge' },
];

export function BenchmarkView({
  presets,
  summary,
  running,
  error,
  onRunBenchmark,
  onInspectReport,
}: BenchmarkViewProps) {
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [expandedCaseId, setExpandedCaseId] = useState<string | null>(null);

  const filteredResults: BenchmarkCaseResult[] = (summary?.results ?? []).filter(
    (r) => categoryFilter === 'all' || r.category === categoryFilter,
  );

  const filteredPresets = presets.filter(
    (p) => categoryFilter === 'all' || p.category === categoryFilter,
  );

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Phase 4 Adversarial & Safety Evaluation Suite
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Executes 13 verification cases covering prompt injection, stale
              policy exclusion, ToT tie-breaking, SLA timeout fallback, OT
              moratoriums, and CyberArk runtime revocation.
            </p>
          </div>
          <button
            type="button"
            onClick={onRunBenchmark}
            disabled={running}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            {running ? 'Running Suite...' : 'Run All 13 Cases'}
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mt-6 pt-6 border-t border-slate-200">
          <div>
            <div className="text-xs text-slate-500">Overall Pass Rate</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {summary
                ? `${summary.passed_cases}/${summary.total_cases} (${Math.round(summary.pass_rate * 100)}%)`
                : `0/${presets.length}`}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">
              False-Supported Rate ({summary?.pretext_and_adversarial_cases ?? 5}{' '}
              adversarial/pretext)
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {summary
                ? `${(summary.false_supported_rate * 100).toFixed(1)}%`
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">
              Stale-Policy Approval Rate
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {summary
                ? `${(summary.stale_policy_approval_rate * 100).toFixed(1)}%`
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Suite Execution Time</div>
            <div className="mt-1 font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {summary ? `${summary.duration_ms} ms` : '—'}
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg overflow-x-auto">
        {CATEGORY_LABELS.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategoryFilter(cat.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              categoryFilter === cat.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-4 whitespace-nowrap">Case ID</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Category</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Finding</th>
                <th className="py-2.5 px-4 whitespace-nowrap">PAM Decision</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">
                  H4 Score
                </th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">
                  Margin
                </th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">
                  Tie Gap
                </th>
                <th className="py-2.5 px-4 whitespace-nowrap">Critic</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
                <th className="py-2.5 px-4 text-right whitespace-nowrap">
                  Trace
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {running ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="h-11">
                    <td className="px-4 py-2" colSpan={10}>
                      <div className="h-4 bg-slate-100 rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : summary ? (
                filteredResults.map((res) => {
                  const isExpanded = expandedCaseId === res.case_id;
                  return (
                    <Fragment key={res.case_id}>
                      <tr
                        onClick={() =>
                          setExpandedCaseId(isExpanded ? null : res.case_id)
                        }
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                      >
                        <td className="py-3 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                          {res.case_id}
                        </td>
                        <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                          {res.category.replace(/_/g, ' ')}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-800 whitespace-nowrap">
                          {res.finding}
                        </td>
                        <td
                          className={`py-3 px-4 font-mono font-semibold whitespace-nowrap ${
                            res.pam_decision === 'APPROVED_JIT'
                              ? 'text-green-700'
                              : 'text-slate-700'
                          }`}
                        >
                          {res.pam_decision}
                        </td>
                        <td className="py-3 px-4 font-mono text-right text-slate-700 tabular-nums">
                          {res.h4_score.toFixed(4)}
                        </td>
                        <td className="py-3 px-4 font-mono text-right text-slate-700 tabular-nums">
                          {res.margin_over_h4 >= 0 ? '+' : ''}
                          {res.margin_over_h4.toFixed(4)}
                        </td>
                        <td className="py-3 px-4 font-mono text-right text-slate-700 tabular-nums">
                          {res.tie_gap.toFixed(4)}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">
                          {res.critic_verdict}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          {res.passed ? (
                            <span className="inline-flex items-center gap-1 font-medium text-green-700">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Pass
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-medium text-red-700">
                              <ShieldAlert className="w-3.5 h-3.5" />
                              Fail
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onInspectReport(
                                presets.find((p) => p.case_id === res.case_id)
                                  ?.request ?? res.report.normalized_request,
                                res.report,
                              );
                            }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-950 underline underline-offset-2 cursor-pointer"
                          >
                            Open
                            <ArrowUpRight className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={10} className="px-4 py-3 text-xs text-slate-700">
                            <div className="flex flex-wrap items-center justify-between gap-4">
                              <div className="space-y-1 max-w-3xl">
                                <p className="font-medium text-slate-900">
                                  {res.description}
                                </p>
                                <p className="text-slate-600">
                                  PAM Reason: {res.report.pam_reason}
                                  {res.report.grant_final_state?.revoked_reason
                                    ? ` · Runtime Revocation: ${res.report.grant_final_state.revoked_reason}`
                                    : ''}
                                </p>
                                {res.cited_splunk_event_ids.length > 0 && (
                                  <p className="font-mono text-slate-600">
                                    Cited Splunk IDs:{' '}
                                    {res.cited_splunk_event_ids.join(', ')}
                                  </p>
                                )}
                              </div>
                              {res.report.critic_objections.length > 0 && (
                                <div className="flex items-start gap-1.5 text-amber-800">
                                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                  <span>
                                    {res.report.critic_objections.join(' ')}
                                  </span>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              ) : (
                filteredPresets.map((preset) => (
                  <tr key={preset.case_id} className="hover:bg-slate-50">
                    <td className="py-3 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                      {preset.case_id}
                    </td>
                    <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                      {preset.category.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                      Expected: {preset.expected_findings.join(' / ')}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 whitespace-nowrap">
                      Expected: {preset.expected_pam_decisions.join(' / ')}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-400">—</td>
                    <td className="py-3 px-4 text-right text-slate-400">—</td>
                    <td className="py-3 px-4 text-right text-slate-400">—</td>
                    <td className="py-3 px-4 text-slate-400">—</td>
                    <td className="py-3 px-4 text-slate-500">Pending</td>
                    <td className="py-3 px-4 text-right text-slate-400">—</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
