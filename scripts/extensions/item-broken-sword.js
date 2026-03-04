(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    window.BattleHooks.register('passive_system:event', (ctx) => {
        try {
            const passiveSystem = ctx && ctx.passiveSystem;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;

            if (!passiveSystem || !gameState) return;
            if (!character || character.itemId !== 'broken_sword') return;

            const state = passiveSystem.ensureState(character);

            const ensureBrokenSwordStartBonus = () => {
                if (state._brokenSwordApplied) return;
                state._brokenSwordApplied = true;
                state._brokenSwordLost = 0;
                state._brokenSwordAppliedTurnCount = Number(gameState?.turnCount) || 0;
                passiveSystem.applyPermanentStatDelta(playerId, { attack: 5 });
            };

            if (eventType === 'turn_start') {
                ensureBrokenSwordStartBonus();

                const nowTurn = Number(gameState?.turnCount) || 0;
                const appliedTurn = (state._brokenSwordAppliedTurnCount !== undefined && state._brokenSwordAppliedTurnCount !== null)
                    ? (Number(state._brokenSwordAppliedTurnCount) || 0)
                    : null;

                if (appliedTurn !== null && nowTurn === appliedTurn) {
                    return;
                }

                const lost = Math.max(0, Math.floor(Number(state._brokenSwordLost) || 0));
                if (lost < 5) {
                    state._brokenSwordLost = lost + 1;
                    passiveSystem.applyPermanentStatDelta(playerId, { attack: -1 });
                }
            }
        } catch (e) {}
    }, { id: 'item:broken_sword', order: 0 });
})();
