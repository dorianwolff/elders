(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function getOpponentId(playerId) {
        return playerId === 'player1' ? 'player2' : (playerId === 'player2' ? 'player1' : null);
    }

    function getPermafrostEffect(skillSystem, targetId) {
        try {
            for (const [, eff] of skillSystem.activeEffects.entries()) {
                if (!eff) continue;
                if (eff.target !== targetId) continue;
                if (eff.type !== 'red_debuff') continue;
                if (eff.key !== 'permafrost') continue;
                return eff;
            }
        } catch (e) {}
        return null;
    }

    function getPermafrostStacks(skillSystem, targetId) {
        const eff = getPermafrostEffect(skillSystem, targetId);
        if (!eff) return 0;
        return Math.max(0, Math.floor(Number(eff._stackCount ?? eff.stacks ?? 0) || 0));
    }

    function setPermafrostStacks(skillSystem, targetId, ownerId, nextStacks) {
        const stacks = Math.max(0, Math.floor(Number(nextStacks) || 0));
        const existing = getPermafrostEffect(skillSystem, targetId);

        if (existing) {
            existing._stackCount = stacks;
            existing.stacks = stacks;
            existing.name = 'Permafrost';
            existing.description = `Takes ${stacks} true damage at the end of your turn.`;
            return;
        }

        const id = `permafrost_${targetId}_${Date.now()}`;
        skillSystem.activeEffects.set(id, {
            type: 'red_debuff',
            key: 'permafrost',
            target: targetId,
            ownerId,
            _clientOnly: true,
            duration: null,
            turnsLeft: null,
            name: 'Permafrost',
            description: `Takes ${stacks} true damage at the end of your turn.`,
            _stackCount: stacks,
            stacks
        });
    }

    function removePermafrostStacks(skillSystem, targetId, amount) {
        const existing = getPermafrostEffect(skillSystem, targetId);
        if (!existing) return;
        const cur = Math.max(0, Math.floor(Number(existing._stackCount ?? existing.stacks ?? 0) || 0));
        const next = Math.max(0, cur - Math.max(0, Math.floor(Number(amount) || 0)));
        existing._stackCount = next;
        existing.stacks = next;
        existing.description = `Takes ${next} true damage at the end of your turn.`;

        if (next <= 0) {
            try {
                for (const [id, eff] of skillSystem.activeEffects.entries()) {
                    if (eff === existing) {
                        skillSystem.activeEffects.delete(id);
                        break;
                    }
                }
            } catch (e) {}
        }
    }

    function getFreezeEffect(skillSystem, targetId) {
        try {
            for (const [, eff] of skillSystem.activeEffects.entries()) {
                if (!eff) continue;
                if (eff.target !== targetId) continue;
                if (eff.type !== 'red_debuff') continue;
                if (eff.key !== 'freeze') continue;
                if ((Number(eff.turnsLeft) || 0) <= 0) continue;
                return eff;
            }
        } catch (e) {}
        return null;
    }

    function isFrozen(skillSystem, targetId) {
        return Boolean(getFreezeEffect(skillSystem, targetId));
    }

    function ensureFrozenQueenStack(skillSystem, ownerId) {
        try {
            const seq = (skillSystem && typeof skillSystem._effectIdSeq === 'number')
                ? (skillSystem._effectIdSeq = skillSystem._effectIdSeq + 1)
                : 1;
            if (skillSystem && typeof skillSystem._effectIdSeq !== 'number') {
                skillSystem._effectIdSeq = seq;
            }

            const id = `frozen_queen_${ownerId}_${Date.now()}_${seq}`;
            skillSystem.activeEffects.set(id, {
                type: 'restriction',
                key: 'frozen_queen',
                target: ownerId,
                ownerId,
                _clientOnly: true,
                duration: null,
                turnsLeft: null,
                name: 'Frozen Empress',
                description: '+40% attack skill multiplier to frozen enemies per stack.'
            });

            try {
                if (skillSystem && typeof skillSystem.emitCombatText === 'function') {
                    skillSystem.emitCombatText('effect', 'Frozen Empress', ownerId);
                }
            } catch (e) {}
        } catch (e) {}
    }

    function getFrozenQueenStacks(skillSystem, ownerId) {
        try {
            let n = 0;
            for (const [, eff] of skillSystem.activeEffects.entries()) {
                if (!eff) continue;
                if (eff.type !== 'restriction') continue;
                if (eff.key !== 'frozen_queen') continue;
                if (eff.target !== ownerId) continue;
                n += 1;
            }
            return n;
        } catch (e) {}
        return 0;
    }

    function grantFrozenEmpressStack(skillSystem, ownerId) {
        if (ownerId !== 'player1' && ownerId !== 'player2') return;
        ensureFrozenQueenStack(skillSystem, ownerId);
    }

    function applyFreeze(skillSystem, targetId, ownerId, durationTurns) {
        const turns = Math.max(1, Math.floor(Number(durationTurns) || 1));

        const resolvedOwnerId = (ownerId === 'player1' || ownerId === 'player2')
            ? ownerId
            : (() => {
                try {
                    const ctx = (skillSystem && typeof skillSystem.getActiveActionContext === 'function')
                        ? skillSystem.getActiveActionContext()
                        : null;
                    const attacker = ctx && (ctx.attackerId === 'player1' || ctx.attackerId === 'player2')
                        ? ctx.attackerId
                        : null;
                    if (attacker) return attacker;
                } catch (e) {}
                try {
                    const cur = skillSystem?.gameState?.currentTurn;
                    if (cur === 'player1' || cur === 'player2') return cur;
                } catch (e) {}
                return null;
            })();

        // Replace older freeze (no double freeze).
        try {
            for (const [id, eff] of skillSystem.activeEffects.entries()) {
                if (!eff) continue;
                if (eff.target !== targetId) continue;
                if (eff.type !== 'red_debuff') continue;
                if (eff.key !== 'freeze') continue;
                skillSystem.activeEffects.delete(id);
            }
        } catch (e) {}

        const id = `freeze_${targetId}_${Date.now()}`;
        skillSystem.activeEffects.set(id, {
            type: 'red_debuff',
            key: 'freeze',
            target: targetId,
            ownerId: resolvedOwnerId,
            _clientOnly: true,
            duration: turns,
            turnsLeft: turns,
            name: 'Frozen',
            description: `Cannot act for ${turns} turns. Breaks when taking skill damage.`
        });
    }

    window.EmiliaCharacter = window.EmiliaCharacter || {};
    window.EmiliaCharacter = {
        getPermafrostStacks,
        setPermafrostStacks,
        removePermafrostStacks,
        applyFreeze,
        isFrozen,
        getFrozenQueenStacks,
        grantFrozenEmpressStack
    };

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
            if (!character || character.id !== 'emilia') return;

            // Each time opponent deals damage with a skill, they gain 1 Permafrost.
            if (eventType === 'damage_taken_enemy_action') {
                const attackerId = payload && (payload.attackerId === 'player1' || payload.attackerId === 'player2') ? payload.attackerId : null;
                if (!attackerId) return;
                const cur = getPermafrostStacks(skillSystem, attackerId);
                setPermafrostStacks(skillSystem, attackerId, playerId, cur + 1);
                return;
            }

            // At the start of Emilia's turn: if enemy has >=10 Permafrost, consume 10 and Freeze for 2.

            if (eventType === 'turn_start') {
                const active = gameState && typeof gameState.currentTurn === 'string' ? gameState.currentTurn : null;
                if (!active || active !== playerId) return;

                const oppId = getOpponentId(playerId);
                if (!oppId) return;

                const stacks = getPermafrostStacks(skillSystem, oppId);
                if (stacks >= 10) {
                    removePermafrostStacks(skillSystem, oppId, 10);
                    applyFreeze(skillSystem, oppId, playerId, 2);
                    grantFrozenEmpressStack(skillSystem, playerId);
                }
                return;
            }

        } catch (e) {}
    }, { id: 'passive:emilia', order: 0 });
})();
