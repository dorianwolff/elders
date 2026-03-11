GameState.prototype.useSkill = async function (playerId, skillIndex) {
    if (this.currentTurn !== playerId || this.gamePhase !== 'active') {
        throw new Error('Not your turn or game not active');
    }

    const resolveKaitoTacticsRedirect = (requestedType, requestedSkillIndex = null) => {
        try {
            const player = this.players.get(playerId);
            const opponent = this.players.get(playerId === 'player1' ? 'player2' : 'player1');
            if (!player || !opponent) return { actionType: requestedType, skillIndex: requestedSkillIndex };
            const character = player.character;
            if (!character || character.id !== 'kaito') return { actionType: requestedType, skillIndex: requestedSkillIndex };

            const hasRestriction = (() => {
                try {
                    for (const [, eff] of this.skillSystem.activeEffects.entries()) {
                        if (!eff) continue;
                        if (eff.type !== 'restriction') continue;
                        if (eff.target !== playerId) continue;
                        if (eff.key !== 'restriction_tactics') continue;
                        if ((Number(eff.turnsLeft) || 0) <= 0) continue;
                        return true;
                    }
                } catch (e) {}
                return false;
            })();
            if (!hasRestriction) return { actionType: requestedType, skillIndex: requestedSkillIndex };

            const skills = Array.isArray(character.skills) ? character.skills : [];

            const isSkillUsable = (s) => {
                if (!s || !s.id) return false;
                if (!this.skillSystem || typeof this.skillSystem.canUseSkill !== 'function') return false;
                if (!this.skillSystem.canUseSkill(s, playerId)) return false;
                try {
                    const state = character?.passiveState;
                    if (s.id === 'kaito_crazy_slots' && state && state.kaitoWeaponKey) return false;
                    if (s.id === 'kaito_price_of_power') {
                        const r = (window.KaitoCharacter && typeof window.KaitoCharacter.getActiveKaitoRestrictions === 'function')
                            ? window.KaitoCharacter.getActiveKaitoRestrictions(this.skillSystem, playerId).size
                            : 0;
                        if (r >= 5) return false;
                    }
                } catch (e) {}
                try {
                    if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                        const res = window.BattleHooks.emit('skill_system:can_use_skill', {
                            gameState: this,
                            skillSystem: this.skillSystem,
                            passiveSystem: this.passiveSystem,
                            playerId,
                            skill: s,
                            caster: character,
                            override: {}
                        });
                        for (const r of (res || [])) {
                            if (r === false) return false;
                        }
                    }
                } catch (e) {}
                return true;
            };

            const isUltimateUsable = () => {
                if (!player.ultimateReady) return false;
                if (typeof this.canUseUltimateWithLimit === 'function') {
                    if (!this.canUseUltimateWithLimit(player)) return false;
                }
                try {
                    if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                        const res = window.BattleHooks.emit('skill_system:can_use_ultimate', {
                            gameState: this,
                            skillSystem: this.skillSystem,
                            passiveSystem: this.passiveSystem,
                            playerId,
                            player,
                            character,
                            ultimate: character?.ultimate
                        });
                        for (const r of (res || [])) {
                            if (r === false) return false;
                        }
                    }
                } catch (e) {
                    return false;
                }
                return true;
            };

            const options = [];
            if (isUltimateUsable()) {
                options.push({ actionType: 'ultimate', skillIndex: null, id: character?.ultimate?.id || 'ultimate' });
            }
            for (let i = 0; i < skills.length; i++) {
                const s = skills[i];
                if (!isSkillUsable(s)) continue;
                options.push({ actionType: 'skill', skillIndex: i, id: s.id });
            }
            if (options.length <= 1) return { actionType: requestedType, skillIndex: requestedSkillIndex };

            const requestedId = requestedType === 'ultimate'
                ? (character?.ultimate?.id || 'ultimate')
                : (skills[requestedSkillIndex]?.id || 'skill');
            const seed = `${this.gameId || 'game'}:${this.turnCount || 0}:${playerId}:kaito:tactics:${requestedType}:${requestedId}:${options.map(o => o.id).join('|')}`;
            const rand = this.skillSystem && typeof this.skillSystem.deterministicRandom === 'function'
                ? this.skillSystem.deterministicRandom(seed)
                : Math.random();
            const idx = Math.min(options.length - 1, Math.max(0, Math.floor(rand * options.length)));
            const picked = options[idx];

            return { actionType: picked.actionType, skillIndex: picked.skillIndex };
        } catch (e) {
            return { actionType: requestedType, skillIndex: requestedSkillIndex };
        }
    };

    const animations = [];
    if (this.skillSystem && typeof this.skillSystem.pushAnimationSink === 'function') {
        this.skillSystem.pushAnimationSink(animations);
    }

    try {

    if (this.skillSystem.isStunned(playerId)) {
        console.log(`${playerId} is stunned and cannot act - skipping turn`);
        await this.endTurn();
        if (this.gamePhase === 'finished') {
            return { damage: 0, healing: 0, effects: ['Turn skipped due to stun'], animations, gameEnded: true, winner: this.winner };
        }
        return { damage: 0, healing: 0, effects: ['Turn skipped due to stun'], animations, gameEnded: false };
    }

    const player = this.players.get(playerId);
    const opponent = this.players.get(playerId === 'player1' ? 'player2' : 'player1');

    if (!player || !opponent) {
        throw new Error('Player not found');
    }

    const redirect = resolveKaitoTacticsRedirect('skill', skillIndex);
    const requestedSkill = player.character.skills[skillIndex];
    if (!requestedSkill) {
        throw new Error('Skill not found');
    }

    this.skillSystem.getPlayerById = (id) => {
        return this.players.get(id)?.character;
    };

    let result;
    if (redirect.actionType === 'ultimate') {
        // Execute ultimate inline to avoid nested turn/animation/cooldown handling.
        if (!player.ultimateReady) {
            throw new Error('Ultimate not ready');
        }

        // Allow extensions to block ultimate usage (e.g., restrictions, seals).
        try {
            if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                const res = window.BattleHooks.emit('skill_system:can_use_ultimate', {
                    gameState: this,
                    skillSystem: this.skillSystem,
                    passiveSystem: this.passiveSystem,
                    playerId,
                    player,
                    character: player.character,
                    ultimate: player.character?.ultimate
                });
                for (const r of (res || [])) {
                    if (r === false) {
                        throw new Error('Ultimate is disabled');
                    }
                }
            }
        } catch (e) {
            if (e && e.message) throw e;
            throw new Error('Ultimate is disabled');
        }

        if (!this.canUseUltimateWithLimit(player)) {
            throw new Error('Ultimate limit reached');
        }

        if (this.passiveSystem && typeof this.passiveSystem.handleEvent === 'function') {
            const ultId = player.character.ultimate && player.character.ultimate.id;
            if (ultId) {
                const ultType = 'ultimate';
                this.passiveSystem.handleEvent(playerId, 'skill_used', { skillId: ultId, skillType: ultType });
                this.passiveSystem.handleEvent(opponent.id, 'opponent_skill_used', { skillId: ultId, skillType: ultType, attackerId: playerId });
            }
        }

        result = await this.skillSystem.withActionContext({
            kind: 'ultimate',
            attackerId: playerId,
            skillId: player.character?.ultimate?.id,
            skillType: 'ultimate',
            isCounter: false
        }, async () => {
            return await this.skillSystem.applySkillEffect(
                player.character.ultimate.effect,
                player.character,
                opponent.character,
                this,
                playerId
            );
        });

        {
            const ultimate = player.character.ultimate;
            const cd = Math.max(0, Math.floor(Number(ultimate?.cooldown) || 0));
            if (cd > 0 && this.skillSystem && typeof this.skillSystem.setSkillCooldown === 'function') {
                // Cooldown N means it is unavailable for the next N of your turns.
                if (typeof this.skillSystem.setSkillCooldownFromUse === 'function') {
                    this.skillSystem.setSkillCooldownFromUse(ultimate.id, playerId, cd);
                } else {
                    this.skillSystem.setSkillCooldown(ultimate.id, playerId, cd);
                }
            }
        }

        {
            const usage = this.ensureUsageState(player.character);
            const id = player.character.ultimate.id;
            usage.ultimateUses[id] = (Number(usage.ultimateUses[id]) || 0) + 1;
        }

        {
            const passive = player.character?.passive;
            const mission = passive && passive.mission ? passive.mission : null;
            const keepReadyAfterUse = Boolean(mission && mission.keepReadyAfterUse === true);
            if (passive?.alwaysUltimateReady || keepReadyAfterUse) {
                // Keep ultimate ready.
            } else {
                player.ultimateReady = false;
                if (player.character?.passiveState) {
                    player.character.passiveState.ultimateReady = false;
                }
            }
        }

        this.resetPassiveProgress(player);

        result._effectiveActionType = 'ultimate';
        result._effectiveSkillIndex = null;
    } else {
        const skill = player.character.skills[redirect.skillIndex];
        result = await this.skillSystem.executeSkill(
            skill,
            player.character,
            opponent.character,
            this,
            playerId
        );
        result._effectiveActionType = 'skill';
        result._effectiveSkillIndex = redirect.skillIndex;
    }

    result.animations = animations;

    if (result && result._effectiveActionType === 'ultimate') {
        this.resetPassiveProgress(player);
    } else {
        const idx = result && Number.isFinite(Number(result._effectiveSkillIndex))
            ? Number(result._effectiveSkillIndex)
            : redirect.skillIndex;
        this.updatePassiveProgress(player, player.character.skills[idx], result);
    }

    if (player.character.stats.health <= 0 && opponent.character.stats.health <= 0) {
        this.gamePhase = 'finished';
        this.winner = 'draw';
        return { ...result, gameEnded: true, winner: 'draw' };
    }

    if (opponent.character.stats.health <= 0) {
        this.gamePhase = 'finished';
        this.winner = playerId;
        return { ...result, gameEnded: true, winner: playerId };
    }

    if (player.character.stats.health <= 0) {
        this.gamePhase = 'finished';
        this.winner = opponent.id;
        return { ...result, gameEnded: true, winner: opponent.id };
    }

    // Emilia rewind: if a death-triggered rewind happened during this action,
    // cancel the normal endTurn so the rewound player (Emilia) can immediately act.
    if (this._emiliaRewindSkipNextEndTurn) {
        this._emiliaRewindSkipNextEndTurn = false;
    } else {
        await this.endTurn();
    }

    if (this.gamePhase === 'finished') {
        const r = { ...result, gameEnded: true, winner: this.winner };
        if (typeof this.buildStateSnapshot === 'function') {
            r.stateSnapshot = this.buildStateSnapshot();
        }
        return r;
    }

    const r = { ...result, gameEnded: false };
    if (typeof this.buildStateSnapshot === 'function') {
        r.stateSnapshot = this.buildStateSnapshot();
    }
    return r;
    } finally {
        if (this.skillSystem && typeof this.skillSystem.popAnimationSink === 'function') {
            this.skillSystem.popAnimationSink();
        }
    }
};

