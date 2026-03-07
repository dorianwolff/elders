(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function isEmilia(character) {
        return Boolean(character && character.id === 'emilia');
    }

    function deepClone(x) {
        try {
            return JSON.parse(JSON.stringify(x));
        } catch (e) {
            return null;
        }
    }

    function getPlayerCooldownSnapshot(skillSystem, playerId) {
        const out = [];
        if (!skillSystem || !skillSystem.skillCooldowns || typeof skillSystem.skillCooldowns.entries !== 'function') return out;
        const prefix = `${playerId}:`;
        for (const [k, v] of skillSystem.skillCooldowns.entries()) {
            if (typeof k !== 'string' || !k.startsWith(prefix)) continue;
            out.push([k, v]);
        }
        return out;
    }

    function restorePlayerCooldownSnapshot(skillSystem, playerId, snapshotPairs) {
        if (!skillSystem || !skillSystem.skillCooldowns) return;
        const prefix = `${playerId}:`;

        for (const k of Array.from(skillSystem.skillCooldowns.keys())) {
            if (typeof k === 'string' && k.startsWith(prefix)) {
                skillSystem.skillCooldowns.delete(k);
            }
        }
        for (const [k, v] of (snapshotPairs || [])) {
            skillSystem.skillCooldowns.set(k, v);
        }
    }

    function getPlayerEffectsSnapshot(skillSystem, playerId) {
        const out = [];
        if (!skillSystem || !skillSystem.activeEffects || typeof skillSystem.activeEffects.entries !== 'function') return out;
        for (const [eid, eff] of skillSystem.activeEffects.entries()) {
            if (!eff) continue;
            if (eff.target !== playerId) continue;
            out.push([eid, deepClone(eff)]);
        }
        return out;
    }

    function restorePlayerEffectsSnapshot(skillSystem, playerId, snapshotPairs) {
        if (!skillSystem || !skillSystem.activeEffects) return;

        for (const [eid, eff] of Array.from(skillSystem.activeEffects.entries())) {
            if (!eff) continue;
            if (eff.target !== playerId) continue;
            skillSystem.activeEffects.delete(eid);
        }

        for (const [eid, eff] of (snapshotPairs || [])) {
            if (!eff) continue;
            const nid = `rewind_${eid}_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
            skillSystem.activeEffects.set(nid, eff);
        }
    }

    function ensureEmiliaRewindState(passiveSystem, character) {
        const state = passiveSystem.ensureState(character);
        if (!state.counters) state.counters = {};
        if (!Array.isArray(state.emiliaRewindSnapshots)) state.emiliaRewindSnapshots = [];
        if (state.emiliaRewindUsed === undefined) state.emiliaRewindUsed = false;
        return state;
    }

    function snapshotAtTurnStart(passiveSystem, skillSystem, gameState, playerId, character) {
        const state = ensureEmiliaRewindState(passiveSystem, character);
        const snap = {
            turnCount: Number(gameState?.turnCount) || 0,
            health: Number(character?.stats?.health) || 0,
            passiveState: (function () {
                const cloned = deepClone(character?.passiveState) || {};
                cloned.emiliaRewindSnapshots = undefined;
                cloned.emiliaRewindUsed = undefined;
                return cloned;
            })(),
            cooldowns: getPlayerCooldownSnapshot(skillSystem, playerId),
            effects: getPlayerEffectsSnapshot(skillSystem, playerId)
        };

        state.emiliaRewindSnapshots.unshift(snap);
        if (state.emiliaRewindSnapshots.length > 2) {
            state.emiliaRewindSnapshots.length = 2;
        }
    }

    function applyRewindSnapshot(passiveSystem, skillSystem, gameState, playerId, character, snapshot, deltaTurns) {
        const state = ensureEmiliaRewindState(passiveSystem, character);

        state.emiliaRewindUsed = true;

        // Cancel the pending endTurn() that would normally follow the action that killed Emilia.
        // This guarantees that after rewinding, it is immediately Emilia's turn to act.
        try {
            if (gameState) {
                gameState._emiliaRewindSkipNextEndTurn = true;
            }
        } catch (e) {}

        try {
            character.stats.health = Math.max(1, Math.floor(Number(snapshot.health) || 1));
        } catch (e) {}

        try {
            const restoredPassive = deepClone(snapshot.passiveState) || {};
            restoredPassive.emiliaRewindUsed = true;
            restoredPassive.emiliaRewindSnapshots = state.emiliaRewindSnapshots;
            character.passiveState = restoredPassive;
        } catch (e) {}

        try {
            restorePlayerCooldownSnapshot(skillSystem, playerId, snapshot.cooldowns);
        } catch (e) {}

        try {
            restorePlayerEffectsSnapshot(skillSystem, playerId, snapshot.effects);
        } catch (e) {}

        try {
            if (gameState) {
                gameState.currentTurn = playerId;
                if (typeof deltaTurns === 'number') {
                    gameState.turnCount = Math.max(0, (Number(gameState.turnCount) || 0) - Math.max(0, deltaTurns));
                } else if (snapshot.turnCount !== undefined) {
                    gameState.turnCount = Math.max(0, Math.floor(Number(snapshot.turnCount) || 0));
                }
            }
        } catch (e) {}

        try {
            if (skillSystem && typeof skillSystem.recalculateStats === 'function') {
                skillSystem.recalculateStats(playerId);
            }
        } catch (e) {}

        try {
            if (skillSystem && typeof skillSystem.emitCombatText === 'function') {
                skillSystem.emitCombatText('buff', 'Rewind', playerId);
            }
        } catch (e) {}
    }

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            const passiveSystem = ctx && ctx.passiveSystem;
            const skillSystem = ctx && ctx.skillSystem;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;

            if (!passiveSystem || !skillSystem || !gameState) return;
            if (!isEmilia(character)) return;
            if (playerId !== 'player1' && playerId !== 'player2') return;

            if (eventType === 'turn_start') {
                snapshotAtTurnStart(passiveSystem, skillSystem, gameState, playerId, character);
            }
        } catch (e) {}
    }, { id: 'character:emilia:rewind:snapshot', order: -50 });

    window.BattleHooks.register('skill_system:handle_character_death', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const passiveSystem = ctx && ctx.passiveSystem;
            const gameState = ctx && ctx.gameState;
            const character = ctx && ctx.character;
            const playerId = ctx && ctx.playerId;

            if (!skillSystem || !passiveSystem || !gameState) return;
            if (!isEmilia(character)) return;
            if (playerId !== 'player1' && playerId !== 'player2') return;

            const state = ensureEmiliaRewindState(passiveSystem, character);
            if (state.emiliaRewindUsed) return;

            const dyingOnOwnTurn = gameState.currentTurn === playerId;
            const deltaTurns = dyingOnOwnTurn ? 2 : 1;
            const snapIndex = dyingOnOwnTurn ? 1 : 0;
            const snapshot = state.emiliaRewindSnapshots && state.emiliaRewindSnapshots[snapIndex];
            if (!snapshot) return;

            applyRewindSnapshot(passiveSystem, skillSystem, gameState, playerId, character, snapshot, deltaTurns);

            return { handled: true, revived: true };
        } catch (e) {}
    }, { id: 'character:emilia:rewind:death', order: -50 });
})();
