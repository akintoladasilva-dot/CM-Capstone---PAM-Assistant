import { useState } from 'react';
import { CheckCircle2, Ban, Search } from 'lucide-react';
import type {
  DeviceRecord,
  EmployeeRecord,
  JiraChangeRequest,
  JiraIncident,
  MoratoriumRecord,
  PolicyChunk,
  SafeConfig,
  SimulatedRuntimeEvent,
  ToTRubricConfig,
} from '../shared/types';

interface FixturesViewProps {
  devices: DeviceRecord[];
  employees: EmployeeRecord[];
  policies: PolicyChunk[];
  safes: Record<string, SafeConfig>;
  runtimeEvents: SimulatedRuntimeEvent[];
  changeRequests: JiraChangeRequest[];
  incidents: JiraIncident[];
  moratoriums: MoratoriumRecord[];
  rubricConfig: ToTRubricConfig;
}

export function FixturesView({
  devices,
  employees,
  policies,
  safes,
  runtimeEvents,
  changeRequests,
  incidents,
  moratoriums,
  rubricConfig,
}: FixturesViewProps) {
  const [deviceSearch, setDeviceSearch] = useState('');

  const filteredDevices = devices.filter((d) => {
    const q = deviceSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      d.hostname.toLowerCase().includes(q) ||
      d.ip.includes(q) ||
      d.role.toLowerCase().includes(q) ||
      d.zone.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8">
      {/* Policy Store & Rubric */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-base font-semibold text-slate-900">
            Policy Vector Store
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            PolicyContextAgent enforces strict status filtering: Active chunks
            are passed to ToT, while Superseded chunks are blocked and audited.
          </p>

          <div className="divide-y divide-slate-200 mt-4">
            {policies.map((pol) => {
              const isActive = pol.status === 'Active';
              return (
                <div key={pol.doc_id} className="py-4 first:pt-2 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <span className="font-mono">{pol.doc_id}</span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span>{pol.title}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-slate-500">
                        {pol.version}
                      </span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      {isActive ? (
                        <span className="inline-flex items-center gap-1 font-medium text-green-700">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-medium text-red-700">
                          <Ban className="w-3.5 h-3.5" />
                          Superseded (Excluded)
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 mt-1.5 leading-relaxed">
                    {pol.content}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-base font-semibold text-slate-900">
            ToT Beam Rubric Config
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Bounded Tree-of-Thought thresholds loaded from tot_state_store.
          </p>

          <dl className="mt-4 divide-y divide-slate-100 text-xs">
            <div className="py-2 flex justify-between">
              <dt className="text-slate-600">Beam Width / Max Depth</dt>
              <dd className="font-mono font-medium text-slate-900">
                {rubricConfig.beam_width} / {rubricConfig.max_depth}
              </dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-slate-600">Protected Null ID</dt>
              <dd className="font-mono font-medium text-slate-900">
                {rubricConfig.protected_null_hypothesis_id}
              </dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-slate-600">Supported Threshold</dt>
              <dd className="font-mono font-medium text-slate-900">
                {rubricConfig.supported_threshold.toFixed(2)}
              </dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-slate-600">Required H4 Margin</dt>
              <dd className="font-mono font-medium text-slate-900">
                &ge; {rubricConfig.h4_required_margin.toFixed(2)}
              </dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-slate-600">Close-Tie Delta</dt>
              <dd className="font-mono font-medium text-slate-900">
                &lt; {rubricConfig.tie_delta.toFixed(2)}
              </dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-slate-600">Prune Floor</dt>
              <dd className="font-mono font-medium text-slate-900">
                {rubricConfig.prune_floor.toFixed(2)}
              </dd>
            </div>
            <div className="py-2 flex justify-between">
              <dt className="text-slate-600">
                Weights (Ev / Cor / Fit / NoCon)
              </dt>
              <dd className="font-mono font-medium text-slate-900">
                {rubricConfig.weights.evidence_match}/
                {rubricConfig.weights.independent_corroboration}/
                {rubricConfig.weights.fit_to_requested_change}/
                {rubricConfig.weights.no_contradiction}
              </dd>
            </div>
          </dl>
        </section>
      </div>

      {/* CyberArk PAM Safes & ITSM */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-base font-semibold text-slate-900">
            CyberArk PAM Safes & Runtime Audit Hooks
          </h2>
          <div className="divide-y divide-slate-200 mt-4 text-xs">
            {Object.entries(safes).map(([safeName, cfg]) => (
              <div key={safeName} className="py-3 first:pt-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-semibold text-slate-900">
                    {safeName}
                  </span>
                  <span className="font-mono text-slate-600">
                    Max TTL: {cfg.max_ttl_minutes}m
                  </span>
                </div>
                <div className="mt-1 text-slate-600">
                  Users:{' '}
                  <span className="font-mono text-slate-800">
                    {cfg.allowed_users.join(', ')}
                  </span>{' '}
                  · Hosts:{' '}
                  <span className="font-mono text-slate-800">
                    {cfg.allowed_hosts.join(', ')}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <h3 className="text-xs font-semibold text-slate-700 mt-5 mb-2">
            Simulated Runtime Command Events
          </h3>
          <div className="divide-y divide-slate-100 border-t border-slate-200 text-xs">
            {runtimeEvents.map((ev) => (
              <div key={ev.event_id} className="py-2.5 space-y-1">
                <div className="flex items-center justify-between font-mono">
                  <span className="text-slate-700">
                    {ev.event_id} · {ev.user}@{ev.target_host}
                  </span>
                  <span
                    className={
                      ev.in_scope
                        ? 'text-green-700 font-medium'
                        : 'text-red-700 font-semibold'
                    }
                  >
                    {ev.in_scope ? 'In Scope' : 'Out of Scope (Revokes)'}
                  </span>
                </div>
                <div className="font-mono text-slate-600 bg-slate-50 px-2.5 py-1.5 rounded">
                  {ev.command}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white border border-slate-200 rounded-lg p-6">
          <h2 className="text-base font-semibold text-slate-900">
            Jira ITSM & Operations Calendar
          </h2>

          <div className="mt-4 space-y-4 text-xs">
            <div>
              <h3 className="font-semibold text-slate-700 mb-1.5">
                Change Requests ({changeRequests.length})
              </h3>
              {changeRequests.map((cr) => (
                <div
                  key={cr.cr_id}
                  className="py-2 border-t border-slate-100 flex flex-wrap justify-between gap-2"
                >
                  <div>
                    <span className="font-mono font-semibold text-slate-900">
                      {cr.cr_id}
                    </span>{' '}
                    · <span className="font-mono">{cr.target_host}</span> ·{' '}
                    <span className="text-slate-600">{cr.change_type}</span>
                  </div>
                  <div className="font-mono text-green-700 font-medium">
                    {cr.status}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <h3 className="font-semibold text-slate-700 mb-1.5">
                Incidents ({incidents.length})
              </h3>
              {incidents.map((inc) => (
                <div
                  key={inc.inc_id}
                  className="py-2 border-t border-slate-100 flex flex-wrap justify-between gap-2"
                >
                  <div>
                    <span className="font-mono font-semibold text-slate-900">
                      {inc.inc_id}
                    </span>{' '}
                    · <span className="font-mono">{inc.target_host}</span> ·{' '}
                    <span className="text-slate-600">{inc.summary}</span>
                  </div>
                  <div className="font-mono text-amber-700 font-medium">
                    {inc.status}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <h3 className="font-semibold text-slate-700 mb-1.5">
                Operations Moratoriums ({moratoriums.length})
              </h3>
              {moratoriums.map((mor) => (
                <div
                  key={mor.moratorium_id}
                  className="py-2 border-t border-slate-100 space-y-1"
                >
                  <div className="flex justify-between">
                    <span className="font-mono font-semibold text-slate-900">
                      {mor.moratorium_id}
                    </span>
                    <span className="font-mono text-red-700 font-medium">
                      {mor.reason}
                    </span>
                  </div>
                  <div className="text-slate-600">
                    Zones: {mor.target_zones.join(', ')}
                  </div>
                </div>
              ))}
            </div>

            <div>
              <h3 className="font-semibold text-slate-700 mb-1.5">
                Employee Roster ({employees.length})
              </h3>
              {employees.map((emp) => (
                <div
                  key={emp.user_id}
                  className="py-2 border-t border-slate-100 flex flex-wrap justify-between gap-2"
                >
                  <div>
                    <span className="font-mono font-semibold text-slate-900">
                      {emp.user_id}
                    </span>{' '}
                    · {emp.role} ·{' '}
                    <span className="font-mono text-slate-600">
                      {emp.pam_eligible_safes.join(', ')}
                    </span>
                  </div>
                  <div className="font-mono text-slate-700">
                    Max TTL {emp.max_session_ttl_minutes}m ·{' '}
                    {emp.change_history.completed_on_time}/
                    {emp.change_history.total_requests} on-time
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* 28-Device Inventory */}
      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Network Device Inventory ({devices.length} Hosts)
            </h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Validated against Capstone_Network_Inventory-v3.csv and Splunk
              event hostnames.
            </p>
          </div>
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Filter hostname, IP, zone..."
              value={deviceSearch}
              onChange={(e) => setDeviceSearch(e.target.value)}
              className="w-full h-9 pl-8 pr-3 text-xs bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="py-2.5 px-4 whitespace-nowrap">Hostname</th>
                <th className="py-2.5 px-4 whitespace-nowrap">IP Address</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Role</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Zone</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Criticality</th>
                <th className="py-2.5 px-4 whitespace-nowrap">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredDevices.map((d) => (
                <tr key={d.hostname} className="hover:bg-slate-50">
                  <td className="py-2.5 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                    {d.hostname}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                    {d.ip}
                  </td>
                  <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap">
                    {d.role}
                  </td>
                  <td className="py-2.5 px-4 text-slate-600">{d.zone}</td>
                  <td className="py-2.5 px-4 font-mono text-slate-700 whitespace-nowrap">
                    {d.criticality}
                  </td>
                  <td
                    className={`py-2.5 px-4 font-mono whitespace-nowrap ${
                      d.status === 'active'
                        ? 'text-green-700'
                        : 'text-amber-700 font-medium'
                    }`}
                  >
                    {d.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
