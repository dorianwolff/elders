(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            const passiveSystem = ctx && ctx.passiveSystem;
            const skillSystem = ctx && ctx.skillSystem;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;
            const payload = ctx && ctx.payload;

            if (!passiveSystem || !skillSystem || !gameState) return;
            if (!character || character.itemId !== 'zero_two_suit') return;

            const state = passiveSystem.ensureState(character);
            const turnCount = Number(gameState?.turnCount);

            if (eventType === 'opponent_skill_used') {
                const isUlt = payload && payload.skillType === 'ultimate';
                if (isUlt && Number.isFinite(turnCount)) {
                    state._zeroTwoSuitOppUltTurnCount = turnCount;
                }
                return;
            }

            if (eventType !== 'turn_start') return;

            const active = gameState && (gameState.currentTurn === 'player1' || gameState.currentTurn === 'player2')
                ? gameState.currentTurn
                : null;
            if (!active || playerId !== active) return;

            if (Number.isFinite(turnCount) && Number(state._zeroTwoSuitLastProcTurnCount) === turnCount) {
                return;
            }
            if (Number.isFinite(turnCount)) {
                state._zeroTwoSuitLastProcTurnCount = turnCount;
            }

            const opponentId = playerId === 'player1' ? 'player2' : (playerId === 'player2' ? 'player1' : null);
            const opponentChar = opponentId ? gameState?.players?.get(opponentId)?.character : null;
            if (!opponentId || !opponentChar) return;

            const opponentUsedUltLastTurn = Number.isFinite(turnCount) && (Number(state._zeroTwoSuitOppUltTurnCount) === (turnCount - 1));
            const hbGain = 3 + (opponentUsedUltLastTurn ? 3 : 0);
            const healEnemy = 3;

            if ((Number(character?.stats?.health) || 0) > 0) {
                const before = Math.max(0, Math.floor(Number(state.counters?.heartbreak) || 0));
                const maxHb = 100;
                const after = passiveSystem.addCounter(character, 'heartbreak', hbGain, 0, maxHb);
                const gained = Math.max(0, Math.floor(Number(after) || 0) - before);
                if (gained > 0 && character && character.id === 'zero_two') {
                    passiveSystem.applyPermanentStatDelta(playerId, { maxHealth: gained, currentHealth: gained });
                }
                passiveSystem.updateUltimateReady(playerId);
            }

            if (typeof skillSystem.applyHealing === 'function') {
                await skillSystem.applyHealing(opponentChar, healEnemy, opponentId);
            }
        } catch (e) {}
    }, { id: 'item:zero_two_suit', order: 0 });
})();
