import type { AgentEnvelope, AgentRole, OrchestrationStepEvent } from '../shared/types';

interface HubSpokeDiagramProps {
  steps: OrchestrationStepEvent[];
  envelopes: AgentEnvelope[];
  isRunning: boolean;
  selectedEnvelopeIndex: number | null;
  onSelectEnvelope: (index: number) => void;
}

interface NodeConfig {
  id: string;
  role: AgentRole | 'tot';
  label: string;
  sublabel: string;
  x: number;
  y: number;
}

const SPOKE_NODES: NodeConfig[] = [
  { id: 'intake', role: 'intake', label: 'Intake Agent', sublabel: 'Sanitize & Retry', x: 110, y: 72 },
  { id: 'evidence', role: 'evidence', label: 'Evidence Agent', sublabel: 'Splunk & Jira MCP', x: 530, y: 72 },
  { id: 'policy_ctx', role: 'policy', label: 'Policy Context', sublabel: 'Active Chunks Only', x: 570, y: 175 },
  { id: 'tot', role: 'tot', label: 'ToT & Blind Critic', sublabel: 'Beam Depth 3 + H4', x: 530, y: 278 },
  { id: 'access_broker', role: 'access_broker', label: 'Access Broker', sublabel: 'PAM Safe & Revoke', x: 110, y: 278 },
  { id: 'reporter', role: 'reporter', label: 'Reporter Agent', sublabel: 'Audit Citations', x: 70, y: 175 },
];

const HUB_POS = { x: 320, y: 175 };

export function HubSpokeDiagram({
  steps,
  envelopes,
  isRunning,
  selectedEnvelopeIndex,
  onSelectEnvelope,
}: HubSpokeDiagramProps) {
  const completedSteps = new Set(steps.map((s) => s.step));

  const isNodeActive = (id: string) => {
    if (id === 'intake') return completedSteps.has('intake');
    if (id === 'evidence') return completedSteps.has('evidence');
    if (id === 'policy_ctx') return completedSteps.has('policy_ctx');
    if (id === 'tot') return completedSteps.has('tot_eval') || completedSteps.has('critic');
    if (id === 'access_broker') return completedSteps.has('access_broker');
    if (id === 'reporter') return completedSteps.has('reporter');
    return false;
  };

  const findEnvelopeIdxForNode = (nodeId: string): number => {
    if (nodeId === 'intake') return envelopes.findIndex((e) => e.target_agent === 'intake');
    if (nodeId === 'evidence') return envelopes.findIndex((e) => e.target_agent === 'evidence');
    if (nodeId === 'policy_ctx')
      return envelopes.findIndex(
        (e) => e.target_agent === 'policy' && e.communication_mode === 'one_way',
      );
    if (nodeId === 'tot')
      return envelopes.findIndex((e) => e.communication_mode === 'tot_internal');
    if (nodeId === 'access_broker')
      return envelopes.findIndex((e) => e.target_agent === 'access_broker');
    if (nodeId === 'reporter') return envelopes.findIndex((e) => e.target_agent === 'reporter');
    return -1;
  };

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox="0 0 640 350"
        className="w-full h-auto min-w-[520px] select-none"
        role="img"
        aria-label="Hub-and-Spoke Multi-Agent Orchestration Topology"
      >
        <defs>
          <marker
            id="arrow-active"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#0f172a" />
          </marker>
          <marker
            id="arrow-idle"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill="#cbd5e1" />
          </marker>
        </defs>

        {/* Spokes connecting Hub to each Agent */}
        {SPOKE_NODES.map((node) => {
          const active = isNodeActive(node.id);
          return (
            <line
              key={`line-${node.id}`}
              x1={HUB_POS.x}
              y1={HUB_POS.y}
              x2={node.x}
              y2={node.y}
              stroke={active ? '#0f172a' : '#cbd5e1'}
              strokeWidth={active ? 1.75 : 1.25}
              strokeDasharray={node.id === 'tot' ? '4 3' : undefined}
              markerEnd={active ? 'url(#arrow-active)' : 'url(#arrow-idle)'}
            />
          );
        })}

        {/* Central Hub Node */}
        <g transform={`translate(${HUB_POS.x - 84}, ${HUB_POS.y - 36})`}>
          <rect
            width="168"
            height="72"
            rx="8"
            fill="#0f172a"
            stroke="#0f172a"
            strokeWidth="1.5"
          />
          <text
            x="84"
            y="30"
            textAnchor="middle"
            fill="#ffffff"
            fontSize="13"
            fontWeight="600"
            fontFamily="Plus Jakarta Sans, sans-serif"
          >
            Hub Orchestrator
          </text>
          <text
            x="84"
            y="49"
            textAnchor="middle"
            fill="#94a3b8"
            fontSize="11"
            fontFamily="JetBrains Mono, monospace"
          >
            {isRunning
              ? 'DISPATCHING...'
              : envelopes.length > 0
                ? `${envelopes.length} ENVELOPES OK`
                : 'ENVELOPE ROUTER'}
          </text>
        </g>

        {/* Spoke Agent Nodes */}
        {SPOKE_NODES.map((node) => {
          const active = isNodeActive(node.id);
          const envIdx = findEnvelopeIdxForNode(node.id);
          const isSelected = envIdx >= 0 && selectedEnvelopeIndex === envIdx;

          return (
            <g
              key={node.id}
              transform={`translate(${node.x - 74}, ${node.y - 28})`}
              onClick={() => {
                if (envIdx >= 0) onSelectEnvelope(envIdx);
              }}
              className={envIdx >= 0 ? 'cursor-pointer' : 'cursor-default'}
            >
              <rect
                width="148"
                height="56"
                rx="6"
                fill={isSelected ? '#f1f5f9' : '#ffffff'}
                stroke={isSelected ? '#2563eb' : active ? '#0f172a' : '#cbd5e1'}
                strokeWidth={isSelected ? 2 : active ? 1.5 : 1}
              />
              <text
                x="74"
                y="24"
                textAnchor="middle"
                fill={active ? '#0f172a' : '#64748b'}
                fontSize="12"
                fontWeight="600"
                fontFamily="Plus Jakarta Sans, sans-serif"
              >
                {node.label}
              </text>
              <text
                x="74"
                y="41"
                textAnchor="middle"
                fill={active ? '#334155' : '#94a3b8'}
                fontSize="10.5"
                fontFamily="JetBrains Mono, monospace"
              >
                {node.sublabel}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
