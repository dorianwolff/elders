class GameState {
    constructor() {
        this.players = new Map();
        this.currentTurn = null;
        this.turnCount = 0;
        this.gamePhase = 'waiting'; // waiting, active, finished
        this.winner = null;
        this.gameId = null;
        this.skillSystem = new SkillSystem();
        this.skillSystem.gameState = this;

        this.passiveSystem = new PassiveSystem(this.skillSystem);
        this.passiveSystem.setGameState(this);
        this.skillSystem.passiveSystem = this.passiveSystem;
    }

    ensureUsageState(character) {
        if (!character) return null;
        if (!character.usageState) {
            character.usageState = {
                skillUses: {},
                ultimateUses: {}
            };
        }
        if (!character.usageState.skillUses) character.usageState.skillUses = {};
        if (!character.usageState.ultimateUses) character.usageState.ultimateUses = {};
        return character.usageState;
    }

    canUseUltimateWithLimit(player) {
        if (!player || !player.character || !player.character.ultimate) return false;
        if (!player.ultimateReady) return false;

        const ultimate = player.character.ultimate;
        const cd = Math.max(0, Math.floor(Number(ultimate.cooldown) || 0));
        if (cd > 0 && this.skillSystem && typeof this.skillSystem.getSkillCooldown === 'function') {
            const remaining = this.skillSystem.getSkillCooldown({ id: ultimate.id }, player.id);
            if (remaining > 0) {
                return false;
            }
        }

        const limit = player.character.ultimate.limit;
        if (typeof limit !== 'number') return true;
        const usage = this.ensureUsageState(player.character);
        const id = player.character.ultimate.id;
        const used = Number(usage?.ultimateUses?.[id]) || 0;
        return used < limit;
    }

    ensureUltimateReadyFromCooldown(playerId) {
        try {
            if (playerId !== 'player1' && playerId !== 'player2') return;
            const player = this.players && typeof this.players.get === 'function' ? this.players.get(playerId) : null;
            if (!player || !player.character) return;
            const character = player.character;
            const ultimate = character.ultimate;
            if (!ultimate || !ultimate.id) return;

            // If the passive defines a readiness condition, do not override it here.
            const condition = this.getUltimateCondition(character);
            if (condition && condition.type) return;
            if (character.passive && character.passive.alwaysUltimateReady) return;

            const remaining = (this.skillSystem && typeof this.skillSystem.getSkillCooldown === 'function')
                ? Math.max(0, Math.floor(this.skillSystem.getSkillCooldown({ id: ultimate.id }, playerId)))
                : 0;

            if (remaining <= 0) {
                player.ultimateReady = true;
                if (character.passiveState) {
                    character.passiveState.ultimateReady = true;
                }
            }
        } catch (e) {}
    }

    getUltimateCondition(character) {
        if (!character || !character.passive) return null;
        if (character.passive.mission) {
            return character.passive.mission;
        }
        if (character.passive.type === 'dual_passive' && character.passive.ultimate_condition) {
            return character.passive.ultimate_condition;
        }
        return character.passive;
    }

    ensureUltimateProgressShape(character) {
        if (!character.passiveProgress) {
            character.passiveProgress = {};
        }

        const condition = this.getUltimateCondition(character);
        if (!condition || !condition.type) return;

        if (character.passive && character.passive.mission) {
            // Ultimate readiness is handled by PassiveSystem for new passives.
            return;
        }

        switch (condition.type) {
            case 'damage_threshold':
                character.passiveProgress.damageTaken = character.passiveProgress.damageTaken || 0;
                character.passiveProgress.threshold = condition.value;
                break;
            case 'skill_count':
                character.passiveProgress.skillsUsed = character.passiveProgress.skillsUsed || 0;
                character.passiveProgress.threshold = condition.value;
                break;
            case 'heal_count':
                character.passiveProgress.healsUsed = character.passiveProgress.healsUsed || 0;
                character.passiveProgress.threshold = condition.value;
                break;
            case 'total_damage_dealt':
                character.passiveProgress.totalDamageDealt = character.passiveProgress.totalDamageDealt || 0;
                character.passiveProgress.threshold = condition.value;
                break;
            case 'lifesteal_damage_dealt':
                character.passiveProgress.lifestealDamageDealt = character.passiveProgress.lifestealDamageDealt || 0;
                character.passiveProgress.threshold = condition.value;
                break;
            case 'poison_effects_applied':
                character.passiveProgress.poisonEffectsApplied = character.passiveProgress.poisonEffectsApplied || 0;
                character.passiveProgress.threshold = condition.value;
                break;
            case 'total_healing_done':
                character.passiveProgress.totalHealingDone = character.passiveProgress.totalHealingDone || 0;
                character.passiveProgress.threshold = condition.value;
                break;
            case 'turns_survived':
                character.passiveProgress.turnsSurvived = character.passiveProgress.turnsSurvived || 0;
                character.passiveProgress.threshold = condition.value;
                break;
            case 'blocks_performed':
                character.passiveProgress.blocksPerformed = character.passiveProgress.blocksPerformed || 0;
                character.passiveProgress.threshold = condition.value;
                break;
        }
    }

    checkAndSetUltimateReady(player) {
        const character = player.character;
        const condition = this.getUltimateCondition(character);
        if (!condition || !condition.type) return;
        const progress = character.passiveProgress || {};

        let ready = false;
        switch (condition.type) {
            case 'damage_threshold':
                ready = (progress.damageTaken || 0) >= (progress.threshold || condition.value);
                break;
            case 'skill_count':
                ready = (progress.skillsUsed || 0) >= (progress.threshold || condition.value);
                break;
            case 'heal_count':
                ready = (progress.healsUsed || 0) >= (progress.threshold || condition.value);
                break;
            case 'total_damage_dealt':
                ready = (progress.totalDamageDealt || 0) >= (progress.threshold || condition.value);
                break;
            case 'lifesteal_damage_dealt':
                ready = (progress.lifestealDamageDealt || 0) >= (progress.threshold || condition.value);
                break;
            case 'poison_effects_applied':
                ready = (progress.poisonEffectsApplied || 0) >= (progress.threshold || condition.value);
                break;
            case 'total_healing_done':
                ready = (progress.totalHealingDone || 0) >= (progress.threshold || condition.value);
                break;
            case 'turns_survived':
                ready = (progress.turnsSurvived || 0) >= (progress.threshold || condition.value);
                break;
            case 'blocks_performed':
                ready = (progress.blocksPerformed || 0) >= (progress.threshold || condition.value);
                break;
        }

        if (ready) {
            player.ultimateReady = true;
        }

        // Ultimate readiness should never change stats; however, some flows may leave derived stats stale.
        // Recalculate derived stats from baseStats + active effects to avoid any drift.
        if (this.skillSystem && typeof this.skillSystem.recalculateStats === 'function') {
            this.skillSystem.recalculateStats(player.id);
        }
    }

    initializeGame(player1Data, player2Data, gameId, initialCurrentTurn = null) {
        this.gameId = gameId;
        this.gamePhase = 'active';
        this.turnCount = 0;

        // Create deep copies of character data
        const p1Character = JSON.parse(JSON.stringify(player1Data.character));
        const p2Character = JSON.parse(JSON.stringify(player2Data.character));

        // Store initial stats BEFORE item bonuses so UI can show permanent +X from items.
        p1Character.initialStats = { ...p1Character.stats };
        p2Character.initialStats = { ...p2Character.stats };

        const applyItemBonuses = (character) => {
            if (!character || !character.stats) return;
            const itemId = typeof character.itemId === 'string' ? character.itemId : null;
            if (!itemId) return;
            const item = this.characterSystem && this.characterSystem.items && typeof this.characterSystem.items.get === 'function'
                ? this.characterSystem.items.get(itemId)
                : null;
            if (!item || !item.stats) return;

            const s = item.stats;
            const atk = Number(s.attack) || 0;
            const def = Number(s.defense) || 0;
            const maxHp = Number(s.maxHealth) || 0;

            if (!character.itemStatsBonus) character.itemStatsBonus = { attack: 0, defense: 0, maxHealth: 0 };
            character.itemStatsBonus.attack = atk;
            character.itemStatsBonus.defense = def;
            character.itemStatsBonus.maxHealth = maxHp;

            character.stats.attack = (Number(character.stats.attack) || 0) + atk;
            character.stats.defense = (Number(character.stats.defense) || 0) + def;
            if (maxHp) {
                character.stats.maxHealth = (Number(character.stats.maxHealth) || 0) + maxHp;
                character.stats.health = (Number(character.stats.health) || 0) + maxHp;
            }
        };

        applyItemBonuses(p1Character);
        applyItemBonuses(p2Character);

        // Store base stats so temporary buffs/debuffs can always be restored cleanly
        p1Character.baseStats = { ...p1Character.stats };
        p2Character.baseStats = { ...p2Character.stats };

        // Initialize legacy passive tracking (kept for UI compatibility)
        p1Character.passiveProgress = this.initializePassiveProgress(p1Character.passive);
        p2Character.passiveProgress = this.initializePassiveProgress(p2Character.passive);

        // Always reset runtime passive state on new game start (prevents state leaking between matches)
        p1Character.passiveState = { counters: {}, totalHealingDone: 0, ultimateReady: false, lastSkillId: null };
        p2Character.passiveState = { counters: {}, totalHealingDone: 0, ultimateReady: false, lastSkillId: null };

        this.players.set('player1', {
            id: 'player1',
            sessionId: player1Data.sessionId,
            character: p1Character,
            ultimateReady: false
        });

        this.players.set('player2', {
            id: 'player2',
            sessionId: player2Data.sessionId,
            character: p2Character,
            ultimateReady: false
        });

        // Ensure SkillSystem can always resolve player characters (needed for end-of-turn passives)
        this.skillSystem.getPlayerById = (id) => {
            return this.players.get(id)?.character;
        };

        // Start ultimates on cooldown (tick down like a regular skill).
        try {
            for (const pid of ['player1', 'player2']) {
                const c = this.players.get(pid)?.character;
                const ult = c && c.ultimate;
                const cd = Math.max(0, Math.floor(Number(ult?.cooldown) || 0));
                const alwaysUltimateReady = Boolean(c && c.passive && c.passive.alwaysUltimateReady);

                // Characters without a mission/ultimate_condition should have their ultimate become ready
                // automatically once the cooldown reaches 0.
                try {
                    const cond = this.getUltimateCondition(c);
                    if (!alwaysUltimateReady && (!cond || !cond.type)) {
                        this.players.get(pid).ultimateReady = true;
                        if (c && c.passiveState) c.passiveState.ultimateReady = true;
                    }
                } catch (e) {}

                if (alwaysUltimateReady) {
                    // Some characters (e.g. Chen) start with Ultimate available even if the ultimate has a cooldown.
                    this.players.get(pid).ultimateReady = true;
                    if (c && c.passiveState) c.passiveState.ultimateReady = true;
                    if (ult && typeof ult.id === 'string' && this.skillSystem && typeof this.skillSystem.setSkillCooldown === 'function') {
                        this.skillSystem.setSkillCooldown(ult.id, pid, 0);
                    }
                    continue;
                }

                if (ult && typeof ult.id === 'string' && cd > 0 && this.skillSystem) {
                    // IMPORTANT: do NOT use setSkillCooldownFromUse here; it sets a skip-next-decrement flag
                    // which would prevent the cooldown from decreasing after the first turn.
                    if (typeof this.skillSystem.setSkillCooldown === 'function') {
                        this.skillSystem.setSkillCooldown(ult.id, pid, cd);
                    } else if (typeof this.skillSystem.setSkillCooldownFromUse === 'function') {
                        this.skillSystem.setSkillCooldownFromUse(ult.id, pid, cd);
                        // If we had to fall back, clear the skip flag so it decrements immediately.
                        try {
                            if (typeof this.skillSystem.getSkillCooldownKey === 'function' && this.skillSystem._cooldownsSkipNextDecrement) {
                                this.skillSystem._cooldownsSkipNextDecrement.delete(this.skillSystem.getSkillCooldownKey(ult.id, pid));
                            }
                        } catch (e) {}
                    }
                }

                // If cooldown is 0 at game start, ensure readiness is consistent.
                this.ensureUltimateReadyFromCooldown(pid);
            }
        } catch (e) {}

        // Determine who starts based on meta points (or accept an authoritative value from server)
        if (initialCurrentTurn === 'player1' || initialCurrentTurn === 'player2') {
            this.currentTurn = initialCurrentTurn;
        } else {
            this.determineFirstPlayer();
        }

        if (this.passiveSystem) {
            this.passiveSystem.handleEvent('player1', 'turn_start');
            this.passiveSystem.handleEvent('player2', 'turn_start');
            this.passiveSystem.handleEvent(this.currentTurn, 'turn_start');
        }
    }

    initializePassiveProgress(passive) {
        // New data-driven passives use passiveState in PassiveSystem, not passiveProgress.
        if (passive && passive.mission) {
            return {};
        }
        switch (passive.type) {
            case 'damage_threshold':
                return { damageTaken: 0, threshold: passive.value };
            case 'skill_count':
                return { skillsUsed: 0, threshold: passive.value };
            case 'heal_count':
                return { healsUsed: 0, threshold: passive.value };
            case 'enemy_health_threshold':
                return { threshold: passive.value };
            case 'dual_passive':
                // Handle dual passives by looking at ultimate_condition
                if (passive.ultimate_condition) {
                    switch (passive.ultimate_condition.type) {
                        case 'damage_threshold':
                            return { damageTaken: 0, threshold: passive.ultimate_condition.value };
                        case 'skill_count':
                            return { skillsUsed: 0, threshold: passive.ultimate_condition.value };
                        case 'heal_count':
                            return { healsUsed: 0, threshold: passive.ultimate_condition.value };
                        case 'enemy_health_threshold':
                            return { threshold: passive.ultimate_condition.value };
                        case 'total_damage_dealt':
                            return { totalDamageDealt: 0, threshold: passive.ultimate_condition.value };
                        case 'lifesteal_damage_dealt':
                            return { lifestealDamageDealt: 0, threshold: passive.ultimate_condition.value };
                        case 'poison_effects_applied':
                            return { poisonEffectsApplied: 0, threshold: passive.ultimate_condition.value };
                        case 'total_healing_done':
                            return { totalHealingDone: 0, threshold: passive.ultimate_condition.value };
                        case 'turns_survived':
                            return { turnsSurvived: 0, threshold: passive.ultimate_condition.value };
                        case 'blocks_performed':
                            return { blocksPerformed: 0, threshold: passive.ultimate_condition.value };
                        default:
                            return {};
                    }
                }
                return {};
            default:
                return {};
        }
    }

    determineFirstPlayer() {
        const p1 = this.players.get('player1');
        const p2 = this.players.get('player2');

        const p1Meta = Number(p1?.character?.metaPoints) || 0;
        const p2Meta = Number(p2?.character?.metaPoints) || 0;

        if (p1Meta > p2Meta) {
            this.currentTurn = 'player1';
        } else if (p2Meta > p1Meta) {
            this.currentTurn = 'player2';
        } else {
            // Tie-breaker must be deterministic so both clients agree.
            const str = String(this.gameId || '');
            let hash = 0;
            for (let i = 0; i < str.length; i++) {
                hash = ((hash << 5) - hash) + str.charCodeAt(i);
                hash |= 0;
            }
            this.currentTurn = (Math.abs(hash) % 2 === 0) ? 'player1' : 'player2';
        }
    }

    resetPassiveProgress(player) {
        if (!player || !player.character) return;
        player.character.passiveProgress = this.initializePassiveProgress(player.character.passive);
        this.ensureUltimateProgressShape(player.character);
    }

    updatePassiveProgress(player, skill, result) {
        const character = player.character;
        const condition = this.getUltimateCondition(character);
        const progress = character.passiveProgress;

        // Ensure progress object has the right fields
        this.ensureUltimateProgressShape(character);

        if (!condition || !condition.type) return;

        switch (condition.type) {
            case 'damage_threshold':
                // updated on damage taken (SkillSystem.applyDamage)
                break;
            case 'skill_count':
                progress.skillsUsed++;
                break;
            case 'heal_count':
                if (result.healing > 0) {
                    progress.healsUsed++;
                }
                break;
            case 'enemy_health_threshold': {
                // Check opponent health percentage
                const opponent = this.players.get(player.id === 'player1' ? 'player2' : 'player1');
                const healthPercent = opponent.character.stats.health / opponent.character.stats.maxHealth;
                if (healthPercent <= (progress.threshold || condition.value)) {
                    player.ultimateReady = true;
                }
                return;
            }
            case 'total_damage_dealt':
                progress.totalDamageDealt += (result.damage || 0);
                break;
            case 'lifesteal_damage_dealt':
                progress.lifestealDamageDealt += (result.lifestealDamage || 0);
                break;
            case 'poison_effects_applied':
                if (result.poisonApplied) {
                    progress.poisonEffectsApplied++;
                }
                break;
            case 'total_healing_done':
                progress.totalHealingDone += (result.healing || 0);
                break;
            case 'turns_survived':
                // updated at endTurn
                break;
        }

        this.checkAndSetUltimateReady(player);
    }

    updateDamageThresholdPassive(playerId, damage) {
        const player = this.players.get(playerId);
        if (!player) return;

        const character = player.character;
        const condition = this.getUltimateCondition(character);
        if (!condition || condition.type !== 'damage_threshold') return;

        if (character.passive && character.passive.mission) {
            return;
        }

        this.ensureUltimateProgressShape(character);
        const progress = character.passiveProgress;
        progress.damageTaken += damage;
        this.checkAndSetUltimateReady(player);
    }

    updateHealingPassive(playerId, healing) {
        const player = this.players.get(playerId);
        if (!player) return;

        const character = player.character;
        const condition = this.getUltimateCondition(character);
        if (!condition) return;

        if (character.passive && character.passive.mission) {
            return;
        }

        this.ensureUltimateProgressShape(character);
        const progress = character.passiveProgress;

        if (condition.type === 'heal_count') {
            if (healing > 0) {
                progress.healsUsed += 1;
                this.checkAndSetUltimateReady(player);
            }
            return;
        }

        if (condition.type === 'total_healing_done') {
            progress.totalHealingDone += healing;
            this.checkAndSetUltimateReady(player);
        }
    }

    updateBlocksPerformed(playerId) {
        const player = this.players.get(playerId);
        if (!player) return;

        const character = player.character;
        const condition = this.getUltimateCondition(character);
        if (!condition || condition.type !== 'blocks_performed') return;

        if (character.passive && character.passive.mission) {
            return;
        }

        this.ensureUltimateProgressShape(character);
        character.passiveProgress.blocksPerformed += 1;
        this.checkAndSetUltimateReady(player);
    }
}
