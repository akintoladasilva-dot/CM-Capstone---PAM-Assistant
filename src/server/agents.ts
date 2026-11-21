import type {
  AccessRequestInput,
  CriticReviewResult,
  DeviceRecord,
  EvidenceBundle,
  FindingType,
  NormalizedRequest,
  PamDecisionResult,
  PamGrant,
  PolicyContextBundle,
  PolicyEvaluationResult,
  RuntimeAuditEvent,
  SplunkEvent,
  ToTDepthTrace,
  ToTHypothesisScore,
} from '../shared/types.ts';
import { parseIsoTimestamp, type Phase1MockStore } from './mockStore.ts';

const DIRECTIVE_REGEX =
  /(ignore previous instructions|system prompt|override policy|auto[- ]?approve|grant admin)/gi;

export function sanitizeUntrustedText(text: string): {
  cleaned: string;
  redactedDirectives: string[];
} {
  const matched: string[] = [];
  const cleaned = text.replace(DIRECTIVE_REGEX, (m) => {
    matched.push(m);
    return '[REDACTED_DIRECTIVE]';
  });
  return { cleaned, redactedDirectives: matched };
}

function round4(val: number): number {
  return Math.round(val * 10000) / 10000;
}

export class IntakeAgent {
  public process(
    rawReq: AccessRequestInput,
    store: Phase1MockStore,
    attempts = 0,
  ):
    | {
        status: 'NEEDS_CLARIFICATION';
        clarification_attempts: number;
        missing_fields: string[];
        normalized_request: null;
      }
    | {
        status: 'READY';
        clarification_attempts: number;
        normalized_request: NormalizedRequest;
      } {
    const host = rawReq.target_host;
    const start = rawReq.window_start;
    const end = rawReq.window_end;
    const userId = rawReq.user_id || 'unknown';
    const isBreakFix = Boolean(rawReq.is_break_fix);
    const { cleaned: claimedIssue, redactedDirectives } = sanitizeUntrustedText(
      String(rawReq.claimed_issue ?? ''),
    );

    const knownHosts = new Set(store.devices.map((d) => d.hostname));
    const knownUsers = new Set(store.employees.map((e) => e.user_id));

    const missing: string[] = [];
    if (!host || !knownHosts.has(host)) {
      missing.push(`valid target_host (got '${String(host ?? '')}')`);
    }
    if (!start || !end) {
      missing.push('window_start and window_end');
    }
    if (!knownUsers.has(userId)) {
      missing.push(`valid user_id (got '${userId}')`);
    }

    if (missing.length > 0 && attempts < 1) {
      return {
        status: 'NEEDS_CLARIFICATION',
        clarification_attempts: attempts + 1,
        missing_fields: missing,
        normalized_request: null,
      };
    }

    const resolvedStart = start || '2025-11-17T06:00:00Z';
    const resolvedEnd = end || '2025-11-17T07:00:00Z';

    const deviceMeta: DeviceRecord = store.devices.find(
      (d) => d.hostname === host,
    ) ?? {
      hostname: host || 'unknown',
      ip: '0.0.0.0',
      mac: '00:00:00:00:00:00',
      role: 'Unknown',
      assignment: 'Unknown',
      zone: 'Unknown',
      status: 'unknown',
      criticality: 'high',
    };

    return {
      status: 'READY',
      clarification_attempts: attempts,
      normalized_request: {
        request_id: rawReq.request_id || 'req-auto',
        user_id: userId,
        target_host: host,
        device_meta: deviceMeta,
        window_start: resolvedStart,
        window_end: resolvedEnd,
        is_break_fix: isBreakFix,
        claimed_issue: claimedIssue,
        redacted_directives: redactedDirectives,
        requested_ttl_minutes: Number(rawReq.requested_ttl_minutes ?? 30),
        simulate_timeout: Boolean(rawReq.simulate_timeout),
        requested_policy_id: rawReq.requested_policy_id ?? null,
      },
    };
  }
}

