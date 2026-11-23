Problem and user

A central issue with most privileged access management processes is they do not support dynamic. Access privileges are pre-determined for a small group of people and actual changes must be pre-approved through the structured change management process. By taking in additional context from the logs from the system and further insight from the LLM, my system enables dynamic privilege management that can also be dynamically changed. 

System goal and scope

My PAM AI Assistant evaluates natural-language privileged access requests (e.g., break-fix emergencies and scheduled maintenance) against live operational telemetry, ITSM change records, active governance policies, and CyberArk safe entitlements before issuing time-bound Just-in-Time (JIT) access.
The system enforces a strict separation between probabilistic natural-language reasoning (Gemini 4 Hydrogen) and deterministic authorization (Weighted Tree-of-Thought beam search, Protected Null hypothesis retention, Blind Critic verification, and Access Broker policy enforcement).
Successful performance for my system is the ability to approve access when all requirements are met and also when only some requirements are met but the context of the situation supports providing access.  
The primary constraint of my system is the lack of live telemetry integrations to the system. I did not have access to Splunk, Cyber Ark or JIRA so I emulated data from each system with JSON and built connectors to those JSON data structures. I created a detailed system inventory and employee roster and then used GenAI to create realistic Splunk logs, PAM entitlements and Jira tickets. 


PAM AI Assistant — Build & Run Instructions (GitHub)
====================================================

1. Prerequisites
----------------
- Node.js >= 22.18 (required for `npm start` to run `node server.ts`
  via native TypeScript execution; for Node 20.x–22.17, use
  `npx tsx server.ts` instead)
- npm (comes with Node.js)
- A Gemini API key (required for natural-language request parsing via
  /api/orchestrate/parse-nl and optional Gemini audit synthesis;
  deterministic orchestration and the 13-case benchmark work without it)


2. Clone & Install Dependencies
-------------------------------
  git clone <your-repo-url>
  cd <repo-folder>
  npm install

Verify that the mock telemetry and policy fixtures exist under
`public/assets/aistudio/` (loaded at startup by Phase1MockStore in
`src/server/mockStore.ts`):
  - splunk_logs-v3_ebcc0f56.json
  - device_inventory_d42259c6.json
  - employee_roster_83ebf790.json
  - jira_cr_and_incidents_995a5a96.json
  - policy_vector_db_41f041bb.json
  - cyberark_pam_c686c946.json
  - tot_state_store_d48df9a1.json
  - Capstone_Network_Inventory-v3_f56ef75a.csv


3. Configure Environment Variables
----------------------------------
Copy `.env.example` to `.env` (`.env*` is gitignored):
  cp .env.example .env

Edit `.env` and set your Gemini API key:
  GEMINI_API_KEY="your_gemini_api_key_here"
  APP_URL="http://localhost:3000"


4. Run in Development Mode
--------------------------
  npm run dev

Starts Express (/api/*) and Vite dev middleware via `tsx server.ts` on
http://localhost:3000. Override port or host with CLI flags if needed:
  npm run dev -- --port 4000 --host 127.0.0.1


5. Type-Check & Build for Production
------------------------------------
Run the TypeScript compiler check (client + server):
  npm run lint

Build the React/Vite production bundle into `dist/`:
  npm run build

Start the production server (serves static files from `dist/` and API
routes from `/api/*`):
  NODE_ENV=production npm start

(Optional custom port: `NODE_ENV=production PORT=8080 npm start`.
On Node < 22.18, run `NODE_ENV=production npx tsx server.ts`.)


6. Verify the Running Server
----------------------------
Check health, fixture stats, and Gemini configuration:
  curl http://localhost:3000/api/health

Run the 13-case Phase 4 verification suite:
  curl -X POST http://localhost:3000/api/benchmark/run
