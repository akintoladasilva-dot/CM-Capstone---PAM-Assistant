export type AgentRole =
  | 'intake'
  | 'orchestrator'
  | 'evidence'
  | 'policy'
  | 'reporter'
  | 'access_broker';

export type CommunicationMode = 'one_way' | 'two_way' | 'tot_internal';

export type FindingType =
  | 'Supported'
  | 'Inconclusive'
  | 'NotSupported'
  | 'PolicyBlocked_Moratorium';

export type CriticVerdict =
  | 'APPROVED'
  | 'FLAGGED_CAUTION'
  | 'OVERRULED_TO_INCONCLUSIVE';

export type PamDecision = 'APPROVED_JIT' | 'DENIED';

export interface AgentEnvelope {
  request_id: string;
  source_agent: AgentRole;
  target_agent: AgentRole;
  communication_mode: CommunicationMode;
  clarification_attempts: number;
  untrusted_data_fields: string[];
  payload: Record<string, unknown>;
  timestamp_ms?: number;
}

export interface SplunkEvent {
  event_id?: string;
  timestamp: string;
  host: string;
  ip: string;
  role?: string;
  severity: string;
  message: string;
}

export interface DeviceRecord {
  hostname: string;
  ip: string;
  mac: string;
  role: string;
  assignment: string;
  zone: string;
  status: string;
  criticality: string;
}

export interface EmployeeRecord {
  user_id: string;
  display_name: string;
  role: string;
  department: string;
  pam_eligible_safes: string[];
  max_session_ttl_minutes: number;
  change_history: {
    total_requests: number;
    completed_on_time: number;
    missed_window_or_failed: number;
    historical_patterns: string[];
  };
}

export interface JiraChangeRequest {
  cr_id: string;
  status: string;
  target_host: string;
  change_type: string;
  window_start: string;
  window_end: string;
  requested_by: string;
  impact_tier: string;
}

export interface JiraIncident {
  inc_id: string;
  status: string;
  target_host: string;
  summary: string;
  created_at: string;
}

export interface MoratoriumRecord {
  moratorium_id: string;
  target_zones: string[];
  start: string;
  end: string;
  reason: string;
}

export interface PolicyChunk {
  doc_id: string;
  version: string;
  status: 'Active' | 'Superseded' | string;
  title: string;
  content: string;
}

export interface SafeConfig {
  allowed_users: string[];
  allowed_hosts: string[];
  max_ttl_minutes: number;
}

export interface SimulatedRuntimeEvent {
  event_id: string;
  timestamp: string;
  user: string;
  target_host: string;
  command: string;
  in_scope: boolean;
}

export interface ToTRubricConfig {
  weights: {
    evidence_match: number;
    independent_corroboration: number;
    fit_to_requested_change: number;
    no_contradiction: number;
  };
  beam_width: number;
  protected_null_hypothesis_id: string;
  max_depth: number;
  supported_threshold: number;
  inconclusive_ceiling: number;
  prune_floor: number;
  h4_required_margin: number;
  tie_delta: number;
}

export interface AccessRequestInput {
  request_id: string;
  user_id: string;
  target_host: string;
  window_start: string;
  window_end: string;
  is_break_fix: boolean;
  claimed_issue: string;
  requested_ttl_minutes?: number;
  simulate_timeout?: boolean;
  requested_policy_id?: string | null;
}

export interface NormalizedRequest {
  request_id: string;
  user_id: string;
  target_host: string;
  device_meta: DeviceRecord;
  window_start: string;
  window_end: string;
  is_break_fix: boolean;
  claimed_issue: string;
  redacted_directives: string[];
  requested_ttl_minutes: number;
  simulate_timeout: boolean;
  requested_policy_id: string | null;
}

export interface EvidenceBundle {
  splunk_matched_count: number;
  too_broad_gt_10000: boolean;
  splunk_events: SplunkEvent[];
  corroborating_events: SplunkEvent[];
  approved_crs: JiraChangeRequest[];
  incidents: JiraIncident[];
  active_moratoriums: MoratoriumRecord[];
  timeout_error?: string;
}

export interface PolicyContextBundle {
  active_policies: PolicyChunk[];
  active_policy_ids: string[];
  superseded_policy_ids: string[];
}

export interface ToTHypothesisScore {
  id: string;
  label: string;
  scores: {
    evidence_match: number;
    independent_corroboration: number;
    fit_to_requested_change: number;
    no_contradiction: number;
  };
  weighted_score: number;
}

export interface ToTDepthTrace {
  depth: number;
  retained_ids: string[];
  top_non_null: string | null;
  top_non_null_score: number;
  h4_score: number;
}

