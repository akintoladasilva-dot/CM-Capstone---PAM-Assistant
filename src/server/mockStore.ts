import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentEnvelope,
  DeviceRecord,
  EmployeeRecord,
  JiraChangeRequest,
  JiraIncident,
  MoratoriumRecord,
  PolicyChunk,
  SafeConfig,
  SimulatedRuntimeEvent,
  SplunkEvent,
  ToTRubricConfig,
  ValidationReport,
} from '../shared/types.ts';

export function parseIsoTimestamp(ts: string): number {
  const normalized = ts.endsWith('Z') ? ts : ts;
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ISO timestamp: ${ts}`);
  }
  return ms;
}

const VALID_AGENTS = new Set([
  'intake',
  'orchestrator',
  'evidence',
  'policy',
  'reporter',
  'access_broker',
]);
const VALID_MODES = new Set(['one_way', 'two_way', 'tot_internal']);
const REQUIRED_MESSAGE_FIELDS = [
  'request_id',
  'source_agent',
  'target_agent',
  'communication_mode',
  'untrusted_data_fields',
  'payload',
] as const;

export class Phase1MockStore {
  public readonly assetsDir: string;
  public splunkLogs: SplunkEvent[] = [];
  public devices: DeviceRecord[] = [];
  public csvDevices: Array<Record<string, string>> = [];
  public employees: EmployeeRecord[] = [];
  public changeRequests: JiraChangeRequest[] = [];
  public incidents: JiraIncident[] = [];
  public moratoriums: MoratoriumRecord[] = [];
  public policies: PolicyChunk[] = [];
  public cyberarkSafes: Record<string, SafeConfig> = {};
  public simulatedRuntimeEvents: SimulatedRuntimeEvent[] = [];
  public rubricConfig!: ToTRubricConfig;

  constructor(assetsDir?: string) {
    this.assetsDir =
      assetsDir ?? path.resolve(process.cwd(), 'public', 'assets', 'aistudio');
  }

  public loadAll(): void {
    const splunkRaw = this.readJson<SplunkEvent[]>('splunk_logs-v3_ebcc0f56.json');
    if (!Array.isArray(splunkRaw)) {
      throw new Error('Splunk logs fixture must be a JSON array.');
    }
    this.splunkLogs = splunkRaw;

    const deviceObj = this.readJson<{ devices: DeviceRecord[] }>(
      'device_inventory_d42259c6.json',
    );
    this.devices = deviceObj.devices ?? [];

    const employeeObj = this.readJson<{ employees: EmployeeRecord[] }>(
      'employee_roster_83ebf790.json',
    );
    this.employees = employeeObj.employees ?? [];

    const jiraObj = this.readJson<{
      change_requests: JiraChangeRequest[];
      incidents: JiraIncident[];
      operations_calendar?: { moratoriums?: MoratoriumRecord[] };
    }>('jira_cr_and_incidents_995a5a96.json');
    this.changeRequests = jiraObj.change_requests ?? [];
    this.incidents = jiraObj.incidents ?? [];
    this.moratoriums = jiraObj.operations_calendar?.moratoriums ?? [];

    const policyObj = this.readJson<{ policy_chunks: PolicyChunk[] }>(
      'policy_vector_db_41f041bb.json',
    );
    this.policies = policyObj.policy_chunks ?? [];

    const cyberarkObj = this.readJson<{
      cyberark_state: {
        safes: Record<string, SafeConfig>;
        simulated_runtime_events: SimulatedRuntimeEvent[];
      };
    }>('cyberark_pam_c686c946.json');
    this.cyberarkSafes = cyberarkObj.cyberark_state?.safes ?? {};
    this.simulatedRuntimeEvents =
      cyberarkObj.cyberark_state?.simulated_runtime_events ?? [];

    const totObj = this.readJson<{ rubric_config: ToTRubricConfig }>(
      'tot_state_store_d48df9a1.json',
    );
    this.rubricConfig = totObj.rubric_config;

    this.csvDevices = this.readCsv('Capstone_Network_Inventory-v3_f56ef75a.csv');
  }

  private readJson<T>(filename: string): T {
    const fullPath = path.join(this.assetsDir, filename);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Missing fixture file: ${fullPath}`);
    }
    const raw = fs.readFileSync(fullPath, 'utf-8');
    return JSON.parse(raw) as T;
  }

  private readCsv(filename: string): Array<Record<string, string>> {
    const fullPath = path.join(this.assetsDir, filename);
    if (!fs.existsSync(fullPath)) {
      return [];
    }
    const lines = fs
      .readFileSync(fullPath, 'utf-8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      return [];
    }
    const headers = lines[0].split(',').map((h) => h.trim());
    return lines.slice(1).map((line) => {
      const cells = line.split(',').map((c) => c.trim());
      const row: Record<string, string> = {};
      headers.forEach((h, idx) => {
        row[h] = cells[idx] ?? '';
      });
      return row;
    });
  }

  public validateAgentMessage(msg: Partial<AgentEnvelope>): string[] {
    const errors: string[] = [];
    const keys = new Set(Object.keys(msg));
    const missing = REQUIRED_MESSAGE_FIELDS.filter((f) => !keys.has(f));
    if (missing.length > 0) {
      errors.push(`Missing required envelope fields: ${missing.join(', ')}`);
      return errors;
    }

    const src = msg.source_agent;
    const dst = msg.target_agent;
    const mode = msg.communication_mode;

    if (!src || !VALID_AGENTS.has(src)) {
      errors.push(`Invalid source_agent: ${String(src)}`);
    }
    if (!dst || !VALID_AGENTS.has(dst)) {
      errors.push(`Invalid target_agent: ${String(dst)}`);
    }
    if (!mode || !VALID_MODES.has(mode)) {
      errors.push(`Invalid communication_mode: ${String(mode)}`);
    }
    if (
      mode !== 'tot_internal' &&
      src !== 'orchestrator' &&
      dst !== 'orchestrator'
    ) {
      errors.push(
        `Hub-and-spoke violation: ${String(src)} -> ${String(dst)} bypasses orchestrator`,
      );
    }

    const attempts = msg.clarification_attempts ?? 0;
    if (!Number.isInteger(attempts) || attempts < 0 || attempts > 1) {
      errors.push(
        `clarification_attempts must be an integer in [0, 1], got ${String(attempts)}`,
      );
    }
    if (!Array.isArray(msg.untrusted_data_fields)) {
      errors.push('untrusted_data_fields must be a list of field names');
    }
    if (
      typeof msg.payload !== 'object' ||
      msg.payload === null ||
      Array.isArray(msg.payload)
    ) {
      errors.push('payload must be a JSON object');
    }

    return errors;
  }

  public validateAll(): ValidationReport {
    const errors: string[] = [];
    const warnings: string[] = [];

    const invHosts = new Set(this.devices.map((d) => d.hostname));
    const logHosts = new Set(
      this.splunkLogs.map((e) => e.host).filter(Boolean),
    );

    this.splunkLogs.forEach((ev, idx) => {
      for (const field of ['timestamp', 'host', 'ip', 'severity', 'message'] as const) {
        if (!ev[field]) {
          errors.push(`Splunk event #${idx} missing '${field}'`);
        }
      }
      if (ev.timestamp) {
        try {
          parseIsoTimestamp(ev.timestamp);
        } catch (err) {
          errors.push(
            `Splunk event #${idx} invalid timestamp '${ev.timestamp}': ${String(err)}`,
          );
        }
      }
    });

    const untrackedHosts = [...logHosts]
      .filter((h) => !invHosts.has(h))
      .sort();
    if (untrackedHosts.length > 0) {
      warnings.push(
        `Hosts in Splunk logs omitted from device_inventory.json: ${untrackedHosts.join(', ')}`,
      );
    }

    const weights = this.rubricConfig?.weights;
    if (weights) {
      const weightSum =
        weights.evidence_match +
        weights.independent_corroboration +
        weights.fit_to_requested_change +
        weights.no_contradiction;
      if (Math.abs(weightSum - 1.0) > 1e-6) {
        errors.push(`ToT rubric weights must sum to 1.0, got ${weightSum}`);
      }
    } else {
      errors.push('Missing rubric_config weights in tot_state_store');
    }

    const activePolicies = this.policies.filter((p) => p.status === 'Active');
    if (activePolicies.length === 0) {
      errors.push("No 'Active' policy chunks found in policy_vector_db.json");
    }

    const sampleMsg: AgentEnvelope = {
      request_id: 'req-phase1-check',
      source_agent: 'evidence',
      target_agent: 'orchestrator',
      communication_mode: 'one_way',
      clarification_attempts: 0,
      untrusted_data_fields: ['splunk_events'],
      payload: { finding: 'Inconclusive' },
    };
    errors.push(...this.validateAgentMessage(sampleMsg));

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      stats: {
        splunk_event_count: this.splunkLogs.length,
        inventory_device_count: this.devices.length,
        csv_device_count: this.csvDevices.length,
        employee_count: this.employees.length,
        active_policy_count: activePolicies.length,
        superseded_policy_count: this.policies.filter(
          (p) => p.status !== 'Active',
        ).length,
        cr_count: this.changeRequests.length,
        incident_count: this.incidents.length,
        moratorium_count: this.moratoriums.length,
      },
    };
  }

  public querySplunk(options: {
    host?: string | null;
    windowStart?: string | null;
    windowEnd?: string | null;
    windowPaddingHours?: number;
    severityIn?: string[] | null;
    keywordRegex?: string | null;
    maxEvents?: number;
  }): {
    matched_count: number;
    too_broad_gt_10000: boolean;
    events: SplunkEvent[];
  } {
    const paddingMs = (options.windowPaddingHours ?? 2.0) * 3600 * 1000;
    const startMs = options.windowStart
      ? parseIsoTimestamp(options.windowStart) - paddingMs
      : null;
    const endMs = options.windowEnd
      ? parseIsoTimestamp(options.windowEnd) + paddingMs
      : null;
    const pattern = options.keywordRegex
      ? new RegExp(options.keywordRegex, 'i')
      : null;
    const sevSet = options.severityIn
      ? new Set(options.severityIn.map((s) => s.toUpperCase()))
      : null;
    const maxEvents = options.maxEvents ?? 10000;

    const matches: SplunkEvent[] = [];
    for (let idx = 0; idx < this.splunkLogs.length; idx++) {
      const ev = this.splunkLogs[idx];
      if (options.host && ev.host !== options.host) {
        continue;
      }
      const evMs = parseIsoTimestamp(ev.timestamp);
      if (startMs !== null && evMs < startMs) {
        continue;
      }
      if (endMs !== null && evMs > endMs) {
        continue;
      }
      if (sevSet && !sevSet.has((ev.severity ?? '').toUpperCase())) {
        continue;
      }
      if (pattern && !pattern.test(ev.message ?? '')) {
        continue;
      }
      matches.push({
        event_id: `splunk_v3#${idx}`,
        ...ev,
      });
    }

    const tooBroad = matches.length > maxEvents;
    return {
      matched_count: matches.length,
      too_broad_gt_10000: tooBroad,
      events: tooBroad ? [] : matches,
    };
  }
}
