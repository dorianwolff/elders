GameState.prototype.getGameStateForPlayer = function (playerId) {
    const player = this.players.get(playerId);
    const opponent = this.players.get(playerId === 'player1' ? 'player2' : 'player1');

    if (!player || !opponent) {
        return null;
    }

    return {
        gameId: this.gameId,
        gamePhase: this.gamePhase,
        currentTurn: this.currentTurn,
        isYourTurn: this.currentTurn === playerId,
        turnCount: this.turnCount,
        winner: this.winner,
        skillSystem: this.skillSystem,
        playerId,
        player: {
            character: player.character,
            ultimateReady: player.ultimateReady,
            activeEffects: this.skillSystem.getActiveEffectsForPlayer(playerId)
        },
        opponent: {
            character: {
                id: opponent.character.id,
                name: opponent.character.name,
                images: opponent.character.images,
                stats: {
                    health: opponent.character.stats.health,
                    maxHealth: opponent.character.stats.maxHealth,
                    attack: opponent.character.stats.attack,
                    defense: opponent.character.stats.defense,
                    shield: opponent.character.stats.shield,
                    maxShield: opponent.character.stats.maxShield,
                    lifesteal: opponent.character.stats.lifesteal,
                    damageReduction: opponent.character.stats.damageReduction
                }
            },
            activeEffects: this.skillSystem.getActiveEffectsForPlayer(opponent.id)
        }
    };
};

GameState.prototype.buildStateSnapshot = function () {
    const p1 = this.players.get('player1');
    const p2 = this.players.get('player2');

    const snapPlayer = (p) => {
        const c = p?.character;
        return {
            id: p?.id,
            characterId: c?.id,
            skillCount: Array.isArray(c?.skills) ? c.skills.length : 0,
            skillIds: Array.isArray(c?.skills) ? c.skills.map(s => s && s.id).filter(Boolean) : [],
            ultimateReady: Boolean(p?.ultimateReady),
            baseStats: c?.baseStats ? JSON.parse(JSON.stringify(c.baseStats)) : null,
            stats: {
                health: Number(c?.stats?.health) || 0,
                maxHealth: Number(c?.stats?.maxHealth) || 0,
                shield: Number(c?.stats?.shield) || 0,
                maxShield: Number(c?.stats?.maxShield) || 0,
                attack: Number(c?.stats?.attack) || 0,
                defense: Number(c?.stats?.defense) || 0,
                lifesteal: Number(c?.stats?.lifesteal) || 0,
                damageReduction: Number(c?.stats?.damageReduction) || 0
            },
            passiveState: c?.passiveState ? JSON.parse(JSON.stringify(c.passiveState)) : { counters: {} }
        };
    };

    return {
        gameId: this.gameId,
        gamePhase: this.gamePhase,
        currentTurn: this.currentTurn,
        turnCount: this.turnCount,
        winner: this.winner,
        players: {
            player1: snapPlayer(p1),
            player2: snapPlayer(p2)
        },
        activeEffects: (this.skillSystem && typeof this.skillSystem.serializeActiveEffects === 'function')
            ? this.skillSystem.serializeActiveEffects()
            : [],
        skillCooldowns: (this.skillSystem && typeof this.skillSystem.serializeSkillCooldowns === 'function')
            ? this.skillSystem.serializeSkillCooldowns()
            : []
    };
};