export class EvidenceAgent {
  public async gather(
    normReq: NormalizedRequest,
    store: Phase1MockStore,
  ): Promise<EvidenceBundle> {
    if (normReq.simulate_timeout) {
      await new Promise((resolve) => setTimeout(resolve, 60));
      throw new Error(
        'Simulated Splunk/ITSM telemetry timeout exceeded SLA.',
      );
    }

    const host = normReq.target_host;
    const start = normReq.window_start;
    const end = normReq.window_end;
    const deviceZone = normReq.device_meta.zone ?? '';

    const splunkRes = store.querySplunk({
      host,
      windowStart: start,
      windowEnd: end,
      windowPaddingHours: 2.0,
    });

    const sanitizedEvents: SplunkEvent[] = splunkRes.events.map((ev) => ({
      event_id: ev.event_id,
      timestamp: ev.timestamp,
      host: ev.host,
      ip: ev.ip,
      role: ev.role,
      severity: ev.severity,
      message: sanitizeUntrustedText(ev.message).cleaned,
    }));

    const fwRes = store.querySplunk({
      host: 'fw-edge-01',
      windowStart: start,
      windowEnd: end,
      windowPaddingHours: 2.0,
      keywordRegex: host || '',
    });

    const corroboratingEvents: SplunkEvent[] = fwRes.events.map((ev) => ({
      event_id: ev.event_id,
      timestamp: ev.timestamp,
      host: ev.host,
      ip: ev.ip,
      severity: ev.severity,
      message: sanitizeUntrustedText(ev.message).cleaned,
    }));

    const matchingCrs = store.changeRequests.filter(
      (cr) => cr.target_host === host && cr.status === 'APPROVED',
    );
    const matchingIncs = store.incidents.filter(
      (inc) => inc.target_host === host,
    );

    const reqStartMs = parseIsoTimestamp(start);
    const reqEndMs = parseIsoTimestamp(end);
    const activeMoratoriums = store.moratoriums.filter((mor) => {
      const mStartMs = parseIsoTimestamp(mor.start);
      const mEndMs = parseIsoTimestamp(mor.end);
      return (
        reqStartMs <= mEndMs &&
        reqEndMs >= mStartMs &&
        mor.target_zones.includes(deviceZone)
      );
    });

    return {
      splunk_matched_count: splunkRes.matched_count,
      too_broad_gt_10000: splunkRes.too_broad_gt_10000,
      splunk_events: sanitizedEvents,
      corroborating_events: corroboratingEvents,
      approved_crs: matchingCrs,
      incidents: matchingIncs,
      active_moratoriums: activeMoratoriums,
    };
  }
}

export class PolicyContextAgent {
  public async retrieveActivePolicies(
    store: Phase1MockStore,
  ): Promise<PolicyContextBundle> {
    const activePolicies = store.policies.filter((p) => p.status === 'Active');
    const supersededPolicies = store.policies
      .filter((p) => p.status !== 'Active')
      .map((p) => p.doc_id);

    return {
      active_policies: activePolicies,
      active_policy_ids: activePolicies.map((p) => p.doc_id),
      superseded_policy_ids: supersededPolicies,
    };
  }
}