GameState.prototype.surrender = async function (playerId) {
    if (this.gamePhase !== 'active') {
        throw new Error('Game not active');
    }

    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
    this.gamePhase = 'finished';
    this.winner = opponentId;

    return {
        damage: 0,
        healing: 0,
        effects: ['Surrendered'],
        animations: [],
        gameEnded: true,
        winner: opponentId
    };
};

GameState.prototype.skipTurn = async function (playerId) {
    if (this.currentTurn !== playerId || this.gamePhase !== 'active') {
        throw new Error('Not your turn or game not active');
    }

    const animations = [];
    if (this.skillSystem && typeof this.skillSystem.pushAnimationSink === 'function') {
        this.skillSystem.pushAnimationSink(animations);
    }

    try {

    // Emilia rewind: if a death-triggered rewind happened during this action,
    // cancel the normal endTurn so the rewound player (Emilia) can immediately act.
    if (this._emiliaRewindSkipNextEndTurn) {
        this._emiliaRewindSkipNextEndTurn = false;
    } else {
        await this.endTurn();
    }

    if (this.gamePhase === 'finished') {
        const r = { damage: 0, healing: 0, effects: ['Turn skipped'], animations, gameEnded: true, winner: this.winner };
        if (typeof this.buildStateSnapshot === 'function') r.stateSnapshot = this.buildStateSnapshot();
        return r;
    }

    const r = { damage: 0, healing: 0, effects: ['Turn skipped'], animations, gameEnded: false };
    if (typeof this.buildStateSnapshot === 'function') r.stateSnapshot = this.buildStateSnapshot();
    return r;
    } finally {
        if (this.skillSystem && typeof this.skillSystem.popAnimationSink === 'function') {
            this.skillSystem.popAnimationSink();
        }
    }
};