GameState.prototype.applyStateSnapshot = async function (snapshot) {
    if (!snapshot) return;

    this.gameId = snapshot.gameId || this.gameId;
    this.gamePhase = snapshot.gamePhase || this.gamePhase;
    this.currentTurn = snapshot.currentTurn || this.currentTurn;
    this.turnCount = typeof snapshot.turnCount === 'number' ? snapshot.turnCount : this.turnCount;
    this.winner = snapshot.winner || this.winner;

    const applyToPlayer = (playerId, pSnap) => {
        const p = this.players.get(playerId);
        if (!p || !p.character || !pSnap) return;

        // Sync character kit if the snapshot indicates a transformation.
        // This is required so sprites/images/skills update on the receiving client.
        try {
            const nextCharId = typeof pSnap.characterId === 'string' ? pSnap.characterId : null;
            if (nextCharId && p.character.id !== nextCharId && this.skillSystem && typeof this.skillSystem.transformCharacter === 'function') {
                // Preserve passive state to avoid wiping counters; snapshot will overwrite passiveState below anyway.
                // (applyToPlayer continues immediately after the await via the async wrapper in applyStateSnapshot)
                // eslint-disable-next-line no-unused-expressions
            }
        } catch (e) {
            console.warn('Snapshot transform pre-check failed:', e);
        }
        p.ultimateReady = Boolean(pSnap.ultimateReady);

        if (pSnap.baseStats && typeof pSnap.baseStats === 'object') {
            p.character.baseStats = JSON.parse(JSON.stringify(pSnap.baseStats));
        } else if (!p.character.baseStats) {
            p.character.baseStats = { ...p.character.stats };
        }

        const s = pSnap.stats || {};
        p.character.stats.health = Number(s.health) || 0;
        p.character.stats.maxHealth = Number(s.maxHealth) || p.character.stats.maxHealth;
        p.character.stats.shield = Number(s.shield) || 0;
        p.character.stats.maxShield = Number(s.maxShield) || 0;
        p.character.stats.attack = Number(s.attack) || p.character.stats.attack;
        p.character.stats.defense = Number(s.defense) || p.character.stats.defense;
        p.character.stats.lifesteal = Number(s.lifesteal) || p.character.stats.lifesteal;
        p.character.stats.damageReduction = Number(s.damageReduction) || p.character.stats.damageReduction;

        if (pSnap.passiveState) {
            p.character.passiveState = JSON.parse(JSON.stringify(pSnap.passiveState));
        }

        // Enforce skill slot count from the authoritative snapshot (prevents undefined skill indices).
        if (typeof pSnap.skillCount === 'number' && pSnap.skillCount >= 0 && Array.isArray(p.character.skills)) {
            p.character.skills = p.character.skills.slice(0, Math.floor(pSnap.skillCount));
        }

        // Ensure ultimate readiness stays consistent with data-driven passive counters after snapshot sync.
        // (Some clients may not include an updated ultimateReady flag in the snapshot even though counters are correct.)
        if (this.passiveSystem && typeof this.passiveSystem.updateUltimateReady === 'function') {
            this.passiveSystem.updateUltimateReady(playerId);
        }

        if (p.character.id === 'rimuru_tempest') {
            const devourSkill = p.character.passiveState?.devourSkill;
            if (devourSkill && devourSkill.id) {
                p.character.devourSkill = JSON.parse(JSON.stringify(devourSkill));
                const devour = Array.isArray(p.character.skills)
                    ? p.character.skills.find(s => s && s.id === 'devour')
                    : null;
                if (devour) {
                    devour._copiedSkillId = devourSkill.id;
                    devour._copiedName = devourSkill.name;
                    devour._copiedDescription = devourSkill.description;
                }
            }
        }
    };

    // Apply transforms first (async), then apply stats/passive state.
    const doTransformIfNeeded = async (playerId, pSnap) => {
        const p = this.players.get(playerId);
        if (!p || !p.character || !pSnap) return;
        const nextCharId = typeof pSnap.characterId === 'string' ? pSnap.characterId : null;
        if (nextCharId && p.character.id !== nextCharId && this.skillSystem && typeof this.skillSystem.transformCharacter === 'function') {
            const keepSkillCount = (typeof pSnap.skillCount === 'number') ? pSnap.skillCount : null;
            const keepSkillIds = Array.isArray(pSnap.skillIds) ? pSnap.skillIds : null;
            await this.skillSystem.transformCharacter(playerId, nextCharId, { preservePassiveState: true, keepSkillCount, keepSkillIds });
        }
    };

    await doTransformIfNeeded('player1', snapshot.players?.player1);
    await doTransformIfNeeded('player2', snapshot.players?.player2);

    applyToPlayer('player1', snapshot.players?.player1);
    applyToPlayer('player2', snapshot.players?.player2);

    if (this.skillSystem) {
        if (typeof this.skillSystem.loadActiveEffects === 'function') {
            this.skillSystem.loadActiveEffects(snapshot.activeEffects);
        }
        if (typeof this.skillSystem.loadSkillCooldowns === 'function') {
            this.skillSystem.loadSkillCooldowns(snapshot.skillCooldowns);
        }

        if (typeof this.skillSystem.recalculateStats === 'function') {
            this.skillSystem.recalculateStats('player1');
            this.skillSystem.recalculateStats('player2');
        }
    }
};

