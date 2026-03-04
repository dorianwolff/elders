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
            if (!character || character.itemId !== 'pillow') return;
            if (eventType !== 'skill_used') return;

            const isUtility = payload && payload.skillType === 'utility';
            if (!isUtility) return;
            if (typeof skillSystem.applyStun !== 'function') return;

            const opponentId = playerId === 'player1' ? 'player2' : (playerId === 'player2' ? 'player1' : null);
            const opponentChar = opponentId ? gameState?.players?.get(opponentId)?.character : null;
            if (!opponentId || !opponentChar) return;

            const state = passiveSystem.ensureState(character);
            state._pillowProcSeq = (Number(state._pillowProcSeq) || 0) + 1;

            const skillId = payload && payload.skillId ? String(payload.skillId) : 'unknown';
            const seed = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:pillow:${skillId}:${state._pillowProcSeq}`;
            const rand = typeof skillSystem.deterministicRandom === 'function'
                ? skillSystem.deterministicRandom(seed)
                : Math.random();

            if (rand < 0.1) {
                await skillSystem.applyStun(opponentChar, 1, opponentId);
            }
        } catch (e) {}
    }, { id: 'item:pillow', order: 0 });
})();
