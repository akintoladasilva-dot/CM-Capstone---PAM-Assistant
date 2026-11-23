Problem and user

A central issue with most privileged access management processes is they do not support dynamic. Access privileges are pre-determined for a small group of people and actual changes must be pre-approved through the structured change management process. By taking in additional context from the logs from the system and further insight from the LLM, my system enables dynamic privilege management that can also be dynamically changed. 

System goal and scope

My PAM AI Assistant evaluates natural-language privileged access requests (e.g., break-fix emergencies and scheduled maintenance) against live operational telemetry, ITSM change records, active governance policies, and CyberArk safe entitlements before issuing time-bound Just-in-Time (JIT) access.
The system enforces a strict separation between probabilistic natural-language reasoning (Gemini 4 Hydrogen) and deterministic authorization (Weighted Tree-of-Thought beam search, Protected Null hypothesis retention, Blind Critic verification, and Access Broker policy enforcement).
Successful performance for my system is the ability to approve access when all requirements are met and also when only some requirements are met but the context of the situation supports providing access.  
The primary constraint of my system is the lack of live telemetry integrations to the system. I did not have access to Splunk, Cyber Ark or JIRA so I emulated data from each system with JSON and built connectors to those JSON data structures. I created a detailed system inventory and employee roster and then used GenAI to create realistic Splunk logs, PAM entitlements and Jira tickets. 

Build Instructions
