(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function ensureCapApplied(character) {
        if (!character || !character.passiveState) return false;
        if (character.passiveState._lawCapApplied) return false;
        character.passiveState._lawCapApplied = true;
        return true;
    }

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            const passiveSystem = ctx && ctx.passiveSystem;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;

            if (!passiveSystem) return;
            if (!character || character.id !== 'trafalgar_law') return;
            if (character.itemId !== 'trafalgar_law_cap') return;

            // Apply once when the battle starts flowing.
            if (eventType !== 'turn_start' && eventType !== 'opponent_skill_used') return;
            if (!ensureCapApplied(character)) return;

            // Override execute threshold for Shambles from 10% to 20%.
            if (character.ultimate && character.ultimate.effect && typeof character.ultimate.effect === 'object') {
                if (character.ultimate.effect.type === 'swap_health_and_execute') {
                    character.ultimate.effect.execute_threshold = 0.2;
                }
            }

            // Keep the description consistent in battle.
            if (typeof character?.ultimate?.description === 'string') {
                character.ultimate.description = 'Swap health with enemy. If the enemy is at 20% health or less after the swap, execute them.';
            }

            // If the UI reads from passiveSystem's readiness, keep it fresh.
            if (typeof passiveSystem.updateUltimateReady === 'function') {
                passiveSystem.updateUltimateReady(playerId);
            }
        } catch (e) {}
    }, { id: 'item:trafalgar_law_cap', order: -10 });
})();
