(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;
            const payload = ctx && ctx.payload;

            if (!skillSystem) return;
            if (!character || character.itemId !== 'gojo_satoru_glasses') return;
            if (eventType !== 'opponent_healing_done') return;

            const amount = Math.max(0, Math.floor(Number(payload?.amount) || 0));
            const targetId = typeof payload?.targetId === 'string' ? payload.targetId : null;

            if (amount > 0 && targetId && targetId !== playerId && typeof skillSystem.applyBuff === 'function') {
                await skillSystem.applyBuff(character, {
                    stat: 'attack',
                    mode: 'flat',
                    value: amount,
                    duration: 1
                }, playerId);
            }
        } catch (e) {}
    }, { id: 'item:gojo_satoru_glasses', order: 0 });
})();
