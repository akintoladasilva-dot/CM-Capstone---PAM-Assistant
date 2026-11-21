/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  JiraChangeRequest,
  JiraIncident,
  MoratoriumRecord,
  SplunkEvent,
} from '../shared/types';

export type DebugDrawerTab = 'stream' | 'evidence' | 'splunk';

export interface ActiveEvidenceTelemetry {
  splunk_matched_count: number;
  too_broad_gt_10000: boolean;
  timeout_error: string | null;
  splunk_events: SplunkEvent[];
  corroborating_events: SplunkEvent[];
  approved_crs: JiraChangeRequest[];
  incidents: JiraIncident[];
  active_moratoriums: MoratoriumRecord[];
}