export class PolicyToTEvaluator {
  public evaluate(
    normReq: NormalizedRequest,
    evidence: EvidenceBundle,
    policyCtx: PolicyContextBundle,
    store: Phase1MockStore,
  ): PolicyEvaluationResult {
    const rubric = store.rubricConfig;
    const weights = rubric.weights;
    const beamWidth = rubric.beam_width;
    const maxDepth = rubric.max_depth;
    const protectedNullId = rubric.protected_null_hypothesis_id;
    const supportedThreshold = rubric.supported_threshold;
    const inconclusiveCeiling = rubric.inconclusive_ceiling;
    const pruneFloor = rubric.prune_floor;
    const h4Margin = rubric.h4_required_margin;
    const tieDelta = rubric.tie_delta;

    const events = evidence.splunk_events;
    const corrob = evidence.corroborating_events;
    const hasApprovedCr = evidence.approved_crs.length > 0;
    const hasOpenInc = evidence.incidents.some((i) => i.status === 'OPEN');
    const moratoriums = evidence.active_moratoriums;
    const hasMoratorium = moratoriums.length > 0;

    const hasFaultLogs = events.some((e) =>
      ['WARNING', 'ERROR', 'CRITICAL'].includes(e.severity),
    );
    const hasCorrobFaults = corrob.some((e) =>
      ['WARNING', 'ERROR', 'CRITICAL'].includes(e.severity),
    );
    const allHealthyInfo = events.length > 0 && !hasFaultLogs;
    const crBreakfixConflict = hasApprovedCr && normReq.is_break_fix;

    const baseHypotheses = [
      {
        id: 'H1',
        label: 'Approved Scheduled/Routine Change with Matching Telemetry',
        scores: {
          evidence_match:
            hasApprovedCr && hasFaultLogs
              ? 0.9
              : hasApprovedCr
                ? 0.65
                : 0.1,
          independent_corroboration: hasApprovedCr ? 0.8 : 0.15,
          fit_to_requested_change:
            hasApprovedCr && !normReq.is_break_fix
              ? 0.9
              : crBreakfixConflict
                ? 0.6
                : 0.25,
          no_contradiction: crBreakfixConflict
            ? 0.55
            : hasApprovedCr && !hasMoratorium
              ? 0.9
              : 0.3,
        },
      },
      {
        id: 'H2',
        label: 'Confirmed Break-Fix / Fault with Corroborated Telemetry',
        scores: {
          evidence_match: hasFaultLogs ? 0.92 : 0.15,
          independent_corroboration: crBreakfixConflict
            ? 0.55
            : hasCorrobFaults || hasOpenInc
              ? 0.9
              : hasFaultLogs
                ? 0.55
                : 0.1,
          fit_to_requested_change: normReq.is_break_fix ? 0.9 : 0.4,
          no_contradiction: crBreakfixConflict
            ? 0.45
            : !allHealthyInfo
              ? 0.85
              : 0.1,
        },
      },
      {
        id: 'H3',
        label: 'Operational Moratorium / Constraint or Benign State',
        scores: {
          evidence_match: hasMoratorium ? 0.85 : 0.35,
          independent_corroboration: hasMoratorium ? 0.8 : 0.3,
          fit_to_requested_change: hasMoratorium ? 0.85 : 0.35,
          no_contradiction: 0.85,
        },
      },
      {
        id: 'H4',
        label:
          'Protected Null: No Verified Fault / Insufficient or Pretext Evidence',
        scores: {
          evidence_match: allHealthyInfo ? 0.9 : hasFaultLogs ? 0.25 : 0.7,
          independent_corroboration: allHealthyInfo ? 0.85 : 0.35,
          fit_to_requested_change: allHealthyInfo ? 0.75 : 0.3,
          no_contradiction: allHealthyInfo ? 0.9 : 0.4,
        },
      },
    ];

    const depthTraces: ToTDepthTrace[] = [];
    let currentHyps = baseHypotheses;

    for (let depth = 1; depth <= maxDepth; depth++) {
      const scored: ToTHypothesisScore[] = currentHyps.map((h) => {
        const adjScores = { ...h.scores };
        if (
          depth > 1 &&
          (h.id === 'H1' || h.id === 'H2') &&
          !hasFaultLogs &&
          !hasApprovedCr
        ) {
          adjScores.evidence_match = round4(
            Math.max(0.0, adjScores.evidence_match - 0.05),
          );
        }
        const total = round4(
          weights.evidence_match * adjScores.evidence_match +
            weights.independent_corroboration *
              adjScores.independent_corroboration +
            weights.fit_to_requested_change * adjScores.fit_to_requested_change +
            weights.no_contradiction * adjScores.no_contradiction,
        );
        return {
          id: h.id,
          label: h.label,
          scores: adjScores,
          weighted_score: total,
        };
      });

      const nonNull = scored
        .filter((x) => x.id !== protectedNullId)
        .sort((a, b) => b.weighted_score - a.weighted_score);
      const retained = nonNull
        .filter((x) => x.weighted_score >= pruneFloor)
        .slice(0, beamWidth);
      const h4Item = scored.find((x) => x.id === protectedNullId)!;

      depthTraces.push({
        depth,
        retained_ids: [...retained.map((x) => x.id), protectedNullId],
        top_non_null: nonNull[0]?.id ?? null,
        top_non_null_score: nonNull[0]?.weighted_score ?? 0.0,
        h4_score: h4Item.weighted_score,
      });

      const keepIds = new Set([
        ...retained.map((x) => x.id),
        protectedNullId,
      ]);
      currentHyps = baseHypotheses.filter((h) => keepIds.has(h.id));
    }

    const finalScored: ToTHypothesisScore[] = baseHypotheses.map((h) => {
      const total = round4(
        weights.evidence_match * h.scores.evidence_match +
          weights.independent_corroboration *
            h.scores.independent_corroboration +
          weights.fit_to_requested_change * h.scores.fit_to_requested_change +
          weights.no_contradiction * h.scores.no_contradiction,
      );
      return {
        id: h.id,
        label: h.label,
        scores: { ...h.scores },
        weighted_score: total,
      };
    });

    const nonNullSorted = finalScored
      .filter((x) => x.id !== protectedNullId)
      .sort((a, b) => b.weighted_score - a.weighted_score);

    const pruned = nonNullSorted
      .filter((x) => x.weighted_score < pruneFloor)
      .map((x) => x.id);
    const survivingNonNull = nonNullSorted
      .filter((x) => x.weighted_score >= pruneFloor)
      .slice(0, beamWidth);

    const h4Entry = finalScored.find((x) => x.id === protectedNullId)!;
    const h4Score = h4Entry.weighted_score;
    const bestNonNull = nonNullSorted[0];
    const runnerUpNonNull = nonNullSorted[1] ?? null;
    const marginOverH4 = round4(bestNonNull.weighted_score - h4Score);
    const tieGap = runnerUpNonNull
      ? round4(bestNonNull.weighted_score - runnerUpNonNull.weighted_score)
      : 1.0;
    const isCloseTie = tieGap < tieDelta;

    let finding: FindingType;
    let winningHypothesis: string;

    if (
      hasMoratorium &&
      bestNonNull.id === 'H3' &&
      bestNonNull.weighted_score >= supportedThreshold &&
      marginOverH4 >= h4Margin &&
      !isCloseTie
    ) {
      finding = 'PolicyBlocked_Moratorium';
      winningHypothesis = bestNonNull.id;
    } else if (
      bestNonNull.weighted_score >= supportedThreshold &&
      marginOverH4 >= h4Margin &&
      !isCloseTie
    ) {
      finding = 'Supported';
      winningHypothesis = bestNonNull.id;
    } else if (
      bestNonNull.weighted_score >= inconclusiveCeiling ||
      h4Score >= supportedThreshold ||
      isCloseTie
    ) {
      finding = 'Inconclusive';
      winningHypothesis =
        h4Score > bestNonNull.weighted_score ? protectedNullId : bestNonNull.id;
    } else {
      finding = 'NotSupported';
      winningHypothesis = protectedNullId;
    }

    return {
      finding,
      winning_hypothesis: winningHypothesis,
      h4_score: h4Score,
      margin_over_h4: marginOverH4,
      tie_gap: tieGap,
      tie_delta: tieDelta,
      is_close_tie: isCloseTie,
      max_depth_evaluated: maxDepth,
      depth_traces: depthTraces,
      beam_retained: [...survivingNonNull.map((x) => x.id), protectedNullId],
      pruned_hypotheses: pruned,
      all_scores: finalScored,
      active_policies_applied: policyCtx.active_policy_ids,
      superseded_policies_ignored: policyCtx.superseded_policy_ids,
      has_approved_cr: hasApprovedCr,
      moratoriums,
    };
  }
}