export interface PolicyEvaluationResult {
  finding: FindingType;
  winning_hypothesis: string;
  h4_score: number;
  margin_over_h4: number;
  tie_gap: number;
  tie_delta: number;
  is_close_tie: boolean;
  max_depth_evaluated: number;
  depth_traces: ToTDepthTrace[];
  beam_retained: string[];
  pruned_hypotheses: string[];
  all_scores: ToTHypothesisScore[];
  active_policies_applied: string[];
  superseded_policies_ignored: string[];
  has_approved_cr: boolean;
  moratoriums: MoratoriumRecord[];
  timeout_fallback?: boolean;
}

export interface CriticReviewResult {
  critic_verdict: CriticVerdict;
  approved_finding: FindingType;
  objections: string[];
}

export interface PamGrant {
  grant_id: string;
  user_id: string;
  target_host: string;
  safe_name: string;
  ttl_minutes: number;
  status: 'ACTIVE' | 'REVOKED';
  revoked_reason?: string;
}

export interface PamDecisionResult {
  decision: PamDecision;
  reason: string;
  grant: PamGrant | null;
}

export interface RuntimeAuditEvent {
  event_id: string;
  action: 'ALLOWED_IN_SCOPE' | 'SESSION_REVOKED';
  command: string;
  timestamp?: string;
}

export interface GeminiAuditSynthesis {
  model: string;
  executive_summary: string;
  hypothesis_narrative: string;
  security_posture_note: string;
}

export interface OrchestrationReport {
  request_id: string;
  target_host: string;
  user_id: string;
  finding: FindingType;
  winning_hypothesis: string;
  h4_score: number;
  margin_over_h4: number;
  tie_gap: number;
  max_depth_evaluated: number;
  critic_verdict: CriticVerdict;
  critic_objections: string[];
  pam_decision: PamDecision;
  pam_reason: string;
  grant_final_state: PamGrant | null;
  runtime_audit: RuntimeAuditEvent[];
  timeout_fallback: boolean;
  cited_splunk_event_ids: string[];
  policies_used: string[];
  superseded_policies_ignored: string[];
  clarification_retried: boolean;
  redacted_directives: string[];
  trace_message_count: number;
  duration_ms: number;
  normalized_request: NormalizedRequest;
  evidence: EvidenceBundle;
  policy_eval: PolicyEvaluationResult;
  message_trace: AgentEnvelope[];
  gemini_synthesis?: GeminiAuditSynthesis;
  gemini_error?: string;
}

export interface OrchestrationStepEvent {
  step:
    | 'nl_parse'
    | 'intake'
    | 'clarification'
    | 'fan_out'
    | 'evidence'
    | 'policy_ctx'
    | 'tot_eval'
    | 'critic'
    | 'access_broker'
    | 'reporter'
    | 'gemini_synthesis'
    | 'complete';
  label: string;
  detail: string;
  envelope?: AgentEnvelope;
  telemetry?: Record<string, unknown>;
  duration_ms: number;
}

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    splunk_event_count: number;
    inventory_device_count: number;
    csv_device_count: number;
    employee_count: number;
    active_policy_count: number;
    superseded_policy_count: number;
    cr_count: number;
    incident_count: number;
    moratorium_count: number;
  };
}

export interface BenchmarkCase {
  case_id: string;
  category:
    | 'true_positive'
    | 'pretext_or_healthy'
    | 'adversarial_injection'
    | 'moratorium_or_acl'
    | 'stale_policy'
    | 'tie_breaking'
    | 'timeout_fallback'
    | 'edge_validation';
  description: string;
  request: AccessRequestInput;
  expected_findings: FindingType[];
  expected_pam_decisions: PamDecision[];
  must_block_or_revoke?: boolean;
  expected_max_ttl?: number;
}

export interface BenchmarkCaseResult {
  case_id: string;
  category: BenchmarkCase['category'];
  description: string;
  passed: boolean;
  finding: FindingType;
  expected_findings: FindingType[];
  pam_decision: PamDecision;
  expected_pam_decisions: PamDecision[];
  h4_score: number;
  margin_over_h4: number;
  tie_gap: number;
  critic_verdict: CriticVerdict;
  timeout_fallback: boolean;
  security_ok: boolean;
  cited_splunk_event_ids: string[];
  report: OrchestrationReport;
}

export interface BenchmarkSummary {
  total_cases: number;
  passed_cases: number;
  pass_rate: number;
  pretext_and_adversarial_cases: number;
  false_supported_count: number;
  false_supported_rate: number;
  stale_policy_cases: number;
  stale_policy_approval_rate: number;
  duration_ms: number;
  results: BenchmarkCaseResult[];
}
