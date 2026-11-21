import type {
  AccessRequestInput,
  AgentEnvelope,
  EvidenceBundle,
  OrchestrationReport,
  OrchestrationStepEvent,
} from '../shared/types.ts';
import {
  AccessBrokerAgent,
  CriticAgent,
  EvidenceAgent,
  IntakeAgent,
  PolicyContextAgent,
  PolicyToTEvaluator,
  ReporterAgent,
} from './agents.ts';
import type { Phase1MockStore } from './mockStore.ts';

export class HubAndSpokeOrchestrator {
  private readonly store: Phase1MockStore;
  private readonly intake = new IntakeAgent();
  private readonly evidence = new EvidenceAgent();
  private readonly policyCtx = new PolicyContextAgent();
  private readonly policy = new PolicyToTEvaluator();
  private readonly critic = new CriticAgent();
  private readonly broker = new AccessBrokerAgent();
  private readonly reporter = new ReporterAgent();

  constructor(store: Phase1MockStore) {
    this.store = store;
  }

  private recordMessage(
    trace: AgentEnvelope[],
    msg: AgentEnvelope,
    startedAt: number,
  ): AgentEnvelope {
    const errs = this.store.validateAgentMessage(msg);
    if (errs.length > 0) {
      throw new Error(`Invalid agent message envelope: ${errs.join('; ')}`);
    }
    const stamped: AgentEnvelope = {
      ...msg,
      timestamp_ms: Date.now() - startedAt,
    };
    trace.push(stamped);
    return stamped;
  }

