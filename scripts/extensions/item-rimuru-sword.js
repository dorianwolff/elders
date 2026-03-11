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
            if (!character || character.itemId !== 'rimuru_sword') return;
            if (eventType !== 'skill_used') return;

            const opponentId = playerId === 'player1' ? 'player2' : (playerId === 'player2' ? 'player1' : null);
            const opponentChar = opponentId ? gameState?.players?.get(opponentId)?.character : null;
            if (!opponentId || !opponentChar) return;

            if (typeof skillSystem.applyTrueDamage !== 'function') return;
            await skillSystem.applyTrueDamage(opponentChar, 1, opponentId, playerId);
        } catch (e) {}
    }, { id: 'item:rimuru_sword', order: 0 });
})();
