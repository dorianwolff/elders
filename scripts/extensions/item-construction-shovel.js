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

            if (!passiveSystem || !skillSystem || !gameState) return;
            if (!character || character.itemId !== 'construction_shovel') return;
            if (eventType !== 'damage_taken') return;
            if (typeof skillSystem.applyBuff !== 'function') return;

            await skillSystem.applyBuff(character, {
                stat: 'attack',
                mode: 'flat',
                value: 1,
                duration: 2
            }, playerId);

            try {
                const effects = skillSystem.activeEffects;
                if (effects && typeof effects.entries === 'function') {
                    const ids = [];
                    for (const [id, eff] of effects.entries()) {
                        if (!eff) continue;
                        if (eff.type !== 'buff') continue;
                        if (eff.target !== playerId) continue;
                        if (eff.stat !== 'attack') continue;
                        if (eff.mode !== 'flat') continue;
                        if (eff.value !== 1) continue;
                        if ((Number(eff.turnsLeft) || 0) !== 2) continue;
                        if (eff._itemPassiveId) continue;
                        ids.push(id);
                    }
                    if (ids.length > 0) {
                        const last = ids[ids.length - 1];
                        const eff = effects.get(last);
                        if (eff) {
                            eff._itemPassiveId = 'construction_shovel_rallying_grit';
                            eff.name = 'Rallying Grit';
                            eff.description = '+1 ATK for 2 turns';
                        }
                    }
                }
            } catch (e) {}
        } catch (e) {}
    }, { id: 'item:construction_shovel', order: 0 });
})();
