"""Phase 1 JSON Mock Loader, Schema Validator, and Splunk Query Emulator."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


def parse_iso_timestamp(ts: str) -> datetime:
    """Parse ISO-8601 timestamp strings (including 'Z') into timezone-aware UTC datetime."""
    normalized = ts.replace("Z", "+00:00") if ts.endswith("Z") else ts
    dt = datetime.fromisoformat(normalized)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


@dataclass
class ValidationReport:
    ok: bool
    errors: list[str]
    warnings: list[str]
    stats: dict[str, Any]


class Phase1MockStore:
    """Loads JSON fixtures + splunk_logs-v3.json and provides deterministic emulation helpers."""

    REQUIRED_MESSAGE_FIELDS = {
        "request_id",
        "source_agent",
        "target_agent",
        "communication_mode",
        "untrusted_data_fields",
        "payload",
    }
    VALID_AGENTS = {"intake", "orchestrator", "evidence", "policy", "reporter", "access_broker"}
    VALID_MODES = {"one_way", "two_way", "tot_internal"}

    def __init__(self, base_dir: str | Path = ".", mocks_dir: str | Path = "mocks") -> None:
        self.base_dir = Path(base_dir)
        self.mocks_dir = self.base_dir / mocks_dir
        self.splunk_logs: list[dict[str, Any]] = []
        self.devices: list[dict[str, Any]] = []
        self.employees: list[dict[str, Any]] = []
        self.jira: dict[str, Any] = {}
        self.policies: list[dict[str, Any]] = []
        self.cyberark: dict[str, Any] = {}
        self.tot_store: dict[str, Any] = {}

    def load_all(self, splunk_filename: str = "splunk_logs-v3.json") -> None:
        splunk_path = self._resolve_file(splunk_filename)
        with splunk_path.open("r", encoding="utf-8") as f:
            raw_logs = json.load(f)
        if not isinstance(raw_logs, list):
            raise ValueError(f"{splunk_path} must contain a JSON array of log events.")
        self.splunk_logs = raw_logs

        self.devices = self._load_json("device_inventory.json").get("devices", [])
        self.employees = self._load_json("employee_roster.json").get("employees", [])
        self.jira = self._load_json("jira_cr_and_incidents.json")
        self.policies = self._load_json("policy_vector_db.json").get("policy_chunks", [])
        self.cyberark = self._load_json("cyberark_pam.json")
        self.tot_store = self._load_json("tot_state_store.json")

    def _resolve_file(self, filename: str) -> Path:
        p = Path(filename)
        if p.is_absolute() and p.exists():
            return p
        if (self.base_dir / p).exists():
            return self.base_dir / p
        if (self.mocks_dir / p).exists():
            return self.mocks_dir / p
        raise FileNotFoundError(f"Could not locate fixture file: {filename}")

    def _load_json(self, filename: str) -> dict[str, Any]:
        path = self._resolve_file(filename)
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            raise ValueError(f"Expected JSON object in {path}")
        return data

    def validate_agent_message(self, msg: dict[str, Any]) -> list[str]:
        """Validate hub-and-spoke agent message envelope and enforce communication rules."""
        errors: list[str] = []
        missing = self.REQUIRED_MESSAGE_FIELDS - set(msg.keys())
        if missing:
            errors.append(f"Missing required envelope fields: {sorted(missing)}")
            return errors

        src = msg.get("source_agent")
        dst = msg.get("target_agent")
        mode = msg.get("communication_mode")

        if src not in self.VALID_AGENTS:
            errors.append(f"Invalid source_agent: {src}")
        if dst not in self.VALID_AGENTS:
            errors.append(f"Invalid target_agent: {dst}")
        if mode not in self.VALID_MODES:
            errors.append(f"Invalid communication_mode: {mode}")

        if mode != "tot_internal" and src != "orchestrator" and dst != "orchestrator":
            errors.append(f"Hub-and-spoke violation: {src} -> {dst} bypasses orchestrator")

        attempts = msg.get("clarification_attempts", 0)
        if not isinstance(attempts, int) or attempts < 0 or attempts > 1:
            errors.append(f"clarification_attempts must be an integer in [0, 1], got {attempts}")

        if not isinstance(msg.get("untrusted_data_fields"), list):
            errors.append("untrusted_data_fields must be a list of field names")
        if not isinstance(msg.get("payload"), dict):
            errors.append("payload must be a JSON object")

        return errors

    def validate_all(self) -> ValidationReport:
        errors: list[str] = []
        warnings: list[str] = []

        inv_hosts = {d["hostname"] for d in self.devices}
        log_hosts = {e.get("host") for e in self.splunk_logs if "host" in e}

        for idx, ev in enumerate(self.splunk_logs):
            for field in ("timestamp", "host", "ip", "severity", "message"):
                if field not in ev:
                    errors.append(f"Splunk event #{idx} missing '{field}'")
            if "timestamp" in ev:
                try:
                    parse_iso_timestamp(ev["timestamp"])
                except Exception as exc:
                    errors.append(f"Splunk event #{idx} invalid timestamp '{ev['timestamp']}': {exc}")

        untracked_hosts = sorted(h for h in log_hosts if h not in inv_hosts)
        if untracked_hosts:
            warnings.append(f"Hosts present in Splunk logs but omitted from device_inventory.json: {untracked_hosts}")

        rubric = self.tot_store.get("rubric_config", {})
        weights = rubric.get("weights", {})
        if weights:
            weight_sum = round(sum(weights.values()), 6)
            if abs(weight_sum - 1.0) > 1e-6:
                errors.append(f"ToT rubric weights must sum to 1.0, got {weight_sum}")

        active_policies = [p for p in self.policies if p.get("status") == "Active"]
        if not active_policies:
            errors.append("No 'Active' policy chunks found in policy_vector_db.json")

        sample_msg = {
            "request_id": "req-phase1-check",
            "source_agent": "evidence",
            "target_agent": "orchestrator",
            "communication_mode": "one_way",
            "clarification_attempts": 0,
            "untrusted_data_fields": ["splunk_events"],
            "payload": {"finding": "Inconclusive"},
        }
        errors.extend(self.validate_agent_message(sample_msg))

        stats = {
            "splunk_event_count": len(self.splunk_logs),
            "inventory_device_count": len(self.devices),
            "employee_count": len(self.employees),
            "active_policy_count": len(active_policies),
            "superseded_policy_count": len([p for p in self.policies if p.get("status") != "Active"]),
            "cr_count": len(self.jira.get("change_requests", [])),
            "incident_count": len(self.jira.get("incidents", [])),
        }
        return ValidationReport(ok=len(errors) == 0, errors=errors, warnings=warnings, stats=stats)

    def query_splunk(
        self,
        host: str | None = None,
        window_start: str | None = None,
        window_end: str | None = None,
        window_padding_hours: float = 2.0,
        severity_in: list[str] | None = None,
        keyword_regex: str | None = None,
        max_events: int = 10000,
    ) -> dict[str, Any]:
        """Emulate scoped Splunk MCP queries (default window +/- 2h per Section 2.3)."""
        start_dt = parse_iso_timestamp(window_start) - timedelta(hours=window_padding_hours) if window_start else None
        end_dt = parse_iso_timestamp(window_end) + timedelta(hours=window_padding_hours) if window_end else None
        pattern = re.compile(keyword_regex, re.IGNORECASE) if keyword_regex else None
        sev_set = {s.upper() for s in severity_in} if severity_in else None

        matches: list[dict[str, Any]] = []
        for idx, ev in enumerate(self.splunk_logs):
            if host and ev.get("host") != host:
                continue
            ev_dt = parse_iso_timestamp(ev["timestamp"])
            if start_dt and ev_dt < start_dt:
                continue
            if end_dt and ev_dt > end_dt:
                continue
            if sev_set and ev.get("severity", "").upper() not in sev_set:
                continue
            if pattern and not pattern.search(ev.get("message", "")):
                continue
            matches.append({"event_id": f"splunk_v3#{idx}", **ev})

        too_broad = len(matches) > max_events
        return {
            "matched_count": len(matches),
            "too_broad_gt_10000": too_broad,
            "events": [] if too_broad else matches,
        }


if __name__ == "__main__":
    store = Phase1MockStore(base_dir=".", mocks_dir="mocks")
    store.load_all("splunk_logs-v3.json")
    report = store.validate_all()
    print("Validation OK:", report.ok)
    print("Stats:", json.dumps(report.stats, indent=2))
    print("Errors:", report.errors)
    print("Warnings:", report.warnings)

    vpn_res = store.query_splunk(
        host="vpn-gw-01",
        window_start="2025-11-17T02:00:00Z",
        window_end="2025-11-17T02:30:00Z",
        window_padding_hours=2.0,
    )
    print("\nvpn-gw-01 (+/-2h around 02:00Z) count:", vpn_res["matched_count"])
    for e in vpn_res["events"]:
        print(" ", e["event_id"], e["timestamp"], e["severity"], e["message"])

    web_res = store.query_splunk(
        host="srv-web-01",
        window_start="2025-11-17T06:00:00Z",
        window_end="2025-11-17T06:30:00Z",
        window_padding_hours=0.5,
        severity_in=["ERROR", "CRITICAL"],
    )
    print("\nsrv-web-01 ERROR/CRITICAL (05:30Z-07:00Z) count:", web_res["matched_count"])
    for e in web_res["events"]:
        print(" ", e["event_id"], e["timestamp"], e["severity"], e["message"])
