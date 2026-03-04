(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    window.BattleHooks.register('skill_system:cooldown_reduced', (ctx) => {
        try {
            const skillSystem = ctx && ctx.skillSystem;
            const character = ctx && ctx.character;
            const playerId = ctx && ctx.playerId;
            if (!skillSystem || typeof skillSystem.applyChenSwordStackIfAny !== 'function') return;
            if (!character || character.itemId !== 'chen_sword') return;
            skillSystem.applyChenSwordStackIfAny(playerId, character);
        } catch (e) {}
    }, { id: 'item:chen_sword_cd_mastery', order: 0 });
})();
