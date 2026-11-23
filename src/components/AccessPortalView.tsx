/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Lock,
  Send,
  ShieldAlert,
  Sparkles,
  Terminal,
} from 'lucide-react';
import type {
  AccessRequestInput,
  DeviceRecord,
  EmployeeRecord,
  OrchestrationReport,
  OrchestrationStepEvent,
} from '../shared/types';
import { PortalDebugDrawer } from './PortalDebugDrawer';

function formatDurationMmSs(ms: number): string {
  const totalSeconds = Math.round(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  report?: OrchestrationReport | null;
  steps?: OrchestrationStepEvent[];
  totalElapsedMs?: number;
  timestamp: string;
}

interface AccessPortalViewProps {
  devices: DeviceRecord[];
  employees: EmployeeRecord[];
  geminiConfigured: boolean;
  request: AccessRequestInput;
  onChangeRequest: (next: AccessRequestInput) => void;
  report: OrchestrationReport | null;
  steps: OrchestrationStepEvent[];
  isRunning: boolean;
  error: string | null;
  onRunOrchestration: (req: AccessRequestInput, includeGemini: boolean) => void;
  onOpenDashboards: () => void;
}

export function AccessPortalView({
  devices,
  geminiConfigured,
  request,
  onChangeRequest,
  report: initialReport,
  steps: initialSteps,
  isRunning: bootstrapRunning,
  error,
  onOpenDashboards,
}: AccessPortalViewProps) {
  const [inputPrompt, setInputPrompt] = useState<string>('');
  const [chatRunning, setChatRunning] = useState<boolean>(false);
  const [pendingClarificationReq, setPendingClarificationReq] =
    useState<AccessRequestInput | null>(null);
  const [debugOpen, setDebugOpen] = useState<boolean>(false);
  const [inspectedMsgId, setInspectedMsgId] = useState<string | null>(null);

  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'Hello! I am your PAM AI Assistant. Describe the privileged access you need (e.g., "netadmin needs 30m emergency break-fix access on vpn-gw-01 to renew TLS cert"), and I will review it against several criteria to determine whether to grant the access.',
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [includeGemini, setIncludeGemini] = useState<boolean>(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory, chatRunning]);

  const handleSendMessage = async () => {
    const text = inputPrompt.trim();
    if (!text || chatRunning) return;

    const turnStartedAt = Date.now();
    const userMsgId = `user-${turnStartedAt}`;
    const assistantMsgId = `assistant-${turnStartedAt + 1}`;

    const userMessage: ChatMessage = {
      id: userMsgId,
      sender: 'user',
      text,
      timestamp: new Date().toLocaleTimeString(),
    };

    const collectedSteps: OrchestrationStepEvent[] = [];

    setChatRunning(true);
    setInspectedMsgId(assistantMsgId);
    setChatHistory((prev) => [
      ...prev,
      userMessage,
      {
        id: assistantMsgId,
        sender: 'assistant',
        text: 'Parsing natural-language access request and initiating multi-agent background orchestration...',
        steps: [],
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
    setInputPrompt('');

    const pushStep = (step: OrchestrationStepEvent) => {
      collectedSteps.push(step);
      setChatHistory((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? { ...msg, steps: [...collectedSteps] }
            : msg,
        ),
      );
    };

    // Option 1: Visible NL Parser step (with clarification context if replying to a re-query)
    let currentReq: AccessRequestInput = pendingClarificationReq
      ? {
          ...pendingClarificationReq,
          claimed_issue: `${pendingClarificationReq.claimed_issue} | Follow-up: ${text}`,
        }
      : {
          ...request,
          request_id: `portal-${turnStartedAt.toString().slice(-6)}`,
          claimed_issue: text,
        };

    const parsePrompt = pendingClarificationReq
      ? `Previous incomplete request parameters:\n${JSON.stringify(pendingClarificationReq)}\n\nOperator follow-up clarification:\n${text}`
      : text;

    const parseStartedAt = Date.now();
    try {
      const parseRes = await fetch('/api/orchestrate/parse-nl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: parsePrompt }),
      });
      const parseData = await parseRes.json();
      const parseElapsed = Date.now() - parseStartedAt;

      if (!parseRes.ok || !parseData.request) {
        const parseErrMsg =
          parseData?.error || `HTTP ${parseRes.status} from /api/orchestrate/parse-nl`;
        pushStep({
          step: 'nl_parse',
          label: 'Natural Language Parser (Fallback)',
          detail: `Parser error: ${parseErrMsg}. Using fallback payload.`,
          telemetry: {
            status: 'PARSE_FAILED',
            error: parseErrMsg,
            parse_latency_ms: parseElapsed,
            fallback_request: currentReq,
          },
          duration_ms: Date.now() - turnStartedAt,
        });
      } else {
        currentReq = parseData.request as AccessRequestInput;
        onChangeRequest(currentReq);
        pushStep({
          step: 'nl_parse',
          label: 'Natural Language Parser (Gemini)',
          detail: `Parsed user=${currentReq.user_id || '(empty)'} · host=${currentReq.target_host || '(empty)'} · ttl=${currentReq.requested_ttl_minutes ?? 30}m · break_fix=${String(currentReq.is_break_fix)}`,
          telemetry: {
            status: 'PARSED',
            parse_latency_ms: parseElapsed,
            parsed_request: currentReq,
          },
          duration_ms: Date.now() - turnStartedAt,
        });
      }
    } catch (parseErr) {
      const parseErrMsg =
        parseErr instanceof Error ? parseErr.message : 'Network error calling parse-nl';
      pushStep({
        step: 'nl_parse',
        label: 'Natural Language Parser (Fallback)',
        detail: `Parser failed (${parseErrMsg}). Using fallback payload.`,
        telemetry: {
          status: 'PARSE_ERROR',
          error: parseErrMsg,
          parse_latency_ms: Date.now() - parseStartedAt,
          fallback_request: currentReq,
        },
        duration_ms: Date.now() - turnStartedAt,
      });
    }

    // Step 2: Run background orchestration stream
    try {
      const res = await fetch('/api/orchestrate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request: currentReq,
          include_gemini_synthesis: includeGemini && geminiConfigured,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Orchestration stream failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalRep: OrchestrationReport | null = null;

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
            pushStep(parsed as OrchestrationStepEvent);
          } else if (eventName === 'complete') {
            finalRep = parsed as OrchestrationReport;
          } else if (eventName === 'error') {
            throw new Error(parsed.error || 'Orchestration error');
          }
        }
      }

      if (finalRep) {
        const totalElapsedMs = Date.now() - turnStartedAt;
        setPendingClarificationReq(null);
        const isApproved =
          finalRep.pam_decision === 'APPROVED_JIT' &&
          finalRep.finding === 'Supported';

        const summaryText = isApproved
          ? `Access successfully granted to ${finalRep.target_host} for ${finalRep.grant_final_state?.ttl_minutes ?? 30} minutes via safe ${finalRep.grant_final_state?.safe_name}.`
          : `Access request evaluated and rejected/blocked: ${finalRep.pam_reason || finalRep.finding}`;

        setChatHistory((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? {
                  ...msg,
                  text: summaryText,
                  report: finalRep,
                  steps: [...collectedSteps],
                  totalElapsedMs,
                }
              : msg,
          ),
        );
      }
    } catch (err) {
      const errText =
        err instanceof Error ? err.message : 'Orchestration failed';
      const isClarification = errText.startsWith('CLARIFICATION_REQUIRED:');
      if (isClarification) {
        setPendingClarificationReq(currentReq);
      } else {
        setPendingClarificationReq(null);
      }
      const cleanMessage = isClarification
        ? `Your access request appears incomplete. Clarification needed: ${errText.replace('CLARIFICATION_REQUIRED:', '')}`
        : `Error during orchestration: ${errText}`;

      setChatHistory((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? { ...msg, text: cleanMessage, steps: [...collectedSteps] }
            : msg,
        ),
      );
    } finally {
      setChatRunning(false);
    }
  };

  const renderDeterminationBadge = (rep: OrchestrationReport) => {
    const isApproved =
      rep.pam_decision === 'APPROVED_JIT' && rep.finding === 'Supported';
    if (isApproved) {
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-green-50 border border-green-200 rounded-full text-green-800 text-xs font-semibold">
          <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
          <span>Access Granted (JIT Secured)</span>
        </div>
      );
    }
    if (rep.finding === 'PolicyBlocked_Moratorium') {
      return (
        <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 border border-red-200 rounded-full text-red-800 text-xs font-semibold">
          <ShieldAlert className="w-3.5 h-3.5 text-red-600 shrink-0" />
          <span>Access Denied (Moratorium Block)</span>
        </div>
      );
    }
    return (
      <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-200 rounded-full text-amber-800 text-xs font-semibold">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
        <span>Access Rejected / Inconclusive</span>
      </div>
    );
  };

  // Resolve inspected turn for Debug Drawer (defaults to latest assistant turn with steps, or bootstrap steps)
  const inspectedMsg =
    chatHistory.find((m) => m.id === inspectedMsgId) ??
    [...chatHistory].reverse().find((m) => m.sender === 'assistant' && m.steps && m.steps.length > 0) ??
    null;

  const drawerSteps = inspectedMsg?.steps ?? initialSteps;
  const drawerReport = inspectedMsg ? (inspectedMsg.report ?? null) : initialReport;
  const drawerTurnLabel = inspectedMsg
    ? `Turn ${inspectedMsg.timestamp}`
    : 'Initial Baseline';

  return (
    <div
      className={`mx-auto flex flex-col h-[calc(100vh-4rem)] transition-all ${
        debugOpen ? 'max-w-[1440px]' : 'max-w-4xl'
      }`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 shrink-0 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-slate-900 rounded-lg flex items-center justify-center text-white">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-slate-900 tracking-tight">
              PAM AI Assistant
            </h1>
            <p className="text-xs text-slate-500">
              Conversational JIT Privileged Access Request & Multi-Agent Verification.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setDebugOpen((prev) => !prev)}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
              debugOpen
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 shadow-2xs'
            }`}
          >
            <Activity
              className={`w-3.5 h-3.5 ${
                chatRunning || bootstrapRunning ? 'animate-pulse text-amber-500' : ''
              }`}
            />
            <span>
              Debug Telemetry ({drawerSteps.length})
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenDashboards}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
          >
            <span>Policy and Validation</span>
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Main Split Body: Chat Stream + Optional Debug Telemetry Drawer */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-6">
        {/* Chat Column */}
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          {/* Chat Messages Stream */}
          <div className="flex-1 overflow-y-auto space-y-6 pr-2">
            {chatHistory.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.sender === 'user' ? 'items-end' : 'items-start'
                }`}
              >
                <div className="flex items-center gap-2 mb-1 px-1">
                  <span className="text-[11px] font-semibold text-slate-500">
                    {msg.sender === 'user' ? 'You' : 'PAM AI Assistant'}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    {msg.timestamp}
                  </span>
                  {msg.sender === 'assistant' && msg.steps && msg.steps.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setInspectedMsgId(msg.id);
                        setDebugOpen(true);
                      }}
                      className="text-[10px] font-mono text-slate-500 hover:text-slate-900 underline cursor-pointer"
                    >
                      Inspect telemetry
                    </button>
                  )}
                </div>

                <div
                  className={`max-w-3xl rounded-xl p-4 text-sm ${
                    msg.sender === 'user'
                      ? 'bg-slate-900 text-white rounded-br-none'
                      : 'bg-white border border-slate-200 text-slate-900 rounded-bl-none shadow-2xs'
                  }`}
                >
                  <p className="leading-relaxed">{msg.text}</p>

                  {/* Step-by-Step Agent Trace & Telemetry Logs */}
                  {msg.steps && msg.steps.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-100 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700">
                        <div className="flex items-center gap-1.5">
                          <Terminal className="w-3.5 h-3.5 text-slate-500" />
                          <span>Background Agent Trace & Tool Telemetry</span>
                        </div>
                        {chatRunning && msg.id === inspectedMsgId && (
                          <span className="inline-flex items-center gap-1 font-mono text-[11px] text-amber-700">
                            <Clock className="w-3 h-3 animate-spin" />
                            Streaming...
                          </span>
                        )}
                      </div>
                      <div className="space-y-1.5 font-mono text-xs">
                        {msg.steps.map((s, idx) => (
                          <div
                            key={`${s.step}-${idx}`}
                            className={`p-2.5 border rounded-md space-y-1 ${
                              s.step === 'clarification'
                                ? 'bg-amber-50/70 border-amber-200'
                                : 'bg-slate-50 border-slate-200'
                            }`}
                          >
                            <div className="flex items-center justify-between text-slate-800 font-semibold">
                              <span>
                                [{idx + 1}] {s.label}
                              </span>
                              <span className="text-slate-500 text-[11px] tabular-nums">
                                +{s.duration_ms}ms
                              </span>
                            </div>
                            <p className="text-slate-600 font-sans text-xs">
                              {s.detail}
                            </p>
                            {s.envelope && (
                              <div className="text-[10px] text-slate-500 pt-1 border-t border-slate-200/60 flex flex-wrap gap-2">
                                <span>
                                  Route: {s.envelope.source_agent} &rarr;{' '}
                                  {s.envelope.target_agent}
                                </span>
                                <span>Mode: {s.envelope.communication_mode}</span>
                                {s.envelope.untrusted_data_fields.length > 0 && (
                                  <span className="text-red-600">
                                    Sanitized fields:{' '}
                                    {s.envelope.untrusted_data_fields.join(', ')}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Option 2: Inline expandable step telemetry & envelope JSON */}
                            {(s.telemetry || s.envelope?.payload) && (
                              <details className="pt-1">
                                <summary className="text-[10px] text-slate-500 hover:text-slate-800 cursor-pointer select-none">
                                  Inspect payload & telemetry JSON
                                </summary>
                                <pre className="mt-1.5 p-2.5 bg-slate-900 text-slate-100 rounded text-[10px] leading-relaxed overflow-x-auto max-h-48">
                                  {JSON.stringify(
                                    {
                                      ...(s.telemetry ? { telemetry: s.telemetry } : {}),
                                      ...(s.envelope?.payload
                                        ? { envelope_payload: s.envelope.payload }
                                        : {}),
                                    },
                                    null,
                                    2,
                                  )}
                                </pre>
                              </details>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Final Determination Card */}
                  {msg.report && (
                    <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                          Determination Result
                        </span>
                        <div className="flex items-center gap-2.5">
                          <span
                            className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 tabular-nums"
                            title={`Total elapsed time: ${msg.totalElapsedMs ?? msg.report.duration_ms}ms`}
                          >
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>
                              {formatDurationMmSs(
                                msg.totalElapsedMs ?? msg.report.duration_ms,
                              )}
                            </span>
                          </span>
                          {renderDeterminationBadge(msg.report)}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-sans">
                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                          <span className="text-slate-500 font-medium block">
                            PAM & JIT Grant
                          </span>
                          <div className="font-mono font-semibold text-slate-900">
                            {msg.report.pam_decision}
                          </div>
                          <p className="text-slate-600 text-[11px]">
                            {msg.report.pam_reason}
                          </p>
                          {msg.report.grant_final_state && (
                            <div className="font-mono text-[10px] text-slate-700 pt-1 border-t border-slate-200">
                              Safe: {msg.report.grant_final_state.safe_name} · TTL:{' '}
                              {msg.report.grant_final_state.ttl_minutes}m
                            </div>
                          )}
                        </div>

                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                          <span className="text-slate-500 font-medium block">
                            Tree-of-Thought
                          </span>
                          <div className="font-mono font-semibold text-slate-900">
                            Winner: {msg.report.winning_hypothesis}
                          </div>
                          <p className="text-slate-600 text-[11px]">
                            H4 Score: {msg.report.h4_score.toFixed(3)} · Margin:{' '}
                            {msg.report.margin_over_h4 >= 0 ? '+' : ''}
                            {msg.report.margin_over_h4.toFixed(3)}
                          </p>
                        </div>

                        <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
                          <span className="text-slate-500 font-medium block">
                            Blind Critic Audit
                          </span>
                          <div className="font-mono font-semibold text-slate-900">
                            {msg.report.critic_verdict}
                          </div>
                          <p className="text-slate-600 text-[11px]">
                            {msg.report.critic_objections.length > 0
                              ? msg.report.critic_objections.join(' ')
                              : 'No safety objections.'}
                          </p>
                        </div>
                      </div>

                      {msg.report.gemini_synthesis && (
                        <div className="p-3 bg-slate-900 text-slate-100 rounded-lg space-y-1 text-xs font-mono">
                          <div className="flex items-center gap-1.5 text-amber-300 font-semibold">
                            <Sparkles className="w-3.5 h-3.5" />
                            <span>Gemini 4 Hydrogen Rationale</span>
                          </div>
                          <p className="text-slate-300 text-[11px] font-sans leading-relaxed">
                            {msg.report.gemini_synthesis.executive_summary}
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 shrink-0 my-2">
              {error}
            </div>
          )}

          {/* Chat Input Bar */}
          <div className="pt-4 border-t border-slate-200 shrink-0">
            {pendingClarificationReq && (
              <div className="mb-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-md flex items-center justify-between text-xs text-amber-900">
                <span>
                  Clarification pending — reply with missing details to complete your request.
                </span>
                <button
                  type="button"
                  onClick={() => setPendingClarificationReq(null)}
                  className="text-[11px] font-medium underline cursor-pointer"
                >
                  Start fresh
                </button>
              </div>
            )}

            <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-xl p-2 shadow-sm focus-within:ring-2 focus-within:ring-slate-900">
              <textarea
                rows={1}
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSendMessage();
                  }
                }}
                placeholder={
                  pendingClarificationReq
                    ? 'Provide the missing host, user ID, or UTC time window...'
                    : "Describe your access request (e.g. 'netadmin needs 30m emergency access on vpn-gw-01')..."
                }
                className="flex-1 px-3 py-2 text-sm bg-transparent border-none text-slate-900 placeholder:text-slate-400 focus:outline-none resize-none"
              />

              <label className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-600 px-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeGemini}
                  disabled={!geminiConfigured}
                  onChange={(e) => setIncludeGemini(e.target.checked)}
                  className="rounded border-slate-300 text-slate-900"
                />
                <span>Gemini Synthesis</span>
              </label>

              <button
                type="button"
                onClick={() => void handleSendMessage()}
                disabled={chatRunning || !inputPrompt.trim()}
                className="inline-flex items-center justify-center p-2.5 text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-40 transition-colors cursor-pointer shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 px-1 mt-1.5">
              <span>Press Enter to send request to multi-agent background orchestrator.</span>
              <div className="flex items-center gap-3">
                <a
                  href="/api/build-instructions.txt"
                  download="BUILD_INSTRUCTIONS.txt"
                  className="font-medium text-slate-600 hover:text-slate-900 hover:underline"
                >
                  Download Build Guide (.txt)
                </a>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <button
                  type="button"
                  onClick={onOpenDashboards}
                  className="font-medium text-slate-700 hover:underline cursor-pointer"
                >
                  Open Policy and Validation Dashboards &rarr;
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Option 3: Collapsible Debug Telemetry Drawer */}
        {debugOpen && (
          <div className="lg:w-[460px] xl:w-[520px] shrink-0 h-[460px] lg:h-full">
            <PortalDebugDrawer
              devices={devices}
              steps={drawerSteps}
              report={drawerReport}
              isRunning={chatRunning || bootstrapRunning}
              turnLabel={drawerTurnLabel}
              onClose={() => setDebugOpen(false)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
