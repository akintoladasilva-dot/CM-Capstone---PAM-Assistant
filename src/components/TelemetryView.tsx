import { useEffect, useState } from 'react';
import { Search, RotateCcw } from 'lucide-react';
import type { DeviceRecord, SplunkEvent } from '../shared/types';

interface TelemetryViewProps {
  devices: DeviceRecord[];
}

const SEVERITIES = ['INFO', 'WARNING', 'ERROR', 'CRITICAL'] as const;

export function TelemetryView({ devices }: TelemetryViewProps) {
  const [host, setHost] = useState<string>('');
  const [windowStart, setWindowStart] = useState<string>('2025-11-17T00:00:00Z');
  const [windowEnd, setWindowEnd] = useState<string>('2025-11-17T23:59:59Z');
  const [paddingHours, setPaddingHours] = useState<number>(2);
  const [selectedSeverities, setSelectedSeverities] = useState<string[]>([
    'WARNING',
    'ERROR',
    'CRITICAL',
  ]);
  const [keywordRegex, setKeywordRegex] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [matchedCount, setMatchedCount] = useState<number>(0);
  const [tooBroad, setTooBroad] = useState<boolean>(false);
  const [events, setEvents] = useState<SplunkEvent[]>([]);

  const runQuery = async (override?: {
    host?: string;
    severities?: string[];
    regex?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/splunk/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: (override?.host !== undefined ? override.host : host) || null,
          window_start: windowStart || null,
          window_end: windowEnd || null,
          window_padding_hours: paddingHours,
          severity_in:
            override?.severities !== undefined
              ? override.severities
              : selectedSeverities,
          keyword_regex:
            (override?.regex !== undefined ? override.regex : keywordRegex) ||
            null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Splunk query failed');
      }
      setMatchedCount(data.matched_count);
      setTooBroad(Boolean(data.too_broad_gt_10000));
      setEvents(data.events ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Query failed');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runQuery();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleSeverity = (sev: string) => {
    setSelectedSeverities((prev) =>
      prev.includes(sev) ? prev.filter((s) => s !== sev) : [...prev, sev],
    );
  };

  const resetFilters = () => {
    setHost('');
    setWindowStart('2025-11-17T00:00:00Z');
    setWindowEnd('2025-11-17T23:59:59Z');
    setPaddingHours(2);
    setSelectedSeverities(['WARNING', 'ERROR', 'CRITICAL']);
    setKeywordRegex('');
    void runQuery({
      host: '',
      severities: ['WARNING', 'ERROR', 'CRITICAL'],
      regex: '',
    });
  };

  const severityColor = (sev: string) => {
    if (sev === 'CRITICAL' || sev === 'ERROR') return 'text-red-700';
    if (sev === 'WARNING') return 'text-amber-700';
    return 'text-slate-600';
  };

  return (
    <div className="space-y-6">
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Scoped Splunk MCP Query Emulator
            </h2>
            <p className="text-sm text-slate-600 mt-1">
              Queries the 713-event telemetry dataset with configurable window
              padding and max-event guardrails.
            </p>
          </div>
          <div className="font-mono text-xs text-slate-600 tabular-nums">
            Matched: <span className="font-semibold text-slate-900">{matchedCount}</span> events
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-5">
          <div>
            <label
              htmlFor="splunk-host"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Target Host
            </label>
            <select
              id="splunk-host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            >
              <option value="">All Hosts (28)</option>
              {devices.map((d) => (
                <option key={d.hostname} value={d.hostname}>
                  {d.hostname} ({d.role})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="splunk-start"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Window Start (UTC)
            </label>
            <input
              id="splunk-start"
              type="text"
              value={windowStart}
              onChange={(e) => setWindowStart(e.target.value)}
              className="w-full h-10 px-3 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            />
          </div>

          <div>
            <label
              htmlFor="splunk-end"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Window End (UTC)
            </label>
            <input
              id="splunk-end"
              type="text"
              value={windowEnd}
              onChange={(e) => setWindowEnd(e.target.value)}
              className="w-full h-10 px-3 text-xs font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            />
          </div>

          <div>
            <label
              htmlFor="splunk-regex"
              className="block text-xs font-medium text-slate-700 mb-1.5"
            >
              Message Regex Filter
            </label>
            <input
              id="splunk-regex"
              type="text"
              placeholder="e.g. unreachable|ERR_CERT"
              value={keywordRegex}
              onChange={(e) => setKeywordRegex(e.target.value)}
              className="w-full h-10 px-3 text-sm bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 mt-5 pt-4 border-t border-slate-100">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-md">
              {SEVERITIES.map((sev) => {
                const active = selectedSeverities.includes(sev);
                return (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => toggleSeverity(sev)}
                    className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {sev}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-600">
              <label htmlFor="splunk-padding" className="whitespace-nowrap">
                Window Padding (hrs):
              </label>
              <input
                id="splunk-padding"
                type="number"
                min={0}
                max={12}
                step={0.5}
                value={paddingHours}
                onChange={(e) => setPaddingHours(Number(e.target.value))}
                className="w-16 h-8 px-2 font-mono text-xs border border-slate-300 rounded-md text-slate-900"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </button>
            <button
              type="button"
              onClick={() => void runQuery()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Search className="w-3.5 h-3.5" />
              {loading ? 'Querying...' : 'Run Query'}
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {error}
        </div>
      )}

      {tooBroad && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          Query returned more than 10,000 events and was truncated by the Splunk
          MCP safety guardrail. Narrow the host or time window.
        </div>
      )}

      <section className="bg-white border border-slate-200 rounded-lg overflow-hidden">
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
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="h-10">
                    <td className="px-4 py-2" colSpan={5}>
                      <div className="h-4 bg-slate-100 rounded w-full" />
                    </td>
                  </tr>
                ))
              ) : events.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-10 px-4 text-center text-sm text-slate-500"
                  >
                    No Splunk events matched the current query constraints.
                  </td>
                </tr>
              ) : (
                events.slice(0, 150).map((ev) => (
                  <tr
                    key={ev.event_id}
                    className="hover:bg-slate-50 transition-colors"
                  >
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {ev.event_id}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-slate-600 whitespace-nowrap">
                      {ev.timestamp}
                    </td>
                    <td className="py-2.5 px-4 font-mono font-medium text-slate-900 whitespace-nowrap">
                      {ev.host}
                    </td>
                    <td
                      className={`py-2.5 px-4 font-mono font-semibold whitespace-nowrap ${severityColor(ev.severity)}`}
                    >
                      {ev.severity}
                    </td>
                    <td className="py-2.5 px-4 text-slate-700 leading-relaxed">
                      {ev.message}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {events.length > 150 && (
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 text-xs text-slate-600">
            Showing first 150 of {events.length} matched events.
          </div>
        )}
      </section>
    </div>
  );
}