export class CriticAgent {
  public review(
    _normReq: NormalizedRequest,
    evidence: EvidenceBundle,
    policyEval: PolicyEvaluationResult,
  ): CriticReviewResult {
    const objections: string[] = [];
    const proposedFinding = policyEval.finding;

    if (policyEval.active_policies_applied.includes('POL-CHG-001')) {
      objections.push('Superseded policy POL-CHG-001 leaked into active set.');
    }

    if (policyEval.is_close_tie) {
      objections.push(
        `Close hypothesis tie detected (gap=${policyEval.tie_gap} < ${policyEval.tie_delta}).`,
      );
    }

    if (proposedFinding === 'Supported') {
      const hasFault = evidence.splunk_events.some((e) =>
        ['WARNING', 'ERROR', 'CRITICAL'].includes(e.severity),
      );
      const hasCr = policyEval.has_approved_cr;
      if (!hasFault && !hasCr) {
        objections.push(
          'Supported finding lacks both fault telemetry and an approved CR.',
        );
      }
      if (policyEval.margin_over_h4 < 0.15) {
        objections.push(
          'Supported finding does not clear required H4 margin >= 0.15.',
        );
      }
    }

    if (objections.length > 0) {
      const adjustedFinding: FindingType =
        proposedFinding === 'Supported' ? 'Inconclusive' : proposedFinding;
      return {
        critic_verdict:
          adjustedFinding !== proposedFinding
            ? 'OVERRULED_TO_INCONCLUSIVE'
            : 'FLAGGED_CAUTION',
        approved_finding: adjustedFinding,
        objections,
      };
    }

    return {
      critic_verdict: 'APPROVED',
      approved_finding: proposedFinding,
      objections: [],
    };
  }
}

