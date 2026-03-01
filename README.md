# Elders

Turn-based PvP battle game with a data-driven character system, passives, domains, transformations, and online matchmaking.

## Highlights

- **Data-driven roster**
  - Characters: `data/characters.json`
  - Skills: `data/skills.json`
  - Passives: `data/passives.json`
- **Turn-based combat**
  - Cooldowns tick on the owning player's turns
  - Buff/debuff durations, DoTs, domains, stances
- **Ultimates powered by passive “missions”**
  - Missions are evaluated from `passiveState` counters (ex: stacks, healing done)
  - Some passives can keep the ultimate usable after it unlocks (`mission.keepReadyAfterUse`)
- **Online PvP**
  - WebSocket matchmaking + relay server
  - Cloudflare Workers + Durable Objects implementation under `cloudflare-workers/`

## Roster (current)

Selectable characters are defined in `data/characters.json`.

- **Lloyd Frontera** (`lloyd_frontera`)
- **Rimuru Tempest** (`rimuru_tempest`)
- **Trafalgar Law** (`trafalgar_law`)
- **Saitama** (`saitama`)
- **Gojo Satoru** (`gojo_satoru`)
- **Zero Two** (`zero_two`)
- **Edward Elric** (`edward_elric`)
- **Naruto Uzumaki** (`naruto`)
- **Frieren** (`frieren`)

Non-selectable transformations (kits swapped at runtime):

- **Saitama (Serious)** (`saitama_serious`)
- **Naruto (Sage Mode)** (`naruto_sage`)

## Combat model (high-level)

### Turns

- Two players: `player1` and `player2`.
- Each action advances the turn.

### Skills / cooldowns

- Skills are defined in `data/skills.json`.
- Cooldowns are tracked per player and decrement on that player's turn.

### Passives, counters, and ultimate readiness

- Passives are defined in `data/passives.json`.
- Runtime passive state lives in `character.passiveState`:
  - `counters` (ex: `balance`, `sageOrbs`, `heat`, `archivePages`)
  - `totalHealingDone`
  - `ultimateReady`
- Ultimate readiness is evaluated by the passive mission system.

### Transformations

Some ultimates transform the character into a different kit.

- Example: Naruto transforms into `naruto_sage`.
- The transform effect can preserve passive state and keep the selected skill palette (see `transform_self` effect fields).

### Domains

Domains are global effects (only one should exist at a time) and are tracked in `SkillSystem.activeEffects`.

Examples:

- Gojo: `array_domain` (inverts damage/heal)
- Law: `room_domain` (adds enemy cooldown)
- Frieren: `frieren_domain`
- Lloyd: `construction_site_domain`
- Edward: `alchemy_domain`

### Revive

Edward’s passive includes a revive effect (limited). Damage application checks for death after hits so revive can trigger mid multi-hit sequences.

## Multiplayer architecture

### Client

- WebSocket connection: `scripts/multiplayer/websocket-manager.js`
- Matchmaking: `scripts/multiplayer/pairing-manager.js`
- Battle coordination: `scripts/multiplayer/game-coordinator.js`

**WebSocket URL configuration** (no rebuild needed):

- Query parameter:
  - `?ws=wss://your-worker-domain/ws`
- Or in DevTools:
  - `localStorage.setItem('ELDERS_WS_URL', 'wss://your-worker-domain/ws')`

### Server (Cloudflare)

Cloudflare Worker + Durable Object lives under:

```text
cloudflare-workers/
  wrangler.toml
  src/index.js
```

It supports:

- `search_match`
- `cancel_search`
- `player_action` relay as `opponent_action`

## Local development

### 1) Serve the client

From the repo root:

```bash
python -m http.server 8000
```

Open:

```text
http://localhost:8000
```

### 2) Run PvP locally (optional)

You can run the legacy Node WebSocket server for local testing:

```text
server/websocket-server.js
```

Or you can run the Cloudflare Worker locally:

```bash
wrangler dev
```

## Deploy

### Backend (Cloudflare Workers + Durable Objects)

From `cloudflare-workers/`:

```bash
wrangler deploy
```

Your WS endpoint will be:

```text
wss://<your-worker-domain>/ws
```

### Frontend (recommended: Cloudflare Pages)

- Push this repo to GitHub
- Create a Cloudflare Pages project from the repo
- No build step (static hosting)