GameState.prototype.useUltimate = async function (playerId) {
    if (this.currentTurn !== playerId || this.gamePhase !== 'active') {
        throw new Error('Not your turn or game not active');
    }

    const resolveKaitoTacticsRedirect = (requestedType, requestedSkillIndex = null) => {
        try {
            const player = this.players.get(playerId);
            const opponent = this.players.get(playerId === 'player1' ? 'player2' : 'player1');
            if (!player || !opponent) return { actionType: requestedType, skillIndex: requestedSkillIndex };
            const character = player.character;
            if (!character || character.id !== 'kaito') return { actionType: requestedType, skillIndex: requestedSkillIndex };

            const hasRestriction = (() => {
                try {
                    for (const [, eff] of this.skillSystem.activeEffects.entries()) {
                        if (!eff) continue;
                        if (eff.type !== 'restriction') continue;
                        if (eff.target !== playerId) continue;
                        if (eff.key !== 'restriction_tactics') continue;
                        if ((Number(eff.turnsLeft) || 0) <= 0) continue;
                        return true;
                    }
                } catch (e) {}
                return false;
            })();
            if (!hasRestriction) return { actionType: requestedType, skillIndex: requestedSkillIndex };

            const skills = Array.isArray(character.skills) ? character.skills : [];

            const isSkillUsable = (s) => {
                if (!s || !s.id) return false;
                if (!this.skillSystem || typeof this.skillSystem.canUseSkill !== 'function') return false;
                if (!this.skillSystem.canUseSkill(s, playerId)) return false;
                try {
                    const state = character?.passiveState;
                    if (s.id === 'kaito_crazy_slots' && state && state.kaitoWeaponKey) return false;
                    if (s.id === 'kaito_price_of_power') {
                        const r = (window.KaitoCharacter && typeof window.KaitoCharacter.getActiveKaitoRestrictions === 'function')
                            ? window.KaitoCharacter.getActiveKaitoRestrictions(this.skillSystem, playerId).size
                            : 0;
                        if (r >= 5) return false;
                    }
                } catch (e) {}
                try {
                    if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                        const res = window.BattleHooks.emit('skill_system:can_use_skill', {
                            gameState: this,
                            skillSystem: this.skillSystem,
                            passiveSystem: this.passiveSystem,
                            playerId,
                            skill: s,
                            caster: character,
                            override: {}
                        });
                        for (const r of (res || [])) {
                            if (r === false) return false;
                        }
                    }
                } catch (e) {}
                return true;
            };

            const isUltimateUsable = () => {
                if (!player.ultimateReady) return false;
                if (typeof this.canUseUltimateWithLimit === 'function') {
                    if (!this.canUseUltimateWithLimit(player)) return false;
                }
                try {
                    if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
                        const res = window.BattleHooks.emit('skill_system:can_use_ultimate', {
                            gameState: this,
                            skillSystem: this.skillSystem,
                            passiveSystem: this.passiveSystem,
                            playerId,
                            player,
                            character,
                            ultimate: character?.ultimate
                        });
                        for (const r of (res || [])) {
                            if (r === false) return false;
                        }
                    }
                } catch (e) {
                    return false;
                }
                return true;
            };

            const options = [];
            if (isUltimateUsable()) {
                options.push({ actionType: 'ultimate', skillIndex: null, id: character?.ultimate?.id || 'ultimate' });
            }
            for (let i = 0; i < skills.length; i++) {
                const s = skills[i];
                if (!isSkillUsable(s)) continue;
                options.push({ actionType: 'skill', skillIndex: i, id: s.id });
            }
            if (options.length <= 1) return { actionType: requestedType, skillIndex: requestedSkillIndex };

            const requestedId = requestedType === 'ultimate'
                ? (character?.ultimate?.id || 'ultimate')
                : (skills[requestedSkillIndex]?.id || 'skill');
            const seed = `${this.gameId || 'game'}:${this.turnCount || 0}:${playerId}:kaito:tactics:${requestedType}:${requestedId}:${options.map(o => o.id).join('|')}`;
            const rand = this.skillSystem && typeof this.skillSystem.deterministicRandom === 'function'
                ? this.skillSystem.deterministicRandom(seed)
                : Math.random();
            const idx = Math.min(options.length - 1, Math.max(0, Math.floor(rand * options.length)));
            const picked = options[idx];

            return { actionType: picked.actionType, skillIndex: picked.skillIndex };
        } catch (e) {
            return { actionType: requestedType, skillIndex: requestedSkillIndex };
        }
    };

    const animations = [];
    if (this.skillSystem && typeof this.skillSystem.pushAnimationSink === 'function') {
        this.skillSystem.pushAnimationSink(animations);
    }

    try {

    if (this.skillSystem.isStunned(playerId)) {
        console.log(`${playerId} is stunned and cannot act - skipping turn`);
        await this.endTurn();
        if (this.gamePhase === 'finished') {
            return { damage: 0, healing: 0, effects: ['Turn skipped due to stun'], animations, gameEnded: true, winner: this.winner };
        }
        return { damage: 0, healing: 0, effects: ['Turn skipped due to stun'], animations, gameEnded: false };
    }

    const player = this.players.get(playerId);
    const opponent = this.players.get(playerId === 'player1' ? 'player2' : 'player1');

    if (!player || !opponent) {
        throw new Error('Player not found');
    }

    const redirect = resolveKaitoTacticsRedirect('ultimate', null);
    if (redirect.actionType === 'skill') {
        const skill = player.character.skills[redirect.skillIndex];
        if (!skill) {
            throw new Error('Skill not found');
        }

        this.skillSystem.getPlayerById = (id) => {
            return this.players.get(id)?.character;
        };

        const result = await this.skillSystem.executeSkill(
            skill,
            player.character,
            opponent.character,
            this,
            playerId
        );
        result._effectiveActionType = 'skill';
        result._effectiveSkillIndex = redirect.skillIndex;
        result.animations = animations;

        this.updatePassiveProgress(player, player.character.skills[redirect.skillIndex], result);

        if (player.character.stats.health <= 0 && opponent.character.stats.health <= 0) {
            this.gamePhase = 'finished';
            this.winner = 'draw';
            return { ...result, gameEnded: true, winner: 'draw' };
        }

        if (opponent.character.stats.health <= 0) {
            this.gamePhase = 'finished';
            this.winner = playerId;
            return { ...result, gameEnded: true, winner: playerId };
        }

        if (player.character.stats.health <= 0) {
            this.gamePhase = 'finished';
            this.winner = opponent.id;
            return { ...result, gameEnded: true, winner: opponent.id };
        }

        // Emilia rewind: if a death-triggered rewind happened during this action,
        // cancel the normal endTurn so the rewound player (Emilia) can immediately act.
        if (this._emiliaRewindSkipNextEndTurn) {
            this._emiliaRewindSkipNextEndTurn = false;
        } else {
            await this.endTurn();
        }

        if (this.gamePhase === 'finished') {
            const r = { ...result, gameEnded: true, winner: this.winner };
            if (typeof this.buildStateSnapshot === 'function') {
                r.stateSnapshot = this.buildStateSnapshot();
            }
            return r;
        }

        const r = { ...result, gameEnded: false };
        if (typeof this.buildStateSnapshot === 'function') {
            r.stateSnapshot = this.buildStateSnapshot();
        }
        return r;
    }

    if (!player.ultimateReady) {
        throw new Error('Ultimate not ready');
    }

    // Allow extensions to block ultimate usage (e.g., restrictions, seals).
    try {
        if (window.BattleHooks && typeof window.BattleHooks.emit === 'function') {
            const res = window.BattleHooks.emit('skill_system:can_use_ultimate', {
                gameState: this,
                skillSystem: this.skillSystem,
                passiveSystem: this.passiveSystem,
                playerId,
                player,
                character: player.character,
                ultimate: player.character?.ultimate
            });
            for (const r of (res || [])) {
                if (r === false) {
                    throw new Error('Ultimate is disabled');
                }
            }
        }
    } catch (e) {
        if (e && e.message) throw e;
        throw new Error('Ultimate is disabled');
    }

    if (!this.canUseUltimateWithLimit(player)) {
        throw new Error('Ultimate limit reached');
    }

    this.skillSystem.getPlayerById = (id) => {
        return this.players.get(id)?.character;
    };

    if (this.passiveSystem && typeof this.passiveSystem.handleEvent === 'function') {
        const ultId = player.character.ultimate && player.character.ultimate.id;
        if (ultId) {
            const ultType = 'ultimate';
            this.passiveSystem.handleEvent(playerId, 'skill_used', { skillId: ultId, skillType: ultType });
            this.passiveSystem.handleEvent(opponent.id, 'opponent_skill_used', { skillId: ultId, skillType: ultType, attackerId: playerId });
        }
    }

    const result = await this.skillSystem.withActionContext({
        kind: 'ultimate',
        attackerId: playerId,
        skillId: player.character?.ultimate?.id,
        skillType: 'ultimate',
        isCounter: false
    }, async () => {
        return await this.skillSystem.applySkillEffect(
            player.character.ultimate.effect,
            player.character,
            opponent.character,
            this,
            playerId
        );
    });

    result._effectiveActionType = 'ultimate';
    result._effectiveSkillIndex = null;
    result.animations = animations;

    {
        const ultimate = player.character.ultimate;
        const cd = Math.max(0, Math.floor(Number(ultimate?.cooldown) || 0));
        if (cd > 0 && this.skillSystem && typeof this.skillSystem.setSkillCooldown === 'function') {
            // Cooldown N means it is unavailable for the next N of your turns.
            if (typeof this.skillSystem.setSkillCooldownFromUse === 'function') {
                this.skillSystem.setSkillCooldownFromUse(ultimate.id, playerId, cd);
            } else {
                this.skillSystem.setSkillCooldown(ultimate.id, playerId, cd);
            }
        }
    }

    {
        const usage = this.ensureUsageState(player.character);
        const id = player.character.ultimate.id;
        usage.ultimateUses[id] = (Number(usage.ultimateUses[id]) || 0) + 1;
    }

    {
        const passive = player.character?.passive;
        const mission = passive && passive.mission ? passive.mission : null;
        const keepReadyAfterUse = Boolean(mission && mission.keepReadyAfterUse === true);

        if (passive?.alwaysUltimateReady || keepReadyAfterUse) {
            // Keep ultimate ready.
        } else {
            // Consume ultimate readiness. Clear both flags to keep UI and clickability consistent.
            player.ultimateReady = false;
            if (player.character?.passiveState) {
                player.character.passiveState.ultimateReady = false;
            }
        }
    }

    this.resetPassiveProgress(player);

    if (player.character.stats.health <= 0 && opponent.character.stats.health <= 0) {
        this.gamePhase = 'finished';
        this.winner = 'draw';
        return { ...result, gameEnded: true, winner: 'draw' };
    }

    if (opponent.character.stats.health <= 0) {
        this.gamePhase = 'finished';
        this.winner = playerId;
        return { ...result, gameEnded: true, winner: playerId };
    }

    if (player.character.stats.health <= 0) {
        this.gamePhase = 'finished';
        this.winner = opponent.id;
        return { ...result, gameEnded: true, winner: opponent.id };
    }

    // Emilia rewind: if a death-triggered rewind happened during this action,
    // cancel the normal endTurn so the rewound player (Emilia) can immediately act.
    if (this._emiliaRewindSkipNextEndTurn) {
        this._emiliaRewindSkipNextEndTurn = false;
    } else {
        await this.endTurn();
    }

    if (this.gamePhase === 'finished') {
        const r = { ...result, gameEnded: true, winner: this.winner };
        if (typeof this.buildStateSnapshot === 'function') {
            r.stateSnapshot = this.buildStateSnapshot();
        }
        return r;
    }

    const r = { ...result, gameEnded: false };
    if (typeof this.buildStateSnapshot === 'function') {
        r.stateSnapshot = this.buildStateSnapshot();
    }
    return r;
    } finally {
        if (this.skillSystem && typeof this.skillSystem.popAnimationSink === 'function') {
            this.skillSystem.popAnimationSink();
        }
    }
};
