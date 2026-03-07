GameState.prototype.useSkill = async function (playerId, skillIndex) {
    if (this.currentTurn !== playerId || this.gamePhase !== 'active') {
        throw new Error('Not your turn or game not active');
    }

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

    const skill = player.character.skills[skillIndex];
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

    result.animations = animations;

    this.updatePassiveProgress(player, skill, result);

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

    await this.endTurn();

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

    await this.endTurn();

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

    const result = await this.skillSystem.applySkillEffect(
        player.character.ultimate.effect,
        player.character,
        opponent.character,
        this,
        playerId
    );

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

        // Default behavior: consuming an ultimate makes it unavailable until it is re-charged.
        // Exception:
        // - Passives with missions that do NOT reset on ready are intended to keep ultimate available
        //   once unlocked (e.g., Naruto Sage at 5/5 Sage Orbs).
        // - alwaysUltimateReady keeps it available unconditionally.
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

    await this.endTurn();

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