  public async runRequest(
    rawReq: AccessRequestInput,
    onStep?: (step: OrchestrationStepEvent) => void,
    options?: { allowClarificationFallback?: boolean },
  ): Promise<OrchestrationReport> {
    const startedAt = Date.now();
    const reqId = rawReq.request_id || `req-${Date.now()}`;
    const trace: AgentEnvelope[] = [];

    const intakeEnv = this.recordMessage(
      trace,
      {
        request_id: reqId,
        source_agent: 'orchestrator',
        target_agent: 'intake',
        communication_mode: 'two_way',
        clarification_attempts: 0,
        untrusted_data_fields: ['claimed_issue'],
        payload: { raw_request: rawReq },
      },
      startedAt,
    );

    let clarificationRetried = false;
    let intakeOut = this.intake.process(rawReq, this.store, 0);
    if (intakeOut.status === 'NEEDS_CLARIFICATION') {
      onStep?.({
        step: 'clarification',
        label: 'Intake Clarification Required',
        detail: `Missing required fields: ${intakeOut.missing_fields.join(', ')}`,
        envelope: intakeEnv,
        telemetry: {
          status: intakeOut.status,
          missing_fields: intakeOut.missing_fields,
          raw_request: rawReq,
        },
        duration_ms: Date.now() - startedAt,
      });

      if (!options?.allowClarificationFallback) {
        throw new Error(
          `CLARIFICATION_REQUIRED:Missing required fields: ${intakeOut.missing_fields.join(', ')}. Please provide these details.`,
        );
      }

      clarificationRetried = true;
      intakeOut = this.intake.process(rawReq, this.store, 1);
      if (intakeOut.status === 'NEEDS_CLARIFICATION') {
        throw new Error(
          `Clarification exhausted for ${reqId}: ${intakeOut.missing_fields.join(', ')}`,
        );
      }
    }

    const normReq = intakeOut.normalized_request;
    onStep?.({
      step: 'intake',
      label: 'Intake Normalization',
      detail: clarificationRetried
        ? `Clarification retry exhausted; fallback normalized for ${normReq.target_host}`
        : `Normalized request for ${normReq.user_id} -> ${normReq.target_host}`,
      envelope: intakeEnv,
      telemetry: {
        normalized_request: normReq,
        redacted_directives: normReq.redacted_directives,
        clarification_retried: clarificationRetried,
      },
      duration_ms: Date.now() - startedAt,
    });

    // Parallel Evidence & Policy Context Fan-Out
    const evFanOutEnv = this.recordMessage(
      trace,
      {
        request_id: reqId,
        source_agent: 'orchestrator',
        target_agent: 'evidence',
        communication_mode: 'one_way',
        clarification_attempts: 0,
        untrusted_data_fields: ['splunk_events', 'corroborating_events'],
        payload: { normalized_request: normReq, fan_out: 'parallel' },
      },
      startedAt,
    );
    const polFanOutEnv = this.recordMessage(
      trace,
      {
        request_id: reqId,
        source_agent: 'orchestrator',
        target_agent: 'policy',
        communication_mode: 'one_way',
        clarification_attempts: 0,
        untrusted_data_fields: [],
        payload: { normalized_request: normReq, fan_out: 'parallel' },
      },
      startedAt,
    );

    onStep?.({
      step: 'fan_out',
      label: 'Parallel Fan-Out',
      detail: 'Dispatched EvidenceAgent & PolicyContextAgent concurrently',
      envelope: evFanOutEnv,
      telemetry: {
        concurrent_targets: ['evidence', 'policy'],
        sla_timeout_ms: 2000,
        target_host: normReq.target_host,
        window: `${normReq.window_start} .. ${normReq.window_end}`,
      },
      duration_ms: Date.now() - startedAt,
    });

    let timedOut = false;
    const polCtxPromise = this.policyCtx.retrieveActivePolicies(this.store);
    const evPromise = Promise.race<EvidenceBundle>([
      this.evidence.gather(normReq, this.store),
      new Promise<EvidenceBundle>((_, reject) =>
        setTimeout(() => reject(new Error('Telemetry SLA timeout')), 2000),
      ),
    ]);

    const [polCtxOut, evResult] = await Promise.all([
      polCtxPromise,
      evPromise.catch((err: unknown): EvidenceBundle => {
        timedOut = true;
        return {
          splunk_matched_count: 0,
          too_broad_gt_10000: false,
          splunk_events: [],
          corroborating_events: [],
          approved_crs: [],
          incidents: [],
          active_moratoriums: [],
          timeout_error: err instanceof Error ? err.message : String(err),
        };
      }),
    ]);

    onStep?.({
      step: 'evidence',
      label: 'Evidence Gathering',
      detail: timedOut
        ? `Telemetry fallback triggered: ${evResult.timeout_error}`
        : `Collected ${evResult.splunk_matched_count} Splunk events, ${evResult.corroborating_events.length} fw-edge-01 events`,
      envelope: evFanOutEnv,
      telemetry: {
        splunk_matched_count: evResult.splunk_matched_count,
        too_broad_gt_10000: evResult.too_broad_gt_10000,
        timeout_error: evResult.timeout_error ?? null,
        splunk_events: evResult.splunk_events.slice(0, 25),
        corroborating_events: evResult.corroborating_events.slice(0, 15),
        approved_crs: evResult.approved_crs,
        incidents: evResult.incidents,
        active_moratoriums: evResult.active_moratoriums,
      },
      duration_ms: Date.now() - startedAt,
    });

    onStep?.({
      step: 'policy_ctx',
      label: 'Policy Context Retrieval',
      detail: `Active: ${polCtxOut.active_policy_ids.join(', ')} (Ignored: ${polCtxOut.superseded_policy_ids.join(', ')})`,
      envelope: polFanOutEnv,
      telemetry: {
        active_policies: polCtxOut.active_policies.map((p) => ({
          doc_id: p.doc_id,
          version: p.version,
          status: p.status,
          title: p.title,
        })),
        superseded_policy_ids: polCtxOut.superseded_policy_ids,
      },
      duration_ms: Date.now() - startedAt,
    });

    // Tree-of-Thought Researcher Evaluation
    const totEnv = this.recordMessage(
      trace,
      {
        request_id: reqId,
        source_agent: 'orchestrator',
        target_agent: 'policy',
        communication_mode: 'tot_internal',
        clarification_attempts: 0,
        untrusted_data_fields: ['splunk_events', 'corroborating_events'],
        payload: {
          normalized_request: normReq,
          evidence_count: evResult.splunk_matched_count,
          policy_ids: polCtxOut.active_policy_ids,
        },
      },
      startedAt,
    );

    const polOut = this.policy.evaluate(
      normReq,
      evResult,
      polCtxOut,
      this.store,
    );
    if (timedOut) {
      polOut.finding = 'Inconclusive';
      polOut.winning_hypothesis = 'H4';
      polOut.timeout_fallback = true;
    }

    onStep?.({
      step: 'tot_eval',
      label: 'ToT Beam Search (Depth 3)',
      detail: `Candidate=${polOut.finding} · Winner=${polOut.winning_hypothesis} · H4=${polOut.h4_score} · Margin=${polOut.margin_over_h4}`,
      envelope: totEnv,
      telemetry: {
        finding: polOut.finding,
        winning_hypothesis: polOut.winning_hypothesis,
        h4_score: polOut.h4_score,
        margin_over_h4: polOut.margin_over_h4,
        tie_gap: polOut.tie_gap,
        is_close_tie: polOut.is_close_tie,
        beam_retained: polOut.beam_retained,
        pruned_hypotheses: polOut.pruned_hypotheses,
        all_scores: polOut.all_scores,
        depth_traces: polOut.depth_traces,
      },
      duration_ms: Date.now() - startedAt,
    });

    // Blind Critic Audit
    const criticEnv = this.recordMessage(
      trace,
      {
        request_id: reqId,
        source_agent: 'orchestrator',
        target_agent: 'policy',
        communication_mode: 'tot_internal',
        clarification_attempts: 0,
        untrusted_data_fields: ['splunk_events', 'corroborating_events'],
        payload: { role: 'blind_critic', proposed_finding: polOut.finding },
      },
      startedAt,
    );

    const criticOut = this.critic.review(normReq, evResult, polOut);
    polOut.finding = criticOut.approved_finding;

    onStep?.({
      step: 'critic',
      label: 'Blind Critic Audit',
      detail: `${criticOut.critic_verdict} (${criticOut.objections.length} objections)`,
      envelope: criticEnv,
      telemetry: {
        critic_verdict: criticOut.critic_verdict,
        approved_finding: criticOut.approved_finding,
        objections: criticOut.objections,
      },
      duration_ms: Date.now() - startedAt,
    });

    // Deterministic Access Broker & Runtime Monitor
    const brokerEnv = this.recordMessage(
      trace,
      {
        request_id: reqId,
        source_agent: 'orchestrator',
        target_agent: 'access_broker',
        communication_mode: 'two_way',
        clarification_attempts: 0,
        untrusted_data_fields: [],
        payload: {
          finding: polOut.finding,
          critic_verdict: criticOut.critic_verdict,
          requested_ttl_minutes: normReq.requested_ttl_minutes,
        },
      },
      startedAt,
    );

    const pamOut = this.broker.evaluateGrant(normReq, polOut, this.store);
    const runtimeAudit = this.broker.monitorRuntimeEvents(
      pamOut.grant,
      this.store,
    );

    onStep?.({
      step: 'access_broker',
      label: 'Access Broker & PAM Runtime',
      detail: `${pamOut.decision}${pamOut.grant ? ` (${pamOut.grant.status})` : ''}`,
      envelope: brokerEnv,
      telemetry: {
        decision: pamOut.decision,
        reason: pamOut.reason,
        grant: pamOut.grant,
        runtime_audit: runtimeAudit,
      },
      duration_ms: Date.now() - startedAt,
    });

    // Reporter
    const reporterEnv = this.recordMessage(
      trace,
      {
        request_id: reqId,
        source_agent: 'orchestrator',
        target_agent: 'reporter',
        communication_mode: 'one_way',
        clarification_attempts: 0,
        untrusted_data_fields: ['splunk_events'],
        payload: {
          pam_decision: pamOut.decision,
          runtime_audit_count: runtimeAudit.length,
          critic_verdict: criticOut.critic_verdict,
        },
      },
      startedAt,
    );

    const citedIds = this.reporter.getCitedEventIds(evResult);
    onStep?.({
      step: 'reporter',
      label: 'Audit Report Compiled',
      detail: `${citedIds.length} Splunk events cited · ${trace.length} validated envelopes`,
      envelope: reporterEnv,
      telemetry: {
        cited_splunk_event_ids: citedIds,
        trace_message_count: trace.length,
      },
      duration_ms: Date.now() - startedAt,
    });

    return {
      request_id: reqId,
      target_host: normReq.target_host,
      user_id: normReq.user_id,
      finding: polOut.finding,
      winning_hypothesis: polOut.winning_hypothesis,
      h4_score: polOut.h4_score,
      margin_over_h4: polOut.margin_over_h4,
      tie_gap: polOut.tie_gap,
      max_depth_evaluated: polOut.max_depth_evaluated,
      critic_verdict: criticOut.critic_verdict,
      critic_objections: criticOut.objections,
      pam_decision: pamOut.decision,
      pam_reason: pamOut.reason,
      grant_final_state: pamOut.grant,
      runtime_audit: runtimeAudit,
      timeout_fallback: Boolean(polOut.timeout_fallback),
      cited_splunk_event_ids: citedIds,
      policies_used: polOut.active_policies_applied,
      superseded_policies_ignored: polOut.superseded_policies_ignored,
      clarification_retried: clarificationRetried,
      redacted_directives: normReq.redacted_directives,
      trace_message_count: trace.length,
      duration_ms: Date.now() - startedAt,
      normalized_request: normReq,
      evidence: evResult,
      policy_eval: polOut,
      message_trace: trace,
    };
  }
}
