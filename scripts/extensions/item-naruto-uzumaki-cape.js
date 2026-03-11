(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function isNarutoLike(character) {
        const id = character && character.id;
        return id === 'naruto' || id === 'naruto_sage';
    }

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;
            const payload = ctx && ctx.payload;

            if (!skillSystem) return;
            if (!character || character.itemId !== 'naruto_uzumaki_cape') return;
            if (!isNarutoLike(character)) return;

            if (eventType !== 'skill_used') return;
            if (!payload || payload.skillType !== 'ultimate') return;

            if (typeof skillSystem.applyShield === 'function') {
                await skillSystem.applyShield(character, 10, playerId);
            }
            if (typeof skillSystem.applyHealing === 'function') {
                await skillSystem.applyHealing(character, 10, playerId);
            }
        } catch (e) {}
    }, { id: 'item:naruto_uzumaki_cape', order: 0 });
})();