GameState.prototype.applyOpponentActionResult = async function (playerId, actionType, skillIndex, result) {
    console.log(`30e OPPONENT ACTION: Processing ${actionType} from ${playerId}`);
    console.log(`30e OPPONENT ACTION: Skill index: ${skillIndex}, Result:`, result);

    // Prefer authoritative snapshot if provided to avoid double-executing reactive logic.
    if (result && result.stateSnapshot && typeof this.applyStateSnapshot === 'function') {
        await this.applyStateSnapshot(result.stateSnapshot);

        // If the authoritative snapshot indicates the game ended, surface it through the action result
        // so GameCoordinator can reliably redirect to the result page.
        if (this.gamePhase === 'finished' && this.winner) {
            result.gameEnded = true;
            result.winner = this.winner;
        }
        return;
    }

    if (actionType === 'skip') {
        await this.endTurn();
        return;
    }

    if (actionType === 'surrender') {
        if (result && result.gameEnded && result.winner) {
            this.gamePhase = 'finished';
            this.winner = result.winner;
        } else {
            const opponentId = playerId === 'player1' ? 'player2' : 'player1';
            this.gamePhase = 'finished';
            this.winner = opponentId;
            if (result) {
                result.gameEnded = true;
                result.winner = opponentId;
                if (!Array.isArray(result.effects)) result.effects = [];
                result.effects.push('Surrendered');
            }
        }
        return;
    }

    const player = this.players.get(playerId);
    const opponent = this.players.get(playerId === 'player1' ? 'player2' : 'player1');

    if (!player || !opponent) {
        throw new Error('Player not found');
    }

    console.log(`🌐 OPPONENT ACTION: Acting player: ${player.character.name} (${playerId})`);
    console.log(`🌐 OPPONENT ACTION: Target player: ${opponent.character.name} (${opponent.id})`);
    console.log(`🌐 OPPONENT ACTION: Current active effects:`, Array.from(this.skillSystem.activeEffects.entries()));

    this.skillSystem.getPlayerById = (id) => {
        return this.players.get(id)?.character;
    };

    if (actionType === 'skill') {
        const skill = player.character.skills[skillIndex];
        if (skill) {
            if (this.passiveSystem && typeof this.passiveSystem.handleEvent === 'function') {
                const effectiveType = (skill.id === 'gojo_strike' && this.skillSystem && typeof this.skillSystem.isDomainActive === 'function' && this.skillSystem.isDomainActive())
                    ? 'heal'
                    : skill.type;
                this.passiveSystem.handleEvent(playerId, 'skill_used', { skillId: skill.id, skillType: effectiveType });
                this.passiveSystem.handleEvent(opponent.id, 'opponent_skill_used', { skillId: skill.id, skillType: effectiveType, attackerId: playerId });
            }

            // Edward Elric: Alchemy domain heat grant must run for opponent actions too
            try {
                const dom = this.skillSystem && typeof this.skillSystem.getAlchemyDomainEffect === 'function'
                    ? this.skillSystem.getAlchemyDomainEffect()
                    : null;
                if (dom) {
                    const gain = Math.max(0, Math.floor(Number(dom.heatGain) || 0));
                    const cap = (typeof dom.heatCap === 'number') ? dom.heatCap : 100;
                    if (gain > 0 && this.skillSystem && typeof this.skillSystem.addCounterValue === 'function') {
                        for (const pid of ['player1', 'player2']) {
                            this.skillSystem.addCounterValue(pid, 'heat', gain, 0, cap);
                        }
                    }
                }
            } catch (e) {
                console.warn('Alchemy domain heat grant failed (multiplayer opponent action):', e);
            }

            const override = {};
            if (
                skill.effect &&
                (skill.effect.type === 'damage_with_stun' || skill.effect.type === 'damage_and_stun') &&
                typeof result.stunApplied === 'boolean'
            ) {
                override.stunApplied = result.stunApplied;
            }

            if (typeof result.lightningDamage === 'number') {
                override.lightningDamage = result.lightningDamage;
            }

            await this.skillSystem.withActionContext({
                kind: 'skill',
                attackerId: playerId,
                skillId: skill?.id,
                skillType: (skill.id === 'gojo_strike' && this.skillSystem && typeof this.skillSystem.isDomainActive === 'function' && this.skillSystem.isDomainActive())
                    ? 'heal'
                    : skill.type,
                isCounter: false
            }, async () => {
                await this.skillSystem.applySkillEffect(
                    skill.effect,
                    player.character,
                    opponent.character,
                    this,
                    playerId,
                    override
                );
            });

            if (skill.cooldown > 0) {
                if (typeof this.skillSystem.setSkillCooldownFromUse === 'function') {
                    this.skillSystem.setSkillCooldownFromUse(skill.id, playerId, skill.cooldown);
                } else {
                    this.skillSystem.setSkillCooldown(skill.id, playerId, skill.cooldown);
                }
            }
        }
    } else if (actionType === 'ultimate') {
        if (this.passiveSystem && typeof this.passiveSystem.handleEvent === 'function') {
            const ultId = player.character.ultimate && player.character.ultimate.id;
            if (ultId) {
                const ultType = 'ultimate';
                this.passiveSystem.handleEvent(playerId, 'skill_used', { skillId: ultId, skillType: ultType });
                this.passiveSystem.handleEvent(opponent.id, 'opponent_skill_used', { skillId: ultId, skillType: ultType, attackerId: playerId });
            }
        }

        await this.skillSystem.withActionContext({
            kind: 'ultimate',
            attackerId: playerId,
            skillId: player.character?.ultimate?.id,
            skillType: 'ultimate',
            isCounter: false
        }, async () => {
            await this.skillSystem.applySkillEffect(
                player.character.ultimate.effect,
                player.character,
                opponent.character,
                this,
                playerId,
                {
                    lightningDamage: typeof result.lightningDamage === 'number' ? result.lightningDamage : undefined
                }
            );
        });

        {
            const ultimate = player.character.ultimate;
            const cd = Math.max(0, Math.floor(Number(ultimate?.cooldown) || 0));
            if (cd > 0 && this.skillSystem && typeof this.skillSystem.setSkillCooldown === 'function') {
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

        player.ultimateReady = false;
        player.character.passiveProgress = this.initializePassiveProgress(player.character.passive);
    }

    await this.endTurn();

    if (player.character.stats.health <= 0 && opponent.character.stats.health <= 0) {
        this.gamePhase = 'finished';
        this.winner = 'draw';
        result.gameEnded = true;
        result.winner = 'draw';
        return;
    }

    if (opponent.character.stats.health <= 0) {
        this.gamePhase = 'finished';
        this.winner = playerId;
        result.gameEnded = true;
        result.winner = playerId;
    }

    if (player.character.stats.health <= 0) {
        this.gamePhase = 'finished';
        this.winner = opponent.id;
        result.gameEnded = true;
        result.winner = opponent.id;
    }
};

GameState.prototype.getFullGameState = function () {
    return {
        gameId: this.gameId,
        gamePhase: this.gamePhase,
        currentTurn: this.currentTurn,
        turnCount: this.turnCount,
        winner: this.winner,
        players: Object.fromEntries(this.players)
    };
};
