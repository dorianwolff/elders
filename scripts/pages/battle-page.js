class BattlePage extends BasePage {
    constructor() {
        super();
        this.gameCoordinator = null;
        this.gameState = null;
        this.characterSystem = new CharacterSystem();
        this.isInitialized = false;
        this.lastAutoSkipTurnCount = null;
        this.idleAnimationIntervalId = null;
        this.idleAnimationFrameIndex = 0;
        this.arenaBackgroundUrl = null;
        this.arenaBackgroundGameId = null;
        this.ultimateOverlayCleanup = null;
        this.ultimateOverlayDonePromise = null;
        this.ultimateOverlayDoneResolve = null;
        this.skipAnimations = false;
        this.floatingCombatText = null;
        this.pendingCombatTextPresentation = null;
        this.pendingActionPresentation = null;
        this.pendingActionPresentationKey = null;
        this.lastHealthPercent = { player: null, opponent: null };
        this.pendingHealthLoss = { player: null, opponent: null };
        this.displayedHealthPercent = { player: null, opponent: null };
        this.pendingHealthAnimation = null;
        this.healOverlayAnimating = { player: false, opponent: false };
        this.presentationQueue = Promise.resolve();
        this._skipToggleBound = false;
        this._eventListenersBound = false;

        this.spriteAnimation = {
            intervalId: null,
            frameIndex: { player: 0, opponent: 0 },
            lastFramesKey: { player: null, opponent: null },
            override: { player: null, opponent: null }
        };
    }

    ensureUltimateOverlayDonePromise() {
        if (this.ultimateOverlayDonePromise) return this.ultimateOverlayDonePromise;
        this.ultimateOverlayDonePromise = new Promise(resolve => {
            this.ultimateOverlayDoneResolve = resolve;
        });
        return this.ultimateOverlayDonePromise;
    }

    resolveUltimateOverlayDone() {
        if (typeof this.ultimateOverlayDoneResolve === 'function') {
            try {
                this.ultimateOverlayDoneResolve();
            } catch (e) {}
        }
        this.ultimateOverlayDonePromise = null;
        this.ultimateOverlayDoneResolve = null;
    }

    getArenaBackgroundUrlForGameId(gameId) {
        if (window.BattleAssets && typeof window.BattleAssets.getArenaBackgroundUrlForGameId === 'function') {
            return window.BattleAssets.getArenaBackgroundUrlForGameId(gameId);
        }
        return null;
    }

    applyArenaBackgroundIfNeeded() {
        const arena = this.querySelector('.battle-arena');
        if (!arena || !this.gameState) return;

        const gameId = this.gameState.gameId;
        if (!this.arenaBackgroundUrl || this.arenaBackgroundGameId !== gameId) {
            this.arenaBackgroundUrl = this.getArenaBackgroundUrlForGameId(gameId);
            this.arenaBackgroundGameId = gameId;
        }

        arena.style.setProperty(
            '--arena-bg-url',
            this.arenaBackgroundUrl ? `url('${this.arenaBackgroundUrl}')` : 'none'
        );

        const shouldMirror = this.gameState.playerId === 'player2';
        arena.classList.toggle('is-bg-mirrored', shouldMirror);
    }

    getUltimateVideoForCharacter(character) {
        if (window.BattleAssets && typeof window.BattleAssets.getUltimateVideoForCharacter === 'function') {
            return window.BattleAssets.getUltimateVideoForCharacter(character);
        }
        return null;
    }

    playUltimateVideoForCharacter(character) {
        const src = this.getUltimateVideoForCharacter(character);
        if (!src) return;
        this.showUltimateVideoOverlay(src);
    }

    showUltimateVideoOverlay(src) {
        if (this.skipAnimations) return;
        if (this.ultimateOverlayCleanup) {
            this.ultimateOverlayCleanup();
            this.ultimateOverlayCleanup = null;
        }

        this.ensureUltimateOverlayDonePromise();

        const overlay = this.querySelector('#ultimate-overlay');
        const video = this.querySelector('#ultimate-overlay-video');
        if (!overlay || !video) return;

        const cleanup = () => {
            overlay.classList.remove('is-visible');
            try {
                video.pause();
            } catch (e) {}
            video.removeAttribute('src');
            try {
                video.load();
            } catch (e) {}
            overlay.removeEventListener('click', onClick);
            video.removeEventListener('ended', onEnded);
            this.resolveUltimateOverlayDone();
        };

        const onEnded = () => {
            cleanup();
            this.ultimateOverlayCleanup = null;
        };

        const onClick = () => {
            cleanup();
            this.ultimateOverlayCleanup = null;
        };

        this.ultimateOverlayCleanup = cleanup;

        overlay.classList.add('is-visible');
        video.src = src;
        overlay.addEventListener('click', onClick);
        video.addEventListener('ended', onEnded);

        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(() => {
                cleanup();
                this.ultimateOverlayCleanup = null;
            });
        }
    }

    getCombatTextDurationMs() {
        return 1200;
    }

    getHealthLossAnimationDurationMs() {
        return 700;
    }

    sleep(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    animateHealthLossOverlay(side) {
        const pending = this.pendingHealthLoss?.[side];
        if (!pending) return Promise.resolve();

        const el = this.querySelector(side === 'player' ? '#player-health-damage-fill' : '#opponent-health-damage-fill');
        if (!el) {
            this.pendingHealthLoss[side] = null;
            return Promise.resolve();
        }

        const from = Math.max(0, Math.min(100, Number(pending.from) || 0));
        const to = Math.max(0, Math.min(100, Number(pending.to) || 0));
        this.pendingHealthLoss[side] = null;

        el.style.transition = 'none';
        el.style.width = `${from}%`;

        // Force style flush then animate to the new value.
        void el.offsetWidth;

        const duration = this.getHealthLossAnimationDurationMs();
        el.style.transition = `width ${duration}ms linear`;

        // Next frame to ensure transition applies.
        return new Promise(resolve => {
            requestAnimationFrame(() => {
                el.style.width = `${to}%`;
                window.setTimeout(() => {
                    resolve();
                }, duration + 260);
            });
        });
    }

    buildHealthAnimationFromCombatText(actionResult, newGameState) {
        if (!actionResult || !newGameState) return null;
        const animations = Array.isArray(actionResult.animations) ? actionResult.animations : [];
        if (!animations.length) return null;

        const mapSideToPlayerId = (side) => (side === 'player' ? newGameState.playerId : (newGameState.playerId === 'player1' ? 'player2' : 'player1'));
        const playerIdForSide = {
            player: mapSideToPlayerId('player'),
            opponent: mapSideToPlayerId('opponent')
        };

        const maxHealthForSide = {
            player: Math.max(1, Number(newGameState.player.character.stats.maxHealth) || 1),
            opponent: Math.max(1, Number(newGameState.opponent.character.stats.maxHealth) || 1)
        };

        const finalPercentForSide = {
            player: Math.max(0, Math.min(100, ((Number(newGameState.player.character.stats.health) || 0) / maxHealthForSide.player) * 100)),
            opponent: Math.max(0, Math.min(100, ((Number(newGameState.opponent.character.stats.health) || 0) / maxHealthForSide.opponent) * 100))
        };

        const startPercentForSide = {
            player: this.displayedHealthPercent.player !== null ? this.displayedHealthPercent.player : finalPercentForSide.player,
            opponent: this.displayedHealthPercent.opponent !== null ? this.displayedHealthPercent.opponent : finalPercentForSide.opponent
        };

        const hits = { player: [], opponent: [] };
        for (const anim of animations) {
            if (!anim || anim.type !== 'combat_text') continue;
            if (anim.kind !== 'damage' && anim.kind !== 'heal') continue;
            const targetPlayerId = anim.targetPlayerId;
            const delayMs = Math.max(0, Math.floor(Number(anim.delayMs) || 0));

            if (targetPlayerId === playerIdForSide.player) {
                hits.player.push({ kind: anim.kind, amount: Number(anim.amount) || 0, delayMs });
            } else if (targetPlayerId === playerIdForSide.opponent) {
                hits.opponent.push({ kind: anim.kind, amount: Number(anim.amount) || 0, delayMs });
            }
        }

        const buildSide = (side) => {
            const list = hits[side].slice().sort((a, b) => a.delayMs - b.delayMs);
            if (!list.length) return null;

            let cur = startPercentForSide[side];
            const maxHealth = maxHealthForSide[side];
            const steps = [];
            for (let i = 0; i < list.length; i++) {
                const amount = Math.max(0, Number(list[i].amount) || 0);
                if (list[i].kind === 'heal') {
                    // Use authoritative final HP% for healing steps to avoid intermediate "partial" moves.
                    // This prevents double-step corrections in cases like mirror actions (one heals while the other takes damage)
                    // where combat_text amounts may not perfectly match the resulting HP delta.
                    cur = Math.max(cur, finalPercentForSide[side]);
                    steps.push({ delayMs: list[i].delayMs, percent: cur, kind: 'heal' });
                } else {
                    const pctLoss = (amount / maxHealth) * 100;
                    cur = Math.max(finalPercentForSide[side], cur - pctLoss);
                    steps.push({ delayMs: list[i].delayMs, percent: cur, kind: 'damage' });
                }
            }
            steps[steps.length - 1].percent = finalPercentForSide[side];
            return {
                startPercent: startPercentForSide[side],
                finalPercent: finalPercentForSide[side],
                steps
            };
        };

        const player = buildSide('player');
        const opponent = buildSide('opponent');
        if (!player && !opponent) return null;

        return { player, opponent };
    }

    setGreenHealthPercent(side, percent, animate = true) {
        const el = this.querySelector(side === 'player' ? '#player-health-fill' : '#opponent-health-fill');
        if (!el) return;
        const p = Math.max(0, Math.min(100, Number(percent) || 0));
        el.style.transition = animate ? 'width 120ms linear' : 'none';
        el.style.width = `${p}%`;
        this.displayedHealthPercent[side] = p;
    }

    setShadowHealthPercent(side, percent, animate = true, delayMs = 0) {
        const el = this.querySelector(side === 'player' ? '#player-health-damage-fill' : '#opponent-health-damage-fill');
        if (!el) return;
        const p = Math.max(0, Math.min(100, Number(percent) || 0));
        const delay = Math.max(0, Math.floor(Number(delayMs) || 0));
        el.style.transition = animate ? `width 520ms linear ${delay}ms` : 'none';
        el.style.width = `${p}%`;
    }

    setHealHealthPercent(side, percent, animate = true, delayMs = 0) {
        const el = this.querySelector(side === 'player' ? '#player-health-heal-fill' : '#opponent-health-heal-fill');
        if (!el) return;
        const p = Math.max(0, Math.min(100, Number(percent) || 0));
        const delay = Math.max(0, Math.floor(Number(delayMs) || 0));
        // Backwards-compatible: treat as "fill from 0". Prefer setHealOverlayRange() for gain previews.
        el.style.transition = animate ? `width 520ms linear ${delay}ms, opacity 260ms linear ${delay}ms` : 'none';
        el.style.opacity = '1';
        el.style.left = '0%';
        el.style.width = `${p}%`;
    }

    setHealOverlayRange(side, fromPercent, toPercent, animate = true, delayMs = 0) {
        const el = this.querySelector(side === 'player' ? '#player-health-heal-fill' : '#opponent-health-heal-fill');
        if (!el) return;

        const from = Math.max(0, Math.min(100, Number(fromPercent) || 0));
        const to = Math.max(0, Math.min(100, Number(toPercent) || 0));
        const start = Math.min(from, to);
        const end = Math.max(from, to);
        const width = Math.max(0, end - start);
        const delay = Math.max(0, Math.floor(Number(delayMs) || 0));

        el.style.transition = animate
            ? `left 0ms linear ${delay}ms, width 520ms linear ${delay}ms, opacity 260ms linear ${delay}ms`
            : 'none';
        el.style.opacity = '1';
        el.style.left = `${start}%`;
        el.style.width = `${width}%`;
    }

    hideHealOverlay(side, animate = true, delayMs = 0) {
        const el = this.querySelector(side === 'player' ? '#player-health-heal-fill' : '#opponent-health-heal-fill');
        if (!el) return;
        const delay = Math.max(0, Math.floor(Number(delayMs) || 0));
        el.style.transition = animate ? `opacity 260ms linear ${delay}ms` : 'none';
        el.style.opacity = '0';
    }

    showHealOverlay(side, animate = true, delayMs = 0) {
        const el = this.querySelector(side === 'player' ? '#player-health-heal-fill' : '#opponent-health-heal-fill');
        if (!el) return;
        const delay = Math.max(0, Math.floor(Number(delayMs) || 0));
        el.style.transition = animate ? `opacity 120ms linear ${delay}ms` : 'none';
        el.style.opacity = '1';
    }

    async playHealingGainAnimation(side, toPercent) {
        // Dark green overlay jumps to the target first, then the main bar follows.
        const target = Math.max(0, Math.min(100, Number(toPercent) || 0));
        const from = this.displayedHealthPercent?.[side];
        const start = (typeof from === 'number') ? from : target;

        this.healOverlayAnimating[side] = true;
        try {
            // Keep the red damage shadow pinned to the current HP during healing so it doesn't look like damage is "growing".
            this.setShadowHealthPercent(side, start, false);

            // Immediately show overlay at the final (healed) HP.
            this.setHealHealthPercent(side, target, false);
            this.showHealOverlay(side, false);

            // Next frame: animate the main bar from current -> target.
            await new Promise(resolve => requestAnimationFrame(resolve));

            const greenEl = this.querySelector(side === 'player' ? '#player-health-fill' : '#opponent-health-fill');
            if (greenEl) {
                greenEl.style.transition = 'width 520ms linear';
                greenEl.style.width = `${target}%`;
            }
            this.displayedHealthPercent[side] = target;

            // Once the green bar has caught up, snap the red shadow to the final value.
            await this.sleep(540);
            this.setShadowHealthPercent(side, target, false);

            this.hideHealOverlay(side, true, 0);
            await this.sleep(280);
        } finally {
            this.healOverlayAnimating[side] = false;
        }
    }

    async playHealthAnimation(healthAnim) {
        if (!healthAnim) return;

        const playSide = async (side) => {
            const data = healthAnim[side];
            if (!data) return;

            this.setGreenHealthPercent(side, data.startPercent, false);
            this.setShadowHealthPercent(side, data.startPercent, false);
            this.setHealHealthPercent(side, data.startPercent, false);
            this.hideHealOverlay(side, false);

            let prevDelay = 0;
            let sawDamage = false;
            for (const step of data.steps) {
                const delta = Math.max(0, step.delayMs - prevDelay);
                if (delta > 0) {
                    await this.sleep(delta);
                }
                if (step.kind === 'heal') {
                    await this.playHealingGainAnimation(side, step.percent);
                } else {
                    sawDamage = true;
                    this.hideHealOverlay(side, false);
                    this.setGreenHealthPercent(side, step.percent, true);
                }
                prevDelay = step.delayMs;
            }

            await this.sleep(140);
            if (sawDamage) {
                this.setShadowHealthPercent(side, data.finalPercent, true, 0);
                await this.sleep(560);
            } else {
                this.setShadowHealthPercent(side, data.finalPercent, false, 0);
            }
        };

        await Promise.all([
            playSide('player'),
            playSide('opponent')
        ]);
    }

    getActionPresentationDelayMs(actionResult) {
        if (!actionResult) return 0;
        if (actionResult.actionType !== 'ultimate') return 0;
        if (this.skipAnimations) return 0;
        return null;
    }

    scheduleCombatTextAnimations(actionResult, healthAnimOverride = null) {
        if (!actionResult) return Promise.resolve();
        const animations = Array.isArray(actionResult.animations) ? actionResult.animations : [];
        if (!animations.length) return Promise.resolve();

        // Capture the health animation at scheduling time so newer updates don't overwrite it.
        const capturedHealthAnim = healthAnimOverride || this.pendingHealthAnimation;
        if (healthAnimOverride || this.pendingHealthAnimation) {
            this.pendingHealthAnimation = null;
        }

        const needsUltimateWait = this.getActionPresentationDelayMs(actionResult) === null;
        const waitPromise = needsUltimateWait ? (this.ultimateOverlayDonePromise || Promise.resolve()) : Promise.resolve();

        let maxDelayMs = 0;
        for (const anim of animations) {
            if (!anim || anim.type !== 'combat_text') continue;
            const delay = Math.max(0, Math.floor(Number(anim.delayMs) || 0));
            if (delay > maxDelayMs) maxDelayMs = delay;
        }
        const totalCombatTextMs = maxDelayMs + this.getCombatTextDurationMs();

        const run = () => waitPromise.then(async () => {
            this.renderCombatTextAnimations(actionResult);

            await Promise.all([
                this.playHealthAnimation(capturedHealthAnim),
                this.sleep(totalCombatTextMs)
            ]);

            // Some actions can change HP without producing combat_text steps (e.g., swap health).
            // Keep UI in sync once the presentation finishes.
            try {
                const pHealth = Number(this.gameState?.player?.character?.stats?.health) || 0;
                const pMax = Number(this.gameState?.player?.character?.stats?.maxHealth) || 1;
                const oHealth = Number(this.gameState?.opponent?.character?.stats?.health) || 0;
                const oMax = Number(this.gameState?.opponent?.character?.stats?.maxHealth) || 1;

                const pPct = Math.max(0, Math.min(100, (pHealth / Math.max(1, pMax)) * 100));
                const oPct = Math.max(0, Math.min(100, (oHealth / Math.max(1, oMax)) * 100));

                this.setGreenHealthPercent('player', pPct, false);
                this.setShadowHealthPercent('player', pPct, false);
                this.setGreenHealthPercent('opponent', oPct, false);
                this.setShadowHealthPercent('opponent', oPct, false);

                this.lastHealthPercent.player = pPct;
                this.lastHealthPercent.opponent = oPct;
            } catch (e) {
                this.updateHealthBars();
            }
        });

        // Serialize presentations so long animations aren't cut off by newer updates.
        const queued = this.presentationQueue.then(run, run);
        this.presentationQueue = queued.catch(() => {});

        this.pendingCombatTextPresentation = queued.finally(() => {
            if (this.pendingCombatTextPresentation === queued) {
                this.pendingCombatTextPresentation = null;
            }
        });

        return queued;
    }

    getEstimatedCombatTextPresentationMs(actionResult) {
        if (!actionResult) return 0;
        const animations = Array.isArray(actionResult.animations) ? actionResult.animations : [];
        let maxDelay = 0;
        for (const a of animations) {
            if (!a || a.type !== 'combat_text') continue;
            const d = Math.max(0, Math.floor(Number(a.delayMs) || 0));
            if (d > maxDelay) maxDelay = d;
        }
        const base = (typeof this.getCombatTextDurationMs === 'function')
            ? Math.max(0, Math.floor(this.getCombatTextDurationMs() || 0))
            : 0;
        // Add a small buffer for layout/paint.
        return maxDelay + base + 120;
    }

    async waitForGameEndPresentation(actionResult) {
        if (!actionResult) return;
        if (actionResult.actionType === 'ultimate' && !this.skipAnimations) {
            await (this.ultimateOverlayDonePromise || Promise.resolve());
        }

        const estimateMs = Math.max(700, this.getEstimatedCombatTextPresentationMs(actionResult));
        const timeoutMs = estimateMs + 800;
        const timeout = new Promise(resolve => setTimeout(resolve, timeoutMs));

        const present = (async () => {
            if (this.pendingActionPresentation) {
                await this.pendingActionPresentation;
                return;
            }
            if (this.pendingCombatTextPresentation) {
                await this.pendingCombatTextPresentation;
                return;
            }

            // Fallback: if action presentation tracking wasn't set, schedule it now.
            await this.scheduleCombatTextAnimations(actionResult);

            // Extra safety: ensure at least one short beat passes so the final state is visible.
            await this.sleep(Math.min(650, estimateMs));
        })();

        await Promise.race([present, timeout]);

        // Ensure the last combat text/HP state has at least one paint before navigation.
        try {
            await new Promise(resolve => requestAnimationFrame(() => resolve()));
        } catch (e) {}

    }

    getIdleFramesForCharacter(character) {
        if (window.BattleAssets && typeof window.BattleAssets.getIdleFramesForCharacter === 'function') {
            return window.BattleAssets.getIdleFramesForCharacter(character);
        }
        return [];
    }

    getStanceFramesForCharacter(character, stanceEffect) {
        if (window.BattleAssets && typeof window.BattleAssets.getStanceFramesForCharacter === 'function') {
            return window.BattleAssets.getStanceFramesForCharacter(character, stanceEffect);
        }
        return null;
    }

    getSkillSystem() {
        return this.gameCoordinator && this.gameCoordinator.gameState
            ? this.gameCoordinator.gameState.skillSystem
            : null;
    }

    getActiveStanceEffectForPlayerId(playerId) {
        const skillSystem = this.getSkillSystem();
        const effects = skillSystem ? skillSystem.activeEffects : null;
        if (!effects) return null;

        const consider = (eff) => {
            if (!eff) return null;
            const effType = typeof eff.type === 'string' ? eff.type : '';
            if (effType !== 'stance' && effType !== 'grit_stance') return null;
            if (eff.target !== playerId) return null;
            if (effType === 'stance' && (Number(eff.turnsLeft) || 0) <= 0) return null;
            return eff;
        };

        if (effects && typeof effects.entries === 'function') {
            for (const [, eff] of effects.entries()) {
                const found = consider(eff);
                if (found) return found;
            }
        } else if (Array.isArray(effects)) {
            for (const eff of effects) {
                const found = consider(eff);
                if (found) return found;
            }
        } else if (effects && typeof effects === 'object') {
            for (const eff of Object.values(effects)) {
                const found = consider(eff);
                if (found) return found;
            }
        }

        return null;
    }

    getSpriteFramesForSide(side) {
        if (!this.gameState) return null;

        if (this.spriteAnimation.override[side] && Array.isArray(this.spriteAnimation.override[side].frames)) {
            return this.spriteAnimation.override[side].frames;
        }

        const playerId = side === 'player'
            ? this.gameState.playerId
            : (this.gameState.playerId === 'player1' ? 'player2' : 'player1');

        const character = side === 'player' ? this.gameState.player.character : this.gameState.opponent.character;
        const stanceEffect = this.getActiveStanceEffectForPlayerId(playerId);
        if (stanceEffect) {
            const stanceFrames = this.getStanceFramesForCharacter(character, stanceEffect);
            if (stanceFrames && stanceFrames.length > 0) return stanceFrames;
        }

        return this.getIdleFramesForCharacter(character);
    }

    getSpriteFramesKey(side, frames) {
        const playerId = side === 'player'
            ? this.gameState?.playerId
            : (this.gameState?.playerId === 'player1' ? 'player2' : 'player1');
        const stance = playerId ? this.getActiveStanceEffectForPlayerId(playerId) : null;
        const stanceKey = stance && (stance.stanceKey || stance.key) ? String(stance.stanceKey || stance.key) : '';
        const overrideKey = this.spriteAnimation.override[side] ? String(this.spriteAnimation.override[side].key || 'override') : '';
        const len = Array.isArray(frames) ? frames.length : 0;
        const first = Array.isArray(frames) && frames.length ? String(frames[0]) : '';
        return `${overrideKey}|${playerId || ''}|${stanceKey}|${len}|${first}`;
    }

    playSpriteOverride(side, frames, durationMs, key = 'action') {
        if (!Array.isArray(frames) || frames.length === 0) return;
        const ms = Math.max(0, Math.floor(Number(durationMs) || 0));

        if (this.spriteAnimation.override[side] && this.spriteAnimation.override[side].timeoutId) {
            try {
                clearTimeout(this.spriteAnimation.override[side].timeoutId);
            } catch (e) {}
        }

        const entry = { frames, key, timeoutId: null };
        if (ms > 0) {
            entry.timeoutId = setTimeout(() => {
                if (this.spriteAnimation.override[side] === entry) {
                    this.spriteAnimation.override[side] = null;
                }
            }, ms);
        }
        this.spriteAnimation.override[side] = entry;
    }

    getSpriteElementForSide(side) {
        return this.querySelector(side === 'player' ? '#player-sprite' : '#opponent-sprite');
    }

    getSpriteWrapperForSide(side) {
        const sprite = this.getSpriteElementForSide(side);
        return sprite ? sprite.closest('.battle-sprite') : null;
    }

    getSpriteOverlayElementForSide(side) {
        const id = side === 'player' ? 'player-sprite-overlay' : 'opponent-sprite-overlay';
        const selector = `#${id}`;
        const existing = this.querySelector(selector);
        if (existing) return existing;

        // Backward compatibility: if the battle page was mounted before we added overlay markup,
        // create the overlay element on demand.
        const wrapper = this.getSpriteWrapperForSide(side);
        if (!wrapper) return null;

        const overlay = document.createElement('img');
        overlay.id = id;
        overlay.className = 'battle-sprite-overlay';
        overlay.alt = side === 'player' ? 'Player Overlay' : 'Opponent Overlay';
        overlay.style.display = 'none';
        overlay.src = '';
        wrapper.appendChild(overlay);
        return overlay;
    }

    getHTML() {
        return `
            <div class="battle-page">
                <div class="ultimate-overlay" id="ultimate-overlay">
                    <video class="ultimate-overlay-video" id="ultimate-overlay-video" playsinline></video>
                </div>
                <div class="battle-header">
                    <div class="turn-indicator" id="turn-indicator">
                        <span id="turn-text">Waiting...</span>
                    </div>
                    <div class="game-info">
                        <span class="turn-counter">Turn: <span id="turn-counter">0</span></span>
                        <button class="skip-animations-button" id="skip-animations-button" type="button" aria-pressed="false">Skip</button>
                        <button class="surrender-button" id="surrender-button" type="button" aria-label="Surrender">
                            <svg class="surrender-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                                <path d="M6 3v18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                <path d="M6 4h10l-2 3 2 3H6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
                            </svg>
                        </button>
                    </div>
                </div>

                <div class="battle-arena">
                    <div class="battle-top-row">
                        <div class="domain-dock domain-dock-left" id="domain-dock-left" style="display: none;">
                            <div class="domain-dock-inner">
                                <div class="domain-dock-title" id="domain-dock-left-title"></div>
                                <div class="domain-dock-desc" id="domain-dock-left-desc"></div>
                                <div class="domain-dock-turns" id="domain-dock-left-turns"></div>
                            </div>
                        </div>
                        <div class="opponent-section">
                            <div class="character-side-wrap opponent-side-wrap">
                                <div class="opponent-character">
                                    <div class="character-image">
                                        <img id="opponent-image" src="" alt="Opponent">
                                    </div>
                                    <div class="character-info">
                                        <div class="character-header">
                                            <h3 id="opponent-name">Opponent</h3>
                                            <div class="effect-indicators" id="opponent-effects"></div>
                                        </div>
                                        <div class="health-bar-container">
                                            <div class="health-bar">
                                                <div class="health-heal-fill" id="opponent-health-heal-fill"></div>
                                                <div class="health-damage-fill" id="opponent-health-damage-fill"></div>
                                                <div class="health-fill" id="opponent-health-fill"></div>
                                                <div class="health-text">
                                                    <span id="opponent-health-current">100</span> /
                                                    <span id="opponent-health-max">100</span>
                                                </div>
                                            </div>
                                            <div class="shield-bar" id="opponent-shield-bar" style="display: none;">
                                                <div class="shield-fill" id="opponent-shield-fill"></div>
                                                <div class="shield-text">
                                                    <span id="opponent-shield-current">0</span> /
                                                    <span id="opponent-shield-max">0</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="opponent-stats" id="opponent-stats"></div>
                                    </div>
                                </div>
                                <img class="relic-icon" id="opponent-relic" src="" alt="Relic" style="display: none;" />
                            </div>
                        </div>

                        <div class="player-section">
                            <div class="character-side-wrap player-side-wrap">
                                <div class="player-character">
                                    <div class="character-image">
                                        <img id="player-image" src="" alt="Your Character">
                                    </div>
                                    <div class="character-info">
                                        <div class="character-header">
                                            <div class="effect-indicators" id="player-effects"></div>
                                            <h3 id="player-name">Your Character</h3>
                                        </div>
                                        <div class="health-bar-container">
                                            <div class="health-bar">
                                                <div class="health-heal-fill" id="player-health-heal-fill"></div>
                                                <div class="health-damage-fill" id="player-health-damage-fill"></div>
                                                <div class="health-fill" id="player-health-fill"></div>
                                                <div class="health-text">
                                                    <span id="player-health-current">100</span> /
                                                    <span id="player-health-max">100</span>
                                                </div>
                                            </div>
                                            <div class="shield-bar" id="player-shield-bar" style="display: none;">
                                                <div class="shield-fill" id="player-shield-fill"></div>
                                                <div class="shield-text">
                                                    <span id="player-shield-current">0</span> /
                                                    <span id="player-shield-max">0</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="player-stats" id="player-stats"></div>
                                    </div>
                                </div>
                                <img class="relic-icon" id="player-relic" src="" alt="Relic" style="display: none;" />
                            </div>
                        </div>

                        <div class="domain-dock domain-dock-right" id="domain-dock-right" style="display: none;">
                            <div class="domain-dock-inner">
                                <div class="domain-dock-title" id="domain-dock-right-title"></div>
                                <div class="domain-dock-desc" id="domain-dock-right-desc"></div>
                                <div class="domain-dock-turns" id="domain-dock-right-turns"></div>
                            </div>
                        </div>
                    </div>

                    <div class="battle-sprite-stage" id="battle-sprite-stage">
                        <div class="battle-sprite battle-sprite-opponent">
                            <img id="opponent-sprite" src="" alt="Opponent Sprite">
                        </div>
                        <div class="battle-sprite battle-sprite-player">
                            <img id="player-sprite" src="" alt="Player Sprite">
                        </div>
                    </div>
                </div>

                <div class="battle-actions">
                    <div class="skills-section">
                        <h4>Skills</h4>
                        <div class="skills-grid">
                            <button class="skill-button" id="skill-0" data-skill-index="0">
                                <div class="skill-cd-pill" id="skill-0-cd-tag" style="display: none;"></div>
                                <div class="skill-stack-pill" id="skill-0-stack-tag" style="display: none;"></div>
                                <div class="skill-name" id="skill-0-name">Skill 1</div>
                                <div class="skill-description" id="skill-0-description">Description</div>
                                <div class="skill-cooldown" id="skill-0-cooldown" style="display: none;"></div>
                            </button>
                            <button class="skill-button" id="skill-1" data-skill-index="1">
                                <div class="skill-cd-pill" id="skill-1-cd-tag" style="display: none;"></div>
                                <div class="skill-stack-pill" id="skill-1-stack-tag" style="display: none;"></div>
                                <div class="skill-name" id="skill-1-name">Skill 2</div>
                                <div class="skill-description" id="skill-1-description">Description</div>
                                <div class="skill-cooldown" id="skill-1-cooldown" style="display: none;"></div>
                            </button>
                            <button class="skill-button" id="skill-2" data-skill-index="2" style="display: none;">
                                <div class="skill-cd-pill" id="skill-2-cd-tag" style="display: none;"></div>
                                <div class="skill-stack-pill" id="skill-2-stack-tag" style="display: none;"></div>
                                <div class="skill-name" id="skill-2-name">Skill 3</div>
                                <div class="skill-description" id="skill-2-description">Description</div>
                                <div class="skill-cooldown" id="skill-2-cooldown" style="display: none;"></div>
                            </button>
                            <button class="skill-button" id="skill-3" data-skill-index="3" style="display: none;">
                                <div class="skill-cd-pill" id="skill-3-cd-tag" style="display: none;"></div>
                                <div class="skill-stack-pill" id="skill-3-stack-tag" style="display: none;"></div>
                                <div class="skill-name" id="skill-3-name">Skill 4</div>
                                <div class="skill-description" id="skill-3-description">Description</div>
                                <div class="skill-cooldown" id="skill-3-cooldown" style="display: none;"></div>
                            </button>
                        </div>
                    </div>

                    <div class="ultimate-section">
                        <h4>Ultimate</h4>
                        <button class="ultimate-button" id="ultimate-button" disabled>
                            <div class="skill-cd-pill" id="ultimate-cd-tag" style="display: none;"></div>
                            <div class="skill-stack-pill" id="ultimate-stack-tag" style="display: none;"></div>
                            <div class="ultimate-name" id="ultimate-name">Ultimate</div>
                            <div class="ultimate-description" id="ultimate-description">Description</div>
                            <div class="skill-cooldown" id="ultimate-cooldown" style="display: none;"></div>
                            <div class="ultimate-status" id="ultimate-status">Not Ready</div>
                        </button>
                    </div>

                    <div class="passive-section">
                        <h4>Passive</h4>
                        <div class="passive-info">
                            <div class="passive-name" id="passive-name">Passive</div>
                            <div class="passive-description" id="passive-description">Description</div>
                            <div class="passive-progress" id="passive-progress"></div>
                        </div>
                    </div>
                </div>

                <div class="battle-log" id="battle-log">
                    <div class="log-header">Battle Log</div>
                    <div class="log-content" id="log-content"></div>
                </div>
            </div>
        `;
    }

    async setupEventListeners() {
        if (this._eventListenersBound) return;
        this._eventListenersBound = true;

        this.addEventListener('#skill-0', 'click', () => this.useSkill(0));
        this.addEventListener('#skill-1', 'click', () => this.useSkill(1));
        this.addEventListener('#skill-2', 'click', () => this.useSkill(2));
        this.addEventListener('#skill-3', 'click', () => this.useSkill(3));
        this.addEventListener('#ultimate-button', 'click', this.useUltimate.bind(this));
        this.addEventListener('#skip-animations-button', 'click', () => this.toggleSkipAnimations());
        this.addEventListener('#surrender-button', 'click', () => this.surrender());

        if (this.container && !this._skipToggleBound) {
            this._skipToggleBound = true;
            this.container.addEventListener('click', (e) => {
                const t = e && e.target;
                if (!t || !t.closest) return;
                const btn = t.closest('#skip-animations-button');
                if (!btn) return;
                e.preventDefault();
                e.stopPropagation();
                this.toggleSkipAnimations();
            }, true);
        }
        
        // Add tooltip event listeners for character images
        this.addEventListener('#player-image', 'click', (e) => this.showPlayerTooltip(e));
        this.addEventListener('#opponent-image', 'click', (e) => this.showOpponentTooltip(e));
    }

    async surrender() {
        if (!this.gameCoordinator || !this.gameState) return;
        if (!this.gameCoordinator.isGameActive) return;
        if (this.gameState.gamePhase !== 'active') return;

        try {
            this.disableAllActions();
            this.addLogMessage('You surrendered.');
            const result = await this.gameCoordinator.surrender();
            this.updateUI();
        } catch (error) {
            console.error('Failed to surrender:', error);
            this.addLogMessage(`Failed to surrender: ${error.message}`);
            this.enableActionsIfYourTurn();
        }
    }

    toggleSkipAnimations() {
        this.setSkipAnimations(!this.skipAnimations);
    }

    setSkipAnimations(enabled) {
        this.skipAnimations = Boolean(enabled);
        const btn = this.querySelector('#skip-animations-button');
        if (btn) {
            btn.setAttribute('aria-pressed', this.skipAnimations ? 'true' : 'false');
            btn.classList.toggle('is-active', this.skipAnimations);
        }

        if (this.skipAnimations && this.ultimateOverlayCleanup) {
            this.ultimateOverlayCleanup();
            this.ultimateOverlayCleanup = null;
            this.resolveUltimateOverlayDone();
        }
    }

    async onPageLoad() {
        // Wait for game coordinator to be available
        while (!window.app || !window.app.gameCoordinator) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        this.gameCoordinator = window.app.gameCoordinator;
    }

    async initializeGame(gameState) {
        this.gameState = gameState;
        this.isInitialized = true;
        
        // Prevent acting during the short window where multiplayer UI/state can still be settling.
        this.disableAllActions();
        
        // Initialize stat display system only if skillSystem exists
        if (gameState && gameState.skillSystem) {
            this.statDisplay = new StatDisplay(gameState.skillSystem);
            this.characterTooltip = new CharacterTooltip(gameState.skillSystem);
        }
        
        // Default: skip ultimate animations unless the user explicitly toggles otherwise.
        this.setSkipAnimations(true);
        
        this.updateUI();
        this.startIdleSpriteAnimation();
        this.addLogMessage('Battle started!');

        const spriteStage = this.querySelector('#battle-sprite-stage');
        if (spriteStage && typeof FloatingCombatText === 'function') {
            this.floatingCombatText = new FloatingCombatText(spriteStage);
        }
        
        console.log('Battle page initialized with game state:', gameState);

        // Re-enable actions only after initial UI is painted.
        await new Promise(resolve => requestAnimationFrame(resolve));
        this.enableActionsIfYourTurn();
    }

    renderCombatTextAnimations(actionResult) {
        if (!this.floatingCombatText || !actionResult) return;
        const animations = Array.isArray(actionResult.animations) ? actionResult.animations : [];
        if (!animations.length) return;

        for (const anim of animations) {
            if (!anim || anim.type !== 'combat_text') continue;
            const delay = Math.max(0, Math.floor(Number(anim.delayMs) || 0));
            window.setTimeout(() => {
                const targetPlayerId = anim.targetPlayerId;
                const targetSide = anim.targetSide || (
                    targetPlayerId && this.gameState
                        ? (targetPlayerId === this.gameState.playerId ? 'player' : 'opponent')
                        : null
                );
                if (!targetSide) return;
                this.floatingCombatText.spawn({
                    targetSide,
                    kind: anim.kind,
                    amount: anim.amount
                });
            }, delay);
        }
    }

    updateUI() {
        if (!this.gameState) return;

        this.applyArenaBackgroundIfNeeded();
        this.setSkipAnimations(this.skipAnimations);
        this.updateTurnIndicator();
        this.updateDomainIndicator();
        this.updateCharacterInfo();
        this.updateHealthBars();
        this.updateSkills();
        this.updateUltimate();
        this.updatePassive();
        this.updateEffectIndicators();
        this.updateStatDisplays();

        // Auto-skip when stunned (forced skip).
        this.autoSkipIfStunned();

        // Auto-skip ONLY when it is your turn and you have no actions available.
        // Guarded to run at most once per turnCount to prevent loops.
        this.autoSkipIfNoActions();
    }

    isMobileViewport() {
        try {
            if (!window || !window.matchMedia) return false;
            return window.matchMedia('(max-width: 768px)').matches;
        } catch (e) {
            return false;
        }
    }

    updateCharacterInfo() {
        if (!this.gameState) return;

        const playerNameEl = this.querySelector('#player-name');
        if (playerNameEl && this.gameState.player && this.gameState.player.character) {
            playerNameEl.textContent = this.gameState.player.character.name || 'Your Character';
        }

        const opponentNameEl = this.querySelector('#opponent-name');
        if (opponentNameEl && this.gameState.opponent && this.gameState.opponent.character) {
            opponentNameEl.textContent = this.gameState.opponent.character.name || 'Opponent';
        }

        this.updateRelics();
        this.setupSprites();
    }

    async updateRelics() {
        if (!this.gameState || !this.characterSystem) return;

        const updateSide = async (side) => {
            const character = side === 'player'
                ? this.gameState.player?.character
                : this.gameState.opponent?.character;

            const img = this.querySelector(side === 'player' ? '#player-relic' : '#opponent-relic');
            if (!img) return;

            const itemId = character && typeof character.itemId === 'string' ? character.itemId : null;
            if (!itemId) {
                img.src = '';
                img.style.display = 'none';
                return;
            }

            const item = await this.characterSystem.getItem(itemId);
            if (!item) {
                img.src = '';
                img.style.display = 'none';
                return;
            }

            const passive = item.passiveId ? await this.characterSystem.getItemPassive(item.passiveId) : null;
            img.src = item.image || '';
            img.style.display = '';
            img.onerror = () => {
                img.onerror = null;
                img.src = '';
            };
            let descText = passive && passive.description ? passive.description : '';
            if (itemId === 'chen_sword') {
                let stacks = 0;
                try {
                    const pid = side === 'player'
                        ? this.gameCoordinator?.currentPlayerRole
                        : (this.gameCoordinator?.currentPlayerRole === 'player1' ? 'player2' : 'player1');
                    const effects = this.gameState?.skillSystem?.activeEffects;
                    if (pid && effects && typeof effects.entries === 'function') {
                        for (const [, eff] of effects.entries()) {
                            if (!eff) continue;
                            if (eff.type !== 'buff') continue;
                            if (eff.target !== pid) continue;
                            if (eff._itemPassiveId !== 'chen_sword_cd_mastery') continue;
                            if (eff.stat !== 'attack') continue;
                            if ((Number(eff.turnsLeft) || 0) <= 0) continue;
                            stacks = Math.max(stacks, Math.max(0, Math.floor(Number(eff._stackCount ?? eff.value) || 0)));
                        }
                    }
                } catch (e) {
                    stacks = 0;
                }
                descText = `When Ch'en reduces the cooldown of one of her skills, she gains a +1 attack buff. ${stacks}`;
            }
        };

        try {
            await Promise.all([updateSide('player'), updateSide('opponent')]);
        } catch (e) {
            // UI-only: ignore
        }
    }

    updateDomainIndicator() {
        try {
            if (this.isMobileViewport && this.isMobileViewport()) {
                const leftDock = this.querySelector('#domain-dock-left');
                const rightDock = this.querySelector('#domain-dock-right');
                if (leftDock) leftDock.style.display = 'none';
                if (rightDock) rightDock.style.display = 'none';
                return;
            }
        } catch (e) {}

        const leftDock = this.querySelector('#domain-dock-left');
        const rightDock = this.querySelector('#domain-dock-right');
        if ((!leftDock && !rightDock) || !this.gameState || !this.gameState.skillSystem) return;

        const leftTitleEl = this.querySelector('#domain-dock-left-title');
        const leftDescEl = this.querySelector('#domain-dock-left-desc');
        const leftTurnsEl = this.querySelector('#domain-dock-left-turns');

        const rightTitleEl = this.querySelector('#domain-dock-right-title');
        const rightDescEl = this.querySelector('#domain-dock-right-desc');
        const rightTurnsEl = this.querySelector('#domain-dock-right-turns');

        let domain = null;
        const effects = this.gameState.skillSystem.activeEffects;

        const considerEffect = (eff) => {
            if (!eff || domain) return;
            if ((eff.type === 'array_domain' || eff.type === 'room_domain' || eff.type === 'frieren_domain' || eff.type === 'construction_site_domain' || eff.type === 'alchemy_domain' || eff.type === 'kaito_recovery_zone_array') && (Number(eff.turnsLeft) || 0) > 0) {
                domain = eff;
            }
        };

        if (effects && typeof effects.entries === 'function') {
            for (const [, eff] of effects.entries()) {
                considerEffect(eff);
                if (domain) break;
            }
        } else if (Array.isArray(effects)) {
            for (const eff of effects) {
                considerEffect(eff);
                if (domain) break;
            }
        } else if (effects && typeof effects === 'object') {
            for (const eff of Object.values(effects)) {
                considerEffect(eff);
                if (domain) break;
            }
        }

        if (!domain) {
            if (leftDock) leftDock.style.display = 'none';
            if (rightDock) rightDock.style.display = 'none';

            if (leftTitleEl) leftTitleEl.textContent = '';
            if (leftDescEl) leftDescEl.textContent = '';
            if (leftTurnsEl) leftTurnsEl.textContent = '';

            if (rightTitleEl) rightTitleEl.textContent = '';
            if (rightDescEl) rightDescEl.textContent = '';
            if (rightTurnsEl) rightTurnsEl.textContent = '';
            return;
        }

        const ownerId = domain.ownerId;
        const shouldShowOnRight = ownerId ? ownerId === this.gameState.playerId : false;

        if (leftDock) leftDock.style.display = shouldShowOnRight ? 'none' : 'block';
        if (rightDock) rightDock.style.display = shouldShowOnRight ? 'block' : 'none';

        const titleText = domain.name || 'Domain';
        const descText = domain.description || '';
        const turnsText = `${Number(domain.turnsLeft) || 0} turn(s) remaining`;

        if (shouldShowOnRight) {
            if (rightTitleEl) rightTitleEl.textContent = titleText;
            if (rightDescEl) rightDescEl.textContent = descText;
            if (rightTurnsEl) rightTurnsEl.textContent = turnsText;
        } else {
            if (leftTitleEl) leftTitleEl.textContent = titleText;
            if (leftDescEl) leftDescEl.textContent = descText;
            if (leftTurnsEl) leftTurnsEl.textContent = turnsText;
        }
    }

    updateDomainEffectIndicatorsMobile() {
        try {
            if (!this.gameCoordinator || !this.gameCoordinator.gameState || !this.gameCoordinator.gameState.skillSystem) return;
            const gs = this.gameCoordinator.gameState;
            const ss = gs.skillSystem;

            const active = ss.activeEffects;
            let domain = null;

            const consider = (eff) => {
                if (!eff || domain) return;
                if ((eff.type === 'array_domain' || eff.type === 'room_domain' || eff.type === 'frieren_domain' || eff.type === 'construction_site_domain' || eff.type === 'alchemy_domain' || eff.type === 'kaito_recovery_zone_array') && (Number(eff.turnsLeft) || 0) > 0) {
                    domain = eff;
                }
            };

            if (active && typeof active.entries === 'function') {
                for (const [, eff] of active.entries()) {
                    consider(eff);
                    if (domain) break;
                }
            } else if (Array.isArray(active)) {
                for (const eff of active) {
                    consider(eff);
                    if (domain) break;
                }
            } else if (active && typeof active === 'object') {
                for (const eff of Object.values(active)) {
                    consider(eff);
                    if (domain) break;
                }
            }

            const upsert = (containerSel, domainEff, show) => {
                const container = this.querySelector(containerSel);
                if (!container) return;

                const key = 'domain_mobile';
                let el = null;
                try {
                    el = container.querySelector(`[data-effect-key="${key}"]`);
                } catch (e) {
                    el = null;
                }

                if (!show || !domainEff) {
                    if (el) {
                        try { el.remove(); } catch (e) {}
                    }
                    return;
                }

                if (!el) {
                    el = document.createElement('div');
                    el.dataset.effectKey = key;
                }

                el.className = 'effect-indicator domain-mobile';
                el.textContent = '';

                const turns = Number(domainEff.turnsLeft) || 0;
                const name = domainEff.name || 'Domain';
                const desc = domainEff.description || '';
                el.title = `${name}: ${desc}`;

                el.onclick = (e) => {
                    try {
                        this.showEffectTooltip(e, {
                            effect: {
                                name,
                                description: desc,
                                turnsLeft: turns
                            }
                        });
                    } catch (err) {}
                };

                if (el.parentNode !== container) {
                    container.appendChild(el);
                } else {
                    container.appendChild(el);
                }
            };

            if (!domain) {
                upsert('#player-effects', null, false);
                upsert('#opponent-effects', null, false);
                return;
            }

            const ownerId = domain.ownerId;
            const currentRole = gs && typeof gs.getGameStateForPlayer === 'function'
                ? (gs.getGameStateForPlayer(this.gameCoordinator.currentPlayerRole)?.playerId)
                : this.gameCoordinator.currentPlayerRole;

            const showOnPlayer = ownerId ? ownerId === currentRole : false;
            upsert('#player-effects', domain, showOnPlayer);
            upsert('#opponent-effects', domain, !showOnPlayer);
        } catch (e) {}
    }

    async autoSkipIfStunned() {
        if (!this.gameCoordinator || !this.gameState) return;
        if (this.gameState.gamePhase && this.gameState.gamePhase !== 'active') return;
        if (!this.gameState.isYourTurn) return;

        const isStunned =
            this.gameState.skillSystem &&
            this.gameState.skillSystem.isStunned(this.gameCoordinator.currentPlayerRole);

        if (!isStunned) return;

        // Don't auto-skip repeatedly within the same turnCount.
        if (this.lastAutoSkipTurnCount === this.gameState.turnCount) return;
        this.lastAutoSkipTurnCount = this.gameState.turnCount;

        try {
            this.disableAllActions();
            this.addLogMessage('You are stunned - skipping turn');
            await this.gameCoordinator.skipTurn();
        } catch (error) {
            console.error('Failed to auto-skip stunned turn:', error);
            this.enableActionsIfYourTurn();
        }
    }

    hasAnyUsableAction() {
        if (!this.gameCoordinator || !this.gameState) return true;
        if (!this.gameState.isYourTurn) return true;

        // Ultimate
        if (this.gameCoordinator.canUseUltimate()) {
            return true;
        }

        // Skills
        const skills = this.gameState.player?.character?.skills || [];
        for (let i = 0; i < skills.length; i++) {
            if (this.gameCoordinator.canUseSkill(i)) {
                return true;
            }
        }

        return false;
    }

    async autoSkipIfNoActions() {
        if (!this.gameCoordinator || !this.gameState) return;
        if (this.gameState.gamePhase && this.gameState.gamePhase !== 'active') return;
        if (!this.gameState.isYourTurn) return;

        // Don't auto-skip repeatedly within the same turnCount.
        if (this.lastAutoSkipTurnCount === this.gameState.turnCount) return;

        if (this.hasAnyUsableAction()) return;

        this.lastAutoSkipTurnCount = this.gameState.turnCount;

        try {
            this.disableAllActions();
            this.addLogMessage('No skills available - skipping turn');
            await this.gameCoordinator.skipTurn();
        } catch (error) {
            console.error('Failed to auto-skip turn:', error);
            this.enableActionsIfYourTurn();
        }
    }

    updateTurnIndicator() {
        const turnText = this.querySelector('#turn-text');
        const turnCounter = this.querySelector('#turn-counter');
        
        if (this.gameState.isYourTurn) {
            turnText.textContent = 'Your Turn';
            turnText.className = 'your-turn';
        } else {
            turnText.textContent = "Opponent's Turn";
            turnText.className = 'opponent-turn';
        }
        
        turnCounter.textContent = Math.floor(this.gameState.turnCount / 2) + 1;
    }

    setupSprites() {
        if (!this.gameState) return;

        const playerImage = this.querySelector('#player-image');
        if (playerImage) {
            const src = window.BattleAssets && typeof window.BattleAssets.getCharacterPortraitSrc === 'function'
                ? window.BattleAssets.getCharacterPortraitSrc(this.gameState.player.character)
                : null;
            const fallback = window.BattleAssets && typeof window.BattleAssets.getCharacterPortraitFallbackSrc === 'function'
                ? window.BattleAssets.getCharacterPortraitFallbackSrc()
                : 'assets/images/characters/placeholder.png';
            if (src) playerImage.src = src;
            playerImage.onerror = () => playerImage.src = fallback;
        }

        const opponentImage = this.querySelector('#opponent-image');
        if (opponentImage) {
            const src = window.BattleAssets && typeof window.BattleAssets.getCharacterPortraitSrc === 'function'
                ? window.BattleAssets.getCharacterPortraitSrc(this.gameState.opponent.character)
                : null;
            const fallback = window.BattleAssets && typeof window.BattleAssets.getCharacterPortraitFallbackSrc === 'function'
                ? window.BattleAssets.getCharacterPortraitFallbackSrc()
                : 'assets/images/characters/placeholder.png';
            if (src) opponentImage.src = src;
            opponentImage.onerror = () => opponentImage.src = fallback;
        }

        const playerSprite = this.querySelector('#player-sprite');
        const opponentSprite = this.querySelector('#opponent-sprite');

        const playerFrames = this.getIdleFramesForCharacter(this.gameState.player.character);
        const opponentFrames = this.getIdleFramesForCharacter(this.gameState.opponent.character);

        if (playerSprite) {
            playerSprite.src = playerFrames[0];
            playerSprite.onerror = () => {
                playerSprite.onerror = null;
                const fb = window.BattleAssets && typeof window.BattleAssets.getDefaultIdleFallbackFrame === 'function'
                    ? window.BattleAssets.getDefaultIdleFallbackFrame()
                    : 'assets/animations/zero_two/zero_two_idle_1.png';
                playerSprite.src = fb;
            };
        }
        if (opponentSprite) {
            opponentSprite.src = opponentFrames[0];
            opponentSprite.onerror = () => {
                opponentSprite.onerror = null;
                const fb = window.BattleAssets && typeof window.BattleAssets.getDefaultIdleFallbackFrame === 'function'
                    ? window.BattleAssets.getDefaultIdleFallbackFrame()
                    : 'assets/animations/zero_two/zero_two_idle_1.png';
                opponentSprite.src = fb;
            };
        }
    }

    startIdleSpriteAnimation() {
        if (this.spriteAnimation.intervalId) {
            clearInterval(this.spriteAnimation.intervalId);
            this.spriteAnimation.intervalId = null;
        }

        if (!this.gameState) return;

        const playerSprite = this.querySelector('#player-sprite');
        const opponentSprite = this.querySelector('#opponent-sprite');

        if (!playerSprite && !opponentSprite) return;

        this.spriteAnimation.frameIndex.player = 0;
        this.spriteAnimation.frameIndex.opponent = 0;
        this.spriteAnimation.lastFramesKey.player = null;
        this.spriteAnimation.lastFramesKey.opponent = null;

        const tick = () => {
            const playerFrames = this.getSpriteFramesForSide('player') || [];
            const opponentFrames = this.getSpriteFramesForSide('opponent') || [];

            const pKey = this.getSpriteFramesKey('player', playerFrames);
            const oKey = this.getSpriteFramesKey('opponent', opponentFrames);

            if (pKey !== this.spriteAnimation.lastFramesKey.player) {
                this.spriteAnimation.lastFramesKey.player = pKey;
                this.spriteAnimation.frameIndex.player = 0;
            }
            if (oKey !== this.spriteAnimation.lastFramesKey.opponent) {
                this.spriteAnimation.lastFramesKey.opponent = oKey;
                this.spriteAnimation.frameIndex.opponent = 0;
            }

            if (playerSprite && playerFrames.length > 0) {
                const idx = this.spriteAnimation.frameIndex.player % playerFrames.length;
                playerSprite.src = playerFrames[idx];
                this.spriteAnimation.frameIndex.player += 1;
            }
            if (opponentSprite && opponentFrames.length > 0) {
                const idx = this.spriteAnimation.frameIndex.opponent % opponentFrames.length;
                opponentSprite.src = opponentFrames[idx];
                this.spriteAnimation.frameIndex.opponent += 1;
            }
        };

        tick();
        this.spriteAnimation.intervalId = setInterval(tick, 450);
    }

    updateHealthBars() {
        const shouldHideOpponentInfo = (() => {
            try {
                if (!this.gameState || !this.gameState.skillSystem) return false;
                const playerId = this.gameState.playerId;
                for (const [, eff] of this.gameState.skillSystem.activeEffects.entries()) {
                    if (!eff) continue;
                    if (eff.type !== 'restriction') continue;
                    if (eff.target !== playerId) continue;
                    if (eff.key !== 'restriction_blindness') continue;
                    if ((Number(eff.turnsLeft) || 0) <= 0) continue;
                    return true;
                }
            } catch (e) {}
            return false;
        })();

        try {
            const opponentHealthText = this.querySelector('#opponent-health-bar .health-text');
            if (opponentHealthText) opponentHealthText.style.visibility = shouldHideOpponentInfo ? 'hidden' : '';
            const opponentStats = this.querySelector('#opponent-stats');
            if (opponentStats) opponentStats.style.display = shouldHideOpponentInfo ? 'none' : '';
            const opponentEffects = this.querySelector('#opponent-effects');
            if (opponentEffects) opponentEffects.style.display = shouldHideOpponentInfo ? 'none' : '';
        } catch (e) {}

        // Player HP
        const playerHealth = Number(this.gameState.player.character.stats.health) || 0;
        const playerMaxHealth = Number(this.gameState.player.character.stats.maxHealth) || 1;
        const playerHealthPercent = Math.max(0, Math.min(100, (playerHealth / playerMaxHealth) * 100));

        if (
            this.lastHealthPercent.player !== null &&
            playerHealthPercent < this.lastHealthPercent.player &&
            (this.pendingCombatTextPresentation || this.pendingHealthAnimation)
        ) {
            this.pendingHealthLoss.player = { from: this.lastHealthPercent.player, to: playerHealthPercent };
        }
        this.lastHealthPercent.player = playerHealthPercent;

        this.updateElement('#player-health-current', playerHealth);
        this.updateElement('#player-health-max', playerMaxHealth);

        const playerFill = this.querySelector('#player-health-fill');
        if (this.displayedHealthPercent.player === null) {
            this.displayedHealthPercent.player = playerHealthPercent;
            this.setShadowHealthPercent('player', playerHealthPercent, false);
        } else if (playerHealthPercent > this.displayedHealthPercent.player) {
            // Healing: if an animation is pending, do not snap the main bar yet.
            if (!this.pendingCombatTextPresentation && !this.pendingHealthAnimation) {
                this.displayedHealthPercent.player = playerHealthPercent;
                this.setShadowHealthPercent('player', playerHealthPercent, false);
            }
        } else if (
            playerHealthPercent < this.displayedHealthPercent.player &&
            !this.pendingHealthAnimation &&
            !this.pendingHealthLoss?.player
        ) {
            // HP decreased without damage animation steps (e.g., health swap): allow the bar to go down
            // and keep the shadow bar in sync so it doesn't visually mask the decrease.
            this.displayedHealthPercent.player = playerHealthPercent;
            this.setShadowHealthPercent('player', playerHealthPercent, false);
        } else if (!this.pendingCombatTextPresentation && !this.pendingHealthAnimation) {
            // Non-animated update: keep UI in sync with actual HP.
            this.displayedHealthPercent.player = playerHealthPercent;
        }
        if (playerFill) {
            playerFill.style.width = `${this.displayedHealthPercent.player}%`;
        }

        // Keep heal overlay hidden unless an explicit heal animation is playing.
        if (!this.healOverlayAnimating.player) {
            this.setHealHealthPercent('player', this.displayedHealthPercent.player, false);
            this.hideHealOverlay('player', false);
        }

        // Player Shield
        const playerShield = Math.max(0, Math.floor(Number(this.gameState.player.character.stats.shield) || 0));
        const playerMaxShield = Math.max(playerShield, Math.floor(Number(this.gameState.player.character.stats.maxShield) || 0));
        const playerShieldBar = this.querySelector('#player-shield-bar');
        if (playerShieldBar) {
            if (playerShield > 0) {
                playerShieldBar.style.display = 'block';
                const shieldPct = playerMaxShield > 0 ? (playerShield / playerMaxShield) * 100 : 0;
                this.updateElement('#player-shield-current', playerShield);
                this.updateElement('#player-shield-max', playerMaxShield);
                this.setElementAttribute('#player-shield-fill', 'style', `width: ${shieldPct}%`);
            } else {
                playerShieldBar.style.display = 'none';
            }
        }

        // Opponent HP
        const opponentHealth = Number(this.gameState.opponent.character.stats.health) || 0;
        const opponentMaxHealth = Number(this.gameState.opponent.character.stats.maxHealth) || 1;
        const opponentHealthPercent = Math.max(0, Math.min(100, (opponentHealth / opponentMaxHealth) * 100));

        if (
            this.lastHealthPercent.opponent !== null &&
            opponentHealthPercent < this.lastHealthPercent.opponent &&
            (this.pendingCombatTextPresentation || this.pendingHealthAnimation)
        ) {
            this.pendingHealthLoss.opponent = { from: this.lastHealthPercent.opponent, to: opponentHealthPercent };
        }
        this.lastHealthPercent.opponent = opponentHealthPercent;

        if (!shouldHideOpponentInfo) {
            this.updateElement('#opponent-health-current', opponentHealth);
            this.updateElement('#opponent-health-max', opponentMaxHealth);
        }

        const opponentFill = this.querySelector('#opponent-health-fill');
        if (this.displayedHealthPercent.opponent === null) {
            this.displayedHealthPercent.opponent = opponentHealthPercent;
            this.setShadowHealthPercent('opponent', opponentHealthPercent, false);
        } else if (opponentHealthPercent > this.displayedHealthPercent.opponent) {
            // Healing: if an animation is pending, do not snap the main bar yet.
            if (!this.pendingCombatTextPresentation && !this.pendingHealthAnimation) {
                this.displayedHealthPercent.opponent = opponentHealthPercent;
                this.setShadowHealthPercent('opponent', opponentHealthPercent, false);
            }
        } else if (
            opponentHealthPercent < this.displayedHealthPercent.opponent &&
            !this.pendingHealthAnimation &&
            !this.pendingHealthLoss?.opponent
        ) {
            // HP decreased without damage animation steps (e.g., health swap): allow the bar to go down
            // and keep the shadow bar in sync so it doesn't visually mask the decrease.
            this.displayedHealthPercent.opponent = opponentHealthPercent;
            this.setShadowHealthPercent('opponent', opponentHealthPercent, false);
        } else if (!this.pendingCombatTextPresentation && !this.pendingHealthAnimation) {
            // Non-animated update: keep UI in sync with actual HP.
            this.displayedHealthPercent.opponent = opponentHealthPercent;
        }
        if (opponentFill) {
            opponentFill.style.width = `${this.displayedHealthPercent.opponent}%`;
        }

        // Keep heal overlay hidden unless an explicit heal animation is playing.
        if (!this.healOverlayAnimating.opponent) {
            this.setHealHealthPercent('opponent', this.displayedHealthPercent.opponent, false);
            this.hideHealOverlay('opponent', false);
        }

        // Opponent Shield
        const opponentShield = Math.max(0, Math.floor(Number(this.gameState.opponent.character.stats.shield) || 0));
        const opponentMaxShield = Math.max(opponentShield, Math.floor(Number(this.gameState.opponent.character.stats.maxShield) || 0));
        const opponentShieldBar = this.querySelector('#opponent-shield-bar');
        if (opponentShieldBar) {
            if (opponentShield > 0) {
                opponentShieldBar.style.display = 'block';
                const shieldPct = opponentMaxShield > 0 ? (opponentShield / opponentMaxShield) * 100 : 0;
                this.updateElement('#opponent-shield-current', opponentShield);
                this.updateElement('#opponent-shield-max', opponentMaxShield);
                this.setElementAttribute('#opponent-shield-fill', 'style', `width: ${shieldPct}%`);
            } else {
                opponentShieldBar.style.display = 'none';
            }
        }
    }

    updateSkills() {
        if (!this.gameState || !this.gameCoordinator) return;

        const isStunned =
            this.gameState.isYourTurn &&
            this.gameState.skillSystem &&
            this.gameState.skillSystem.isStunned(this.gameCoordinator.currentPlayerRole);

        // When stunned on your turn, you cannot use any actions.
        if (isStunned) {
            this.disableAllActions();
            return;
        }

        const skills = this.gameState.player.character.skills;
        if (!Array.isArray(skills)) return;

        const characterId = this.gameState.player.character && this.gameState.player.character.id;
        const passiveState = (this.gameState.player.character && this.gameState.player.character.passiveState) || {};
        const archiveLastType = typeof passiveState.archiveLastPageType === 'string' ? passiveState.archiveLastPageType : null;
        const archivePagesCount = passiveState && passiveState.counters ? (Number(passiveState.counters.archivePages) || 0) : 0;
        const frierenRotatingType = typeof passiveState.frierenRotatingSkillCurrentType === 'string'
            ? passiveState.frierenRotatingSkillCurrentType
            : null;

        const skill2El = this.querySelector('#skill-2');
        if (skill2El) {
            skill2El.style.display = skills.length >= 3 ? '' : 'none';
        }
        const skill3El = this.querySelector('#skill-3');
        if (skill3El) {
            skill3El.style.display = skills.length >= 4 ? '' : 'none';
        }

        skills.forEach((skill, index) => {
            if (!skill) return;

            const stackTag = this.querySelector(`#skill-${index}-stack-tag`);
            if (stackTag) {
                stackTag.textContent = '';
                stackTag.style.display = 'none';
            }

            try {
                if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                    const res = window.BattleHooks.emit('ui:skills:stack_tag', {
                        battlePage: this,
                        gameState: this.gameState,
                        skillSystem: this.gameState?.skillSystem,
                        character: this.gameState?.player?.character,
                        characterId,
                        passiveState,
                        skill,
                        index,
                        stackTag
                    });
                    for (const r of (res || [])) {
                        if (!stackTag) continue;
                        if (typeof r === 'string') {
                            stackTag.textContent = r;
                            stackTag.style.display = r ? 'flex' : 'none';
                        } else if (r && typeof r === 'object') {
                            if (typeof r.text === 'string') {
                                stackTag.textContent = r.text;
                            }
                            if (typeof r.display === 'string') {
                                stackTag.style.display = r.display;
                            } else if (r.text) {
                                stackTag.style.display = 'flex';
                            }
                        }
                    }
                }
            } catch (e) {}

            if (skill.id === 'devour' && (skill._copiedName || skill._copiedDescription)) {
                const baseName = skill._copiedName || skill.name;
                const displayName = typeof baseName === 'string' ? `${baseName}, twice` : baseName;
                this.updateElement(`#skill-${index}-name`, displayName);
                this.updateElement(`#skill-${index}-description`, skill._copiedDescription || skill.description);
            } else {
                this.updateElement(`#skill-${index}-name`, skill.name);

                let hookOverride = null;
                try {
                    if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                        const res = window.BattleHooks.emit('ui:skills:description', {
                            battlePage: this,
                            gameState: this.gameState,
                            skillSystem: this.gameState?.skillSystem,
                            character: this.gameState?.player?.character,
                            characterId,
                            passiveState,
                            skill,
                            index
                        });
                        for (const r of (res || [])) {
                            if (typeof r === 'string') {
                                hookOverride = r;
                            }
                        }
                    }
                } catch (e) {
                    hookOverride = null;
                }

                if (hookOverride !== null) {
                    this.updateElement(`#skill-${index}-description`, hookOverride);
                } else {

                if (characterId === 'saitama' && skill.id === 'grit') {
                    let stored = 0;
                    let isActive = false;
                    try {
                        const effects = this.gameState?.skillSystem?.activeEffects;
                        const pid = this.gameCoordinator?.currentPlayerRole;
                        if (effects && pid) {
                            const iter = (effects && typeof effects.entries === 'function')
                                ? Array.from(effects.entries()).map(([, e]) => e)
                                : (Array.isArray(effects) ? effects : Object.values(effects || {}));
                            const eff = iter.find(e => e && e.type === 'grit_stance' && e.target === pid);
                            stored = eff ? (Number(eff.storedDamage) || 0) : 0;
                            isActive = Boolean(eff);
                        }
                    } catch (e) {
                        stored = 0;
                        isActive = false;
                    }
                    if (isActive) {
                        const release = Math.max(0, Math.floor(stored / 2));
                        this.updateElement(
                            `#skill-${index}-description`,
                            `Release stance and deal ${release} amount of true damage`
                        );
                    } else {
                        this.updateElement(`#skill-${index}-description`, skill.description);
                    }
                } else if (characterId === 'gojo_satoru' && skill.id === 'gojo_strike') {
                    const domainActive = Boolean(this.gameState?.skillSystem && typeof this.gameState.skillSystem.isDomainActive === 'function' && this.gameState.skillSystem.isDomainActive());
                    if (domainActive) {
                        this.updateElement(`#skill-${index}-description`, 'Opponent recovers 25% of their max health');
                    } else {
                        this.updateElement(`#skill-${index}-description`, 'Deal 100% of attack as damage');
                    }
                } else if (characterId === 'gojo_satoru' && skill.id === 'infinity_rebound') {
                    const domainActive = Boolean(this.gameState?.skillSystem && typeof this.gameState.skillSystem.isDomainActive === 'function' && this.gameState.skillSystem.isDomainActive());
                    if (domainActive) {
                        this.updateElement(
                            `#skill-${index}-description`,
                            'While stance is active, when you recover damage from opposing skills, recover that much damage to opponent then deal damage to opponent for half the amount recovered.'
                        );
                    } else {
                        this.updateElement(
                            `#skill-${index}-description`,
                            'While stance is active, when you take damage from opposing skills, deal that much damage to opponent then recovers opponent for half the amount.'
                        );
                    }
                } else {
                    this.updateElement(`#skill-${index}-description`, skill.description);
                }
                }
            }

            const skillButton = this.querySelector(`#skill-${index}`);
            if (!skillButton) return;

            // Always show the base/effective cooldown (pre-use) as a pill tag.
            const cdTag = this.querySelector(`#skill-${index}-cd-tag`);
            if (cdTag) {
                const baseCd = Math.max(0, Math.floor(Number(skill.cooldown) || 0));
                const bonus = (this.gameState?.skillSystem && typeof this.gameState.skillSystem.getEnemySkillCooldownBonus === 'function')
                    ? Math.max(0, Math.floor(this.gameState.skillSystem.getEnemySkillCooldownBonus(this.gameCoordinator.currentPlayerRole)))
                    : 0;
                const effectiveCd = baseCd + bonus;
                cdTag.textContent = bonus > 0 ? `CD ${effectiveCd} (+${bonus})` : `CD ${effectiveCd}`;
                cdTag.style.display = '';
            }

            const cooldownRemaining = this.gameCoordinator.getSkillCooldown(index);
            const isOnCooldown = cooldownRemaining > 0;
            const canUse = this.gameState.isYourTurn && this.gameCoordinator.canUseSkill(index);

            const cooldownElement = this.querySelector(`#skill-${index}-cooldown`);
            if (cooldownElement) {
                if (isOnCooldown) {
                    cooldownElement.style.display = 'block';
                    cooldownElement.textContent = `${cooldownRemaining} turn${cooldownRemaining > 1 ? 's' : ''} left`;
                } else {
                    cooldownElement.style.display = 'none';
                    cooldownElement.textContent = '';
                }
            }

            if (isOnCooldown) {
                skillButton.classList.add('skill-on-cooldown');
                skillButton.disabled = true;
            } else {
                skillButton.classList.remove('skill-on-cooldown');
                let disabled = !canUse;
                try {
                    if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                        const res = window.BattleHooks.emit('ui:skills:disabled', {
                            battlePage: this,
                            gameState: this.gameState,
                            skillSystem: this.gameState?.skillSystem,
                            character: this.gameState?.player?.character,
                            characterId,
                            passiveState,
                            skill,
                            index,
                            canUse,
                            disabled
                        });
                        for (const r of (res || [])) {
                            if (typeof r === 'boolean') {
                                disabled = r;
                            }
                        }
                    }
                } catch (e) {}

                skillButton.disabled = disabled;
            }
        });
    }

    updateUltimate() {
        const ultimate = this.gameState.player.character.ultimate;
        const characterId = this.gameState.player.character.id;
        const passiveState = this.gameState.player.character.passiveState || {};
        const isStunned = this.gameState.isYourTurn && this.gameState.skillSystem && this.gameState.skillSystem.isStunned(this.gameCoordinator.currentPlayerRole);
        const canUse = this.gameState.isYourTurn && !isStunned && this.gameCoordinator.canUseUltimate();
        
        this.updateElement('#ultimate-name', ultimate.name);

        const ultStackTag = this.querySelector('#ultimate-stack-tag');
        if (ultStackTag) {
            ultStackTag.textContent = '';
            ultStackTag.style.display = 'none';
        }

        try {
            if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                const res = window.BattleHooks.emit('ui:ultimate:stack_tag', {
                    battlePage: this,
                    gameState: this.gameState,
                    skillSystem: this.gameState?.skillSystem,
                    character: this.gameState?.player?.character,
                    characterId,
                    passiveState,
                    ultimate,
                    ultStackTag
                });
                for (const r of (res || [])) {
                    if (!ultStackTag) continue;
                    if (typeof r === 'string') {
                        ultStackTag.textContent = r;
                        ultStackTag.style.display = r ? 'flex' : 'none';
                    } else if (r && typeof r === 'object') {
                        if (typeof r.text === 'string') {
                            ultStackTag.textContent = r.text;
                        }
                        if (typeof r.display === 'string') {
                            ultStackTag.style.display = r.display;
                        } else if (r.text) {
                            ultStackTag.style.display = 'flex';
                        }
                    }
                }
            }
        } catch (e) {}

        let desc = ultimate.description;
        try {
            if (characterId === 'zero_two' && ultimate && ultimate.id === 'kiss_of_death') {
                const bonus = Number(passiveState.zeroTwoUltBaseBonus) || 0;
                const base = (Number(ultimate.effect?.base_percent) || 0) + bonus;
                const basePct = Math.round(base * 100);
                desc = `Deal (${basePct}% + 1% per Heartbreak) of attack as damage. While this ultimate is ready, each of your turns you do not use it grants +10% base damage for future uses. Consume 66 Heartbreak stacks.`;
            }

            if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                const res = window.BattleHooks.emit('ui:ultimate:description', {
                    battlePage: this,
                    gameState: this.gameState,
                    skillSystem: this.gameState?.skillSystem,
                    character: this.gameState?.player?.character,
                    characterId,
                    passiveState,
                    ultimate,
                    desc
                });
                for (const r of (res || [])) {
                    if (typeof r === 'string') {
                        desc = r;
                    }
                }
            }
        } catch (e) {}

        this.updateElement('#ultimate-description', desc);

        {
            const cdTag = this.querySelector('#ultimate-cd-tag');
            const cdText = this.querySelector('#ultimate-cooldown');
            const baseCd = Math.max(0, Math.floor(Number(ultimate?.cooldown) || 0));
            if (cdTag) {
                if (baseCd > 0) {
                    const remaining = (this.gameState?.skillSystem && typeof this.gameState.skillSystem.getSkillCooldown === 'function')
                        ? Math.max(0, Math.floor(this.gameState.skillSystem.getSkillCooldown({ id: ultimate.id }, this.gameCoordinator.currentPlayerRole)))
                        : 0;

                    // Global behavior: pill shows only base CD. Remaining turns are shown beneath like normal skills.
                    cdTag.textContent = `CD ${baseCd}`;
                    if (cdText) {
                        if (remaining > 0) {
                            cdText.textContent = `${remaining} ${remaining === 1 ? 'turn' : 'turns'} left`;
                            cdText.style.display = '';
                        } else {
                            cdText.textContent = '';
                            cdText.style.display = 'none';
                        }
                    }
                    cdTag.style.display = '';
                } else {
                    cdTag.textContent = '';
                    cdTag.style.display = 'none';
                    if (cdText) {
                        cdText.textContent = '';
                        cdText.style.display = 'none';
                    }
                }
            }
        }
        
        const ultimateButton = this.querySelector('#ultimate-button');
        if (ultimateButton) {
            let disabled = !canUse;
            try {
                if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                    const res = window.BattleHooks.emit('ui:ultimate:disabled', {
                        battlePage: this,
                        gameState: this.gameState,
                        skillSystem: this.gameState?.skillSystem,
                        character: this.gameState?.player?.character,
                        characterId,
                        passiveState,
                        ultimate,
                        canUse,
                        disabled
                    });
                    for (const r of (res || [])) {
                        if (typeof r === 'boolean') {
                            disabled = r;
                        }
                    }
                }
            } catch (e) {}
            ultimateButton.disabled = disabled;
        }
        const statusElement = this.querySelector('#ultimate-status');
        {
            const remaining = (this.gameState?.skillSystem && typeof this.gameState.skillSystem.getSkillCooldown === 'function')
                ? Math.max(0, Math.floor(this.gameState.skillSystem.getSkillCooldown({ id: ultimate.id }, this.gameCoordinator.currentPlayerRole)))
                : 0;
            const hasCooldownActive = remaining > 0;

            if (hasCooldownActive) {
                statusElement.textContent = '';
                statusElement.style.display = 'none';
            } else {
                statusElement.style.display = '';
                // Ultimate should show as Ready once cooldown is 0 and the readiness condition is met,
                // even if it is currently blocked by restrictions/debuffs (button remains disabled).
                if (this.gameState.player.ultimateReady) {
                    statusElement.textContent = 'Ready';
                    statusElement.className = 'ultimate-ready';
                } else {
                    statusElement.textContent = 'Not Ready';
                    statusElement.className = 'ultimate-not-ready';
                }
            }
        }
    }

    updatePassive() {
        const character = this.gameState.player.character;
        const passive = character.passive;
        const progress = character.passiveProgress || {};
        const passiveState = character.passiveState || {};

        const condition = passive && passive.mission
            ? passive.mission
            : (passive && passive.type === 'dual_passive'
                ? passive.ultimate_condition
                : (passive && passive.ultimate_condition ? passive.ultimate_condition : passive));
        
        let passiveName = passive.name;
        let passiveDesc = (this.isMobileViewport() && passive && typeof passive.mobileDescription === 'string' && passive.mobileDescription.trim())
            ? passive.mobileDescription
            : passive.description;
        if (character && character.id === 'naofumi_iwatani') {
                const key = typeof passiveState.naofumiCurrentShieldKey === 'string' ? passiveState.naofumiCurrentShieldKey : null;
                if (key === 'legendary') {
                    passiveName = 'Legendary Shield';
                    passiveDesc = 'At the start of battle, gain +7 defense permanently.';
                } else if (key === 'leaf') {
                    passiveName = 'Leaf Shield';
                    passiveDesc = 'At the start of your turn, heal 10 health and cleanse yourself.';
                } else if (key === 'chimera') {
                    passiveName = 'Chimera Shield';
                    passiveDesc = "When taking damage from an enemy skill, deal damage to opponent's attack as true damage.";
                } else if (key === 'prison') {
                    passiveName = 'Shield Prison';
                    passiveDesc = 'At the start of your turn, stun the opponent for 1 turn and deal 10 damage which bypasses defense.';
                } else if (key === 'slime') {
                    passiveName = 'Slime Shield';
                    passiveDesc = 'This turn, your attack skills are triggered twice.';
                } else if (key === 'soul_eater') {
                    passiveName = 'Soul Eater Shield';
                    passiveDesc = 'Your skills become Undead Control and Soul Eat for this turn. When using a skill recover 3% of max health.';
                } else if (key === 'transformation') {
                    passiveName = 'Transformation Shield';
                    passiveDesc = 'Gain access to your ultimate and your skills ignore defense. At the end of your turn, take escalating true damage.';
                }
            }

        if (character && character.id === 'kaito') {
            const weaponKey = typeof passiveState?.kaitoWeaponKey === 'string' ? passiveState.kaitoWeaponKey : null;
            if (weaponKey && window.KaitoCharacter && typeof window.KaitoCharacter.getWeaponByKey === 'function') {
                const w = window.KaitoCharacter.getWeaponByKey(weaponKey);
                const label = w && typeof w.name === 'string' ? w.name : weaponKey;
                passiveDesc = `${passiveDesc}<span class="kaito-current-weapon-inline"> Current weapon : ${label}</span>`;
            }
        }

        this.updateElement('#passive-name', passiveName);
        this.updateElement('#passive-description', passiveDesc);
        
        // Update progress display based on passive type
        const progressElement = this.querySelector('#passive-progress');
        let progressText = '';

        const conditionType = condition?.type;
        const threshold = typeof condition?.value === 'number' ? condition.value : undefined;
        
        switch (conditionType) {
            case 'stack_threshold': {
                const key = condition?.counter;
                const current = key ? (passiveState?.counters?.[key] || 0) : 0;
                progressText = `${current}/${threshold ?? 0}`;
                break;
            }
            case 'total_healing_done': {
                const current = passiveState?.totalHealingDone || 0;
                progressText = `${current}/${threshold ?? 0}`;
                break;
            }
            case 'damage_threshold':
                progressText = `${progress.damageTaken || 0}/${threshold ?? (progress.threshold || 0)}`;
                break;
            case 'skill_count':
                progressText = `${progress.skillsUsed || 0}/${threshold ?? (progress.threshold || 0)}`;
                break;
            case 'heal_count':
                progressText = `${progress.healsUsed || 0}/${threshold ?? (progress.threshold || 0)}`;
                break;
            case 'blocks_performed':
                progressText = `${progress.blocksPerformed || 0}/${threshold ?? (progress.threshold || 0)}`;
                break;
            case 'enemy_health_threshold':
                const enemyHealthPercent = Math.round((this.gameState.opponent.character.stats.health / this.gameState.opponent.character.stats.maxHealth) * 100);
                progressText = `Enemy health: ${enemyHealthPercent}% (triggers at ${Math.round(((threshold ?? progress.threshold) || 0) * 100)}%)`;
                break;
            case 'turns_survived':
                progressText = `${progress.turnsSurvived || 0}/${threshold ?? (progress.threshold || 0)}`;
                break;
            case 'total_damage_dealt':
                progressText = `${progress.totalDamageDealt || 0}/${threshold ?? (progress.threshold || 0)}`;
                break;
            case 'lifesteal_damage_dealt':
                progressText = `${progress.lifestealDamageDealt || 0}/${threshold ?? (progress.threshold || 0)}`;
                break;
            case 'poison_effects_applied':
                progressText = `${progress.poisonEffectsApplied || 0}/${threshold ?? (progress.threshold || 0)}`;
                break;
            case 'total_healing_done_legacy':
                progressText = `${progress.totalHealingDone || 0}/${threshold ?? (progress.threshold || 0)}`;
                break;
        }
        
        progressElement.textContent = progressText;
    }

    updateEffects() {
        // Update player effects
        const playerEffects = this.querySelector('#player-effects');
        playerEffects.innerHTML = '';
        
        this.gameState.player.activeEffects.forEach(effect => {
            const effectElement = this.createEffectElement(effect);
            playerEffects.appendChild(effectElement);
        });
        
        // Update opponent effects
        const opponentEffects = this.querySelector('#opponent-effects');
        opponentEffects.innerHTML = '';
        
        this.gameState.opponent.activeEffects.forEach(effect => {
            const effectElement = this.createEffectElement(effect);
            opponentEffects.appendChild(effectElement);
        });
    }

    createEffectElement(effect) {
        const element = document.createElement('div');
        element.className = `effect effect-${effect.type}`;
        
        let effectText = '';
        switch (effect.type) {
            case 'poison':
                effectText = `Poison (${effect.turnsLeft} turns)`;
                break;
            case 'buff':
                effectText = `${effect.stat} buff (${effect.turnsLeft} turns)`;
                break;
            default:
                effectText = `${effect.type} (${effect.turnsLeft} turns)`;
        }
        
        element.textContent = effectText;
        return element;
    }

    async useSkill(skillIndex) {
        // Check if skill can be used before attempting
        if (!this.gameState.isYourTurn) {
            return; // Silently ignore if not player's turn
        }
        
        if (!this.gameCoordinator.canUseSkill(skillIndex)) {
            // Skill is on cooldown or unavailable - don't show error
            return;
        }

        try {
            this.disableAllActions();
            
            const skill = this.gameState.player.character.skills[skillIndex];
            this.addLogMessage(`You used ${skill.name}`);
            
            // Execute skill with IMMEDIATE logic and sync
            const result = await this.gameCoordinator.useSkill(skillIndex);
            
            // Log results (animations run independently in background)
            if (result.damage > 0) {
                this.addLogMessage(`Dealt ${result.damage} damage to opponent`);
            }
            
            if (result.healing > 0) {
                this.addLogMessage(`Healed for ${result.healing} health`);
            }
            
            if (result.gameEnded) {
                this.addLogMessage(`Game ended! Winner: ${result.winner}`);
            }
            
        } catch (error) {
            console.error('Failed to use skill:', error);
            this.addLogMessage(`Failed to use skill: ${error.message}`);
            this.enableActionsIfYourTurn();
        }
    }

    async useUltimate() {
        if (!this.gameState.isYourTurn || !this.gameCoordinator.canUseUltimate()) {
            return;
        }

        try {
            this.disableAllActions();
            
            const ultimate = this.gameState.player.character.ultimate;
            this.addLogMessage(`You used ${ultimate.name}!`);

            this.playUltimateVideoForCharacter(this.gameState.player.character);
            
            // Execute ultimate with IMMEDIATE logic and sync
            const result = await this.gameCoordinator.useUltimate();

            // Log results (animations run independently in background)
            if (result.damage > 0) {
                this.addLogMessage(`Ultimate dealt ${result.damage} damage!`);
            }
            
            if (result.healing > 0) {
                this.addLogMessage(`Ultimate healed for ${result.healing} health!`);
            }
            
            if (result.gameEnded) {
                this.addLogMessage(`Game ended! Winner: ${result.winner}`);
            }
            
        } catch (error) {
            console.error('Failed to use ultimate:', error);
            this.addLogMessage(`Failed to use ultimate: ${error.message}`);
            this.enableActionsIfYourTurn();
        }
    }

    disableAllActions() {
        this.disableElement('#skill-0');
        this.disableElement('#skill-1');
        this.disableElement('#skill-2');
        this.disableElement('#skill-3');
        this.disableElement('#ultimate-button');

        // Skip is a UI preference toggle, not a gameplay action.
        // Keep it clickable even while actions are locked.
        this.enableElement('#skip-animations-button');
    }

    enableActionsIfYourTurn() {
        if (!this.gameState || !this.gameState.isYourTurn) return;

        this.updateSkills();
        this.updateUltimate();
    }

    updateGameState(newGameState, actionResult) {
        this.gameState = newGameState;

        if (actionResult) {
            const actorSide = actionResult._actionSource === 'opponent' ? 'opponent' : 'player';
            const actorId = typeof actionResult.actorCharacterId === 'string'
                ? actionResult.actorCharacterId
                : (actorSide === 'player' ? this.gameState?.player?.character?.id : this.gameState?.opponent?.character?.id);
            const skillType = typeof actionResult.skillType === 'string' ? actionResult.skillType : null;
            const skillId = typeof actionResult.skillId === 'string' ? actionResult.skillId : null;
            const closeAdjustedActionResult = (window.BattleAnimations && typeof window.BattleAnimations.withCloseAttackCombatTextOffset === 'function')
                ? window.BattleAnimations.withCloseAttackCombatTextOffset(actionResult, actorId, skillType, skillId)
                : actionResult;
            const adjustedActionResult = (window.BattleAnimations && typeof window.BattleAnimations.withRangedAttackCombatTextDelay === 'function')
                ? window.BattleAnimations.withRangedAttackCombatTextDelay(closeAdjustedActionResult, actorId, skillId)
                : closeAdjustedActionResult;

            // Prepare HP animation BEFORE updateUI() updates bar widths.
            this.pendingHealthAnimation = this.buildHealthAnimationFromCombatText(adjustedActionResult, newGameState);

            const actionAnimations = Array.isArray(adjustedActionResult.animations) ? adjustedActionResult.animations : [];
            if (actionAnimations.length === 0) {
                // No combat_text to drive an animation: fall back to a bar sync.
                this.pendingHealthAnimation = null;
            }

            if (actionResult._actionSource === 'opponent' && actionResult.actionType === 'ultimate') {
                const actorCharacterId = actionResult.actorCharacterId;
                if (actorCharacterId) {
                    this.playUltimateVideoForCharacter({ id: actorCharacterId });
                } else {
                    this.playUltimateVideoForCharacter(this.gameState.opponent.character);
                }
            }

            // Now render the new state.
            this.updateUI();
            this.startIdleSpriteAnimation();

            // If there are no animations, keep bars in sync (but allow first-hit animations when combat_text exists).
            if (actionAnimations.length === 0) {
                try {
                    const pHealth = Number(this.gameState?.player?.character?.stats?.health) || 0;
                    const pMax = Number(this.gameState?.player?.character?.stats?.maxHealth) || 1;
                    const oHealth = Number(this.gameState?.opponent?.character?.stats?.health) || 0;
                    const oMax = Number(this.gameState?.opponent?.character?.stats?.maxHealth) || 1;
                    const pPct = Math.max(0, Math.min(100, (pHealth / Math.max(1, pMax)) * 100));
                    const oPct = Math.max(0, Math.min(100, (oHealth / Math.max(1, oMax)) * 100));

                    this.pendingHealthLoss.player = null;
                    this.pendingHealthLoss.opponent = null;

                    this.setGreenHealthPercent('player', pPct, false);
                    this.setShadowHealthPercent('player', pPct, false);
                    this.setGreenHealthPercent('opponent', oPct, false);
                    this.setShadowHealthPercent('opponent', oPct, false);
                } catch (e) {
                    // no-op
                }
            }
            const animationPromises = [];
            animationPromises.push(this.scheduleCombatTextAnimations(adjustedActionResult));

            // Character-specific close-attack animations (synced to combat_text delayMs).
            try {
                if (actorId && skillId) {
                    const actorChar = { id: actorId };
                    const hasClose = window.BattleAssets && typeof window.BattleAssets.getCloseAttackAnimationForCharacterSkill === 'function'
                        ? Boolean(window.BattleAssets.getCloseAttackAnimationForCharacterSkill(actorChar, skillId))
                        : (window.BattleAssets && typeof window.BattleAssets.getCloseAttackAnimationForCharacter === 'function'
                            ? Boolean(window.BattleAssets.getCloseAttackAnimationForCharacter(actorChar))
                            : false);

                    if (hasClose) {
                        if (window.BattleAnimations && typeof window.BattleAnimations.playCloseAttackAnimationForSide === 'function') {
                            animationPromises.push(
                                window.BattleAnimations.playCloseAttackAnimationForSide(this, adjustedActionResult, actorSide, actorId, skillId)
                            );
                        }
                    }
                }
            } catch (e) {}

            // Character-specific ranged attack animations (dual attacker + target overlay).
            try {
                if (actorId && skillId) {
                    const actorChar = { id: actorId };
                    const hasRanged = window.BattleAssets && typeof window.BattleAssets.getRangedAttackAnimationForCharacterSkill === 'function'
                        ? Boolean(window.BattleAssets.getRangedAttackAnimationForCharacterSkill(actorChar, skillId))
                        : false;
                    if (hasRanged && window.BattleAnimations && typeof window.BattleAnimations.playRangedAttackAnimationForSide === 'function') {
                        animationPromises.push(
                            window.BattleAnimations.playRangedAttackAnimationForSide(this, adjustedActionResult, actorSide, actorId, skillId)
                        );
                    }
                }
            } catch (e) {}

            // Character-specific domain skill animations (simple frame sequence).
            try {
                if (skillType === 'domain' && skillId) {
                    if (window.BattleAnimations && typeof window.BattleAnimations.playDomainSkillAnimationForSide === 'function') {
                        animationPromises.push(
                            window.BattleAnimations.playDomainSkillAnimationForSide(this, actorSide, actorId, skillId)
                        );
                    }
                }
            } catch (e) {}

            // Character-specific debuff skill animations (simple frame sequence).
            try {
                if (skillType === 'debuff' && skillId) {
                    if (window.BattleAnimations && typeof window.BattleAnimations.playSkillSequenceAnimationForSide === 'function') {
                        animationPromises.push(
                            window.BattleAnimations.playSkillSequenceAnimationForSide(this, actorSide, actorId, skillId, skillType)
                        );
                    }
                }
            } catch (e) {}

            // Character-specific recovery skill animations (simple frame sequence).
            try {
                if (skillType === 'recovery' && skillId) {
                    if (window.BattleAnimations && typeof window.BattleAnimations.playSkillSequenceAnimationForSide === 'function') {
                        animationPromises.push(
                            window.BattleAnimations.playSkillSequenceAnimationForSide(this, actorSide, actorId, skillId, skillType)
                        );
                    }
                }
            } catch (e) {}

            // Character-specific utility skill animations (simple frame sequence).
            try {
                if (skillType === 'utility' && skillId) {
                    if (window.BattleAnimations && typeof window.BattleAnimations.playSkillSequenceAnimationForSide === 'function') {
                        animationPromises.push(
                            window.BattleAnimations.playSkillSequenceAnimationForSide(this, actorSide, actorId, skillId, skillType)
                        );
                    }
                }
            } catch (e) {}

            // Character-specific buff skill animations (simple frame sequence).
            try {
                if (skillType === 'buff' && skillId) {
                    if (window.BattleAnimations && typeof window.BattleAnimations.playSkillSequenceAnimationForSide === 'function') {
                        animationPromises.push(
                            window.BattleAnimations.playSkillSequenceAnimationForSide(this, actorSide, actorId, skillId, skillType)
                        );
                    }
                }
            } catch (e) {}

            // Track the full presentation for this action so game-end navigation waits for it.
            try {
                const p = Promise.allSettled(animationPromises);
                this.pendingActionPresentation = p.finally(() => {
                    if (this.pendingActionPresentation === p) {
                        this.pendingActionPresentation = null;
                        this.pendingActionPresentationKey = null;
                    }
                });
                this.pendingActionPresentationKey = (actionResult && actionResult._syncActionKey)
                    ? actionResult._syncActionKey
                    : null;
            } catch (e) {
                this.pendingActionPresentation = null;
                this.pendingActionPresentationKey = null;
            }

            // Only log opponent actions here. Local actions are logged in useSkill/useUltimate.
            if (actionResult._actionSource === 'opponent') {
                // Log opponent's action with skill name
                // actionResult should contain the skill/ultimate name from the network message
                const actionName = actionResult.skillName || actionResult.ultimateName || 'a skill';
                this.addLogMessage(`Opponent used ${actionName}`);

                if (actionResult.damage > 0) {
                    this.addLogMessage(`You took ${actionResult.damage} damage`);
                }

                if (actionResult.stunApplied) {
                    this.addLogMessage(`You are stunned for ${actionResult.stunDuration} turn${actionResult.stunDuration > 1 ? 's' : ''}`);
                }
            }
            
            // Handle game end
            if (actionResult.gameEnded) {
                this.handleGameEnd(actionResult.winner);
            }
        }
    }

    handleGameEnd(winner) {
        const currentPlayerRole = this.gameCoordinator?.currentPlayerRole || this.gameState?.playerId;
        const isWinner = currentPlayerRole ? (winner === currentPlayerRole) : false;
        
        if (isWinner) {
            this.addLogMessage('VICTORY! You won the battle!');
        } else {
            this.addLogMessage('DEFEAT! You lost the battle!');
        }
        
        // Disable all actions
        this.disableAllActions();
        
        // Update turn indicator to show game over
        const turnText = this.querySelector('#turn-text');
        turnText.textContent = 'Game Over';
        turnText.className = 'game-over';
    }

    updateEffectIndicators() {
        if (!this.gameState || !this.gameCoordinator) return;
        
        // Check if gameCoordinator has access to the full game state
        if (!this.gameCoordinator.gameState || !this.gameCoordinator.gameState.skillSystem) {
            console.warn('SkillSystem not available yet');
            return;
        }

        // Get current player role to determine which effects belong to whom
        const currentPlayerRole = this.gameCoordinator.currentPlayerRole;
        const opponentRole = currentPlayerRole === 'player1' ? 'player2' : 'player1';

        // Update player effects using the full game state from coordinator
        const playerEffects = this.gameCoordinator.gameState.skillSystem.getActiveEffectsForPlayer(currentPlayerRole);
        this.renderEffectIndicators('#player-effects', playerEffects, currentPlayerRole);

        // Update opponent effects  
        const opponentEffects = this.gameCoordinator.gameState.skillSystem.getActiveEffectsForPlayer(opponentRole);
        this.renderEffectIndicators('#opponent-effects', opponentEffects, opponentRole);
    }

    renderEffectIndicators(containerId, effects, playerRole) {
        const container = this.querySelector(containerId);
        if (!container) return;

        const existingByKey = new Map();
        try {
            for (const el of Array.from(container.children || [])) {
                const key = el && el.dataset ? el.dataset.effectKey : null;
                if (key) {
                    existingByKey.set(key, el);
                }
            }
        } catch (e) {}

        const desired = [];

        try {
            if (this.isMobileViewport && this.isMobileViewport()) {
                const active = this.gameCoordinator?.gameState?.skillSystem?.activeEffects;
                let domain = null;
                const consider = (eff) => {
                    if (!eff || domain) return;
                    if ((eff.type === 'array_domain' || eff.type === 'room_domain' || eff.type === 'frieren_domain' || eff.type === 'construction_site_domain' || eff.type === 'alchemy_domain' || eff.type === 'kaito_recovery_zone_array') && (Number(eff.turnsLeft) || 0) > 0) {
                        domain = eff;
                    }
                };

                if (active && typeof active.entries === 'function') {
                    for (const [, eff] of active.entries()) {
                        consider(eff);
                        if (domain) break;
                    }
                } else if (Array.isArray(active)) {
                    for (const eff of active) {
                        consider(eff);
                        if (domain) break;
                    }
                } else if (active && typeof active === 'object') {
                    for (const eff of Object.values(active)) {
                        consider(eff);
                        if (domain) break;
                    }
                }

                if (domain && domain.ownerId && domain.ownerId === playerRole) {
                    const name = domain.name || 'Domain';
                    const desc = domain.description || '';
                    const turns = Number(domain.turnsLeft) || 0;
                    const duration = Number(domain.duration) || turns || 1;
                    const ratio = duration > 0 ? Math.max(0, Math.min(1, turns / duration)) : 1;
                    const elapsed = 1 - ratio;
                    const shadeDeg = Math.round(elapsed * 360);
                    desired.push({
                        key: 'domain_mobile',
                        className: 'effect-indicator domain-mobile',
                        text: '',
                        title: `${name}: ${desc}`,
                        shadeDeg,
                        onClick: (e) => {
                            try {
                                this.showEffectTooltip(e, {
                                    effect: {
                                        name,
                                        description: desc,
                                        turnsLeft: turns
                                    }
                                });
                            } catch (err) {}
                        }
                    });
                }
            }
        } catch (e) {}

        const character = this.gameCoordinator?.gameState?.players?.get(playerRole)?.character;
        const passive = character?.passive;
        const mission = passive?.mission;

        const badges = Array.isArray(passive?.stackBadges) ? passive.stackBadges : null;
        const hasHeatBadge = Boolean(badges && badges.some(b => b && b.counter === 'heat'));
        if (badges && badges.length > 0) {
            for (const badge of badges) {
                const key = badge?.counter;
                if (!key) continue;
                const stacks = character?.passiveState?.counters?.[key] || 0;

                const indicatorKey = `badge:${key}`;
                const indicatorClass = `effect-indicator stack-counter ${badge.className || ''}`.trim();
                let indicatorTitle = `${badge.title || key}: ${stacks}`;

                try {
                    if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                        const res = window.BattleHooks.emit('ui:effect_indicators:badge_title', {
                            battlePage: this,
                            playerRole,
                            character,
                            badge,
                            counterKey: key,
                            stacks,
                            title: indicatorTitle
                        });
                        for (const r of (res || [])) {
                            if (typeof r === 'string') {
                                indicatorTitle = r;
                            }
                        }
                    }
                } catch (e) {}

                desired.push({
                    key: indicatorKey,
                    className: indicatorClass,
                    text: String(stacks),
                    title: indicatorTitle,
                    shadeDeg: null,
                    onClick: null
                });
            }
        } else if (mission && mission.type === 'stack_threshold') {
            const key = mission.counter;
            const stacks = key ? (character?.passiveState?.counters?.[key] || 0) : 0;

            desired.push({
                key: `mission:${key || 'stacks'}`,
                className: 'effect-indicator stack-counter',
                text: String(stacks),
                title: `${passive?.name || 'Stacks'}: ${stacks}`,
                shadeDeg: null,
                onClick: null
            });
        }

        const heatStacks = character?.passiveState?.counters?.heat || 0;
        if (!hasHeatBadge && heatStacks > 0) {
            desired.push({
                key: 'heat',
                className: 'effect-indicator stack-counter stack-counter-heat',
                text: String(heatStacks),
                title: `Heat: ${heatStacks}`,
                shadeDeg: null,
                onClick: null
            });
        }

        const groups = new Map();
        for (const effect of (effects || [])) {
            if (!effect || !effect.type) continue;

            try {
                if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                    const res = window.BattleHooks.emit('ui:effect_indicators:filter_effect', {
                        battlePage: this,
                        playerRole,
                        character,
                        effect
                    });
                    if (Array.isArray(res) && res.some(x => x === false)) {
                        continue;
                    }
                }
            } catch (e) {}

            // Stack identical effects into one indicator.
            // For stat-based buffs/debuffs, include stat in the grouping key so different stats don't merge.
            // For restrictions, include the restriction key so different restrictions never merge.
            const statKey = effect.stat ? String(effect.stat) : '';
            const restrictionKey = (effect.type === 'restriction' && effect.key) ? String(effect.key) : '';
            const duration = Number(effect.duration) || Number(effect.turnsLeft) || 1;
            const turnsLeft = (effect.turnsLeft === undefined || effect.turnsLeft === null)
                ? null
                : (Number(effect.turnsLeft) || 0);

            // Only stack if remaining duration matches (or both are timeless / no turnsLeft).
            const durationKey = (turnsLeft === null) ? 'perm' : String(turnsLeft);
            const key = `${effect.type}:${statKey}:${restrictionKey}:${durationKey}`;

            const displayTurnsLeft = (turnsLeft === null) ? duration : turnsLeft;

            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    type: effect.type,
                    stat: effect.stat,
                    count: 1,
                    duration,
                    turnsLeft: displayTurnsLeft,
                    effect,
                    effects: [effect],
                    totalValue: (effect.type === 'buff' || effect.type === 'debuff') && typeof effect.value === 'number'
                        ? Number(effect.value) || 0
                        : null
                });
            } else {
                const g = groups.get(key);
                g.count += 1;
                g.duration = Math.max(g.duration, duration);
                g.turnsLeft = Math.max(g.turnsLeft, displayTurnsLeft);
                if (Array.isArray(g.effects)) {
                    g.effects.push(effect);
                }
                if (g.totalValue !== null && (effect.type === 'buff' || effect.type === 'debuff')) {
                    g.totalValue += (Number(effect.value) || 0);
                }
            }
        }

        // Add effect indicators (stacked)
        for (const g of groups.values()) {
            const explicitStacks = (g.effect && (g.effect._stackCount !== undefined && g.effect._stackCount !== null))
                ? Math.max(0, Math.floor(Number(g.effect._stackCount) || 0))
                : ((g.effect && typeof g.effect.stacks === 'number')
                    ? Math.max(0, Math.floor(Number(g.effect.stacks) || 0))
                    : null);

            let displayText = (explicitStacks !== null && explicitStacks > 0)
                ? String(explicitStacks)
                : (g.count > 1 ? String(g.count) : '');

            try {
                if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                    const res = window.BattleHooks.emit('ui:effect_indicators:display_text', {
                        battlePage: this,
                        playerRole,
                        character,
                        group: g,
                        explicitStacks,
                        displayText
                    });
                    for (const r of (res || [])) {
                        if (typeof r === 'string') {
                            displayText = r;
                        }
                    }
                }
            } catch (e) {}

            const ratio = g.duration > 0 ? Math.max(0, Math.min(1, g.turnsLeft / g.duration)) : 1;
            const elapsed = 1 - ratio;
            const shadeDeg = Math.round(elapsed * 360);

            const statKey = g.effect && g.effect.stat ? String(g.effect.stat) : '';
            const totalValue = (typeof g.totalValue === 'number') ? g.totalValue : null;
            let title = `${g.effect.name}: ${g.effect.description}`;
            if (totalValue !== null && statKey) {
                const statLabel = statKey === 'attack' ? 'ATK' : (statKey === 'defense' ? 'DEF' : statKey.toUpperCase());
                const sum = Math.round(totalValue);
                const sign = sum > 0 ? '+' : '';
                title = `${g.effect.name}: ${sign}${sum} ${statLabel}`;
            }

            desired.push({
                key: `effect:${g.key}`,
                className: `effect-indicator ${g.type}`,
                text: displayText,
                title,
                shadeDeg,
                onClick: (e) => this.showEffectTooltip(e, g)
            });
        }

        const nextKeys = new Set(desired.map(d => d.key));
        for (const [key, el] of existingByKey.entries()) {
            if (!nextKeys.has(key) && el && el.parentNode === container) {
                try {
                    el.remove();
                } catch (e) {
                    try {
                        container.removeChild(el);
                    } catch (e2) {}
                }
            }
        }

        const orderedEls = [];
        for (const d of desired) {
            let el = existingByKey.get(d.key);
            if (!el) {
                el = document.createElement('div');
                el.dataset.effectKey = d.key;
            }

            el.className = d.className;
            el.textContent = d.text || '';
            el.title = d.title || '';
            if (typeof d.shadeDeg === 'number') {
                el.style.setProperty('--shade', `${d.shadeDeg}deg`);
            } else {
                el.style.removeProperty('--shade');
            }

            if (d.onClick) {
                el.onclick = d.onClick;
            } else {
                el.onclick = null;
            }

            orderedEls.push(el);
        }

        for (const el of orderedEls) {
            if (el.parentNode !== container) {
                container.appendChild(el);
            } else {
                container.appendChild(el);
            }
        }
    }

    showEffectTooltip(event, effectOrGroup) {
        // Remove existing tooltip
        const existingTooltip = document.querySelector('.effect-tooltip');
        if (existingTooltip) {
            existingTooltip.remove();
        }

        const effect = (effectOrGroup && effectOrGroup.effect) ? effectOrGroup.effect : effectOrGroup;
        const group = (effectOrGroup && effectOrGroup.effect) ? effectOrGroup : null;

        let name = effect?.name;
        let description = effect?.description;

        if (group && typeof group.totalValue === 'number' && effect && effect.stat) {
            const statKey = String(effect.stat);
            const statLabel = statKey === 'attack' ? 'ATK' : (statKey === 'defense' ? 'DEF' : statKey.toUpperCase());
            const sum = Math.round(group.totalValue);
            const sign = sum > 0 ? '+' : '';
            name = effect.name;
            description = `${sign}${sum} ${statLabel}`;
        }

        // Create new tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'effect-tooltip';
        tooltip.innerHTML = `
            <div class="effect-name">${name}</div>
            <div class="effect-description">${description}</div>
            <div class="effect-duration">Turns left: ${effect.turnsLeft}</div>
        `;

        // Position tooltip
        tooltip.style.left = event.pageX + 10 + 'px';
        tooltip.style.top = event.pageY - 10 + 'px';

        document.body.appendChild(tooltip);

        // Remove tooltip after 3 seconds or on next click
        setTimeout(() => tooltip.remove(), 3000);
        document.addEventListener('click', () => tooltip.remove(), { once: true });
    }

    addLogMessage(message) {
        let logContent = this.querySelector('#log-content');
        if (!logContent) {
            // Fallback: if the page container isn't wired yet (or was cleaned up), try the document.
            logContent = document.querySelector('#log-content');
        }
        if (!logContent) {
            if (this.isRendered) {
                console.warn('Battle log content element not found');
            }
            return;
        }
        
        const messageElement = document.createElement('div');
        messageElement.className = 'log-message';
        messageElement.textContent = `${new Date().toLocaleTimeString()}: ${message}`;
        
        logContent.appendChild(messageElement);
        logContent.scrollTop = logContent.scrollHeight;
    }

    updateStatDisplays() {
        if (!this.statDisplay || !this.gameState || !this.gameState.skillSystem) return;

        const shouldHideOpponentInfo = (() => {
            try {
                const playerId = this.gameState.playerId;
                for (const [, eff] of this.gameState.skillSystem.activeEffects.entries()) {
                    if (!eff) continue;
                    if (eff.type !== 'restriction') continue;
                    if (eff.target !== playerId) continue;
                    if (eff.key !== 'restriction_blindness') continue;
                    if ((Number(eff.turnsLeft) || 0) <= 0) continue;
                    return true;
                }
            } catch (e) {}
            return false;
        })();

        // Update player stats
        const playerStatsContainer = this.querySelector('#player-stats');
        if (playerStatsContainer) {
            this.statDisplay.updatePlayerStats(
                this.gameState.playerId, 
                this.gameState.player.character, 
                playerStatsContainer
            );
        }

        // Update opponent stats (if visible)
        const opponentStatsContainer = this.querySelector('#opponent-stats');
        if (opponentStatsContainer && !shouldHideOpponentInfo) {
            const opponentId = this.gameState.playerId === 'player1' ? 'player2' : 'player1';
            this.statDisplay.updatePlayerStats(
                opponentId, 
                this.gameState.opponent.character, 
                opponentStatsContainer
            );
        }
    }

    showPlayerTooltip(event) {
        if (!this.characterTooltip || !this.gameState) return;
        
        this.characterTooltip.showTooltip(
            this.gameState.player.character,
            this.gameState.playerId,
            event
        );
    }

    showOpponentTooltip(event) {
        if (!this.characterTooltip || !this.gameState) return;
        
        const opponentId = this.gameState.playerId === 'player1' ? 'player2' : 'player1';
        this.characterTooltip.showTooltip(
            this.gameState.opponent.character,
            opponentId,
            event
        );
    }

    async cleanup() {
        if (this.spriteAnimation.intervalId) {
            clearInterval(this.spriteAnimation.intervalId);
            this.spriteAnimation.intervalId = null;
        }

        this.gameCoordinator = null;
        this.gameState = null;
        this.statDisplay = null;
        
        if (this.characterTooltip) {
            this.characterTooltip.destroy();
            this.characterTooltip = null;
        }
        
        await super.cleanup();
    }
}