export class AccessBrokerAgent {
  public evaluateGrant(
    normReq: NormalizedRequest,
    policyEval: PolicyEvaluationResult,
    store: Phase1MockStore,
  ): PamDecisionResult {
    const userId = normReq.user_id;
    const host = normReq.target_host;
    const requestedTtl = normReq.requested_ttl_minutes;
    const finding = policyEval.finding;

    if (policyEval.moratoriums.length > 0) {
      return {
        decision: 'DENIED',
        reason: `Active operational moratorium: ${policyEval.moratoriums[0].reason}`,
        grant: null,
      };
    }

    if (finding !== 'Supported') {
      return {
        decision: 'DENIED',
        reason: `Policy finding is '${finding}' (requires 'Supported' with H4 margin >= 0.15).`,
        grant: null,
      };
    }

    const employee = store.employees.find((e) => e.user_id === userId);
    const eligibleEntry = Object.entries(store.cyberarkSafes).find(
      ([, cfg]) =>
        cfg.allowed_users.includes(userId) && cfg.allowed_hosts.includes(host),
    );

    if (!employee || !eligibleEntry) {
      return {
        decision: 'DENIED',
        reason: `User '${userId}' is not authorized in any PAM safe for target host '${host}'.`,
        grant: null,
      };
    }

    const [safeName, safeCfg] = eligibleEntry;
    const maxTtl = Math.min(
      employee.max_session_ttl_minutes,
      safeCfg.max_ttl_minutes,
    );
    const grantedTtl = Math.max(1, Math.min(requestedTtl, maxTtl));

    const grant: PamGrant = {
      grant_id: `grant-${normReq.request_id}`,
      user_id: userId,
      target_host: host,
      safe_name: safeName,
      ttl_minutes: grantedTtl,
      status: 'ACTIVE',
    };

    return {
      decision: 'APPROVED_JIT',
      reason: `Granted ${grantedTtl}m JIT session via ${safeName} (finding=${finding}).`,
      grant,
    };
  }

  public monitorRuntimeEvents(
    grant: PamGrant | null,
    store: Phase1MockStore,
  ): RuntimeAuditEvent[] {
    if (!grant || grant.status !== 'ACTIVE') {
      return [];
    }

    const auditLog: RuntimeAuditEvent[] = [];
    for (const ev of store.simulatedRuntimeEvents) {
      if (
        ev.user === grant.user_id &&
        ev.target_host === grant.target_host
      ) {
        if (!ev.in_scope) {
          grant.status = 'REVOKED';
          grant.revoked_reason = `Out-of-scope command detected (${ev.event_id}): ${ev.command}`;
          auditLog.push({
            event_id: ev.event_id,
            action: 'SESSION_REVOKED',
            command: ev.command,
            timestamp: ev.timestamp,
          });
        } else {
          auditLog.push({
            event_id: ev.event_id,
            action: 'ALLOWED_IN_SCOPE',
            command: ev.command,
            timestamp: ev.timestamp,
          });
        }
      }
    }
    return auditLog;
  }
}

export class ReporterAgent {
  public getCitedEventIds(evidence: EvidenceBundle): string[] {
    return evidence.splunk_events
      .filter((e) => ['WARNING', 'ERROR', 'CRITICAL'].includes(e.severity))
      .slice(0, 6)
      .map((e) => e.event_id ?? '')
      .filter(Boolean);
  }
}
