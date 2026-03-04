class PassiveSystem {
    constructor(skillSystem) {
        this.skillSystem = skillSystem;
        this.gameState = null;
    }

    setGameState(gameState) {
        this.gameState = gameState;
    }

    ensureState(character) {
        if (!character.passiveState) {
            character.passiveState = {
                counters: {},
                totalHealingDone: 0,
                ultimateReady: false,
                lastSkillId: null,
                archivePages: [],
                archiveLastPageType: null,
                frierenRotatingSkillBag: [],
                frierenRotatingSkillCurrentType: null,
                frierenRotatingSkillLastTurnCount: null,

                // Zero Two: KISS OF DEATH growth
                zeroTwoUltBaseBonus: 0,
                zeroTwoUltUsedTurnCount: null
            };
        }

        if (!character.passiveState.counters) {
            character.passiveState.counters = {};
        }

        if (character.passiveState.lastSkillId === undefined) {
            character.passiveState.lastSkillId = null;
        }

        if (!Array.isArray(character.passiveState.archivePages)) {
            character.passiveState.archivePages = [];
        }
        if (character.passiveState.archiveLastPageType === undefined) {
            character.passiveState.archiveLastPageType = null;
        }

        if (!Array.isArray(character.passiveState.frierenRotatingSkillBag)) {
            character.passiveState.frierenRotatingSkillBag = [];
        }
        if (character.passiveState.frierenRotatingSkillCurrentType === undefined) {
            character.passiveState.frierenRotatingSkillCurrentType = null;
        }
        if (character.passiveState.frierenRotatingSkillLastTurnCount === undefined) {
            character.passiveState.frierenRotatingSkillLastTurnCount = null;
        }

        if (character.passiveState.zeroTwoUltBaseBonus === undefined) {
            character.passiveState.zeroTwoUltBaseBonus = 0;
        }
        if (character.passiveState.zeroTwoUltUsedTurnCount === undefined) {
            character.passiveState.zeroTwoUltUsedTurnCount = null;
        }

        return character.passiveState;
    }

    getMission(character) {
        return character && character.passive ? character.passive.mission : null;
    }

    updateUltimateReady(playerId) {
        const player = this.gameState?.players?.get(playerId);
        if (!player) return;

        const character = player.character;
        const state = this.ensureState(character);
        const mission = this.getMission(character);
        if (!mission || !mission.type) return;

        const evalMission = (m) => {
            if (!m || !m.type) return false;
            if (m.type === 'stack_threshold') {
                const key = m.counter;
                return (state.counters[key] || 0) >= m.value;
            }
            if (m.type === 'counter_extremity') {
                const key = m.counter;
                const threshold = Math.abs(Number(m.value) || 0);
                const current = Number(state.counters[key]) || 0;
                return threshold > 0 && Math.abs(current) >= threshold;
            }
            if (m.type === 'total_healing_done') {
                return (state.totalHealingDone || 0) >= m.value;
            }
            if (m.type === 'any_of') {
                const list = Array.isArray(m.conditions) ? m.conditions : [];
                return list.some(evalMission);
            }
            return false;
        };

        const ready = evalMission(mission);

        if (ready) {
            const wasReady = Boolean(state.ultimateReady);
            state.ultimateReady = true;
            player.ultimateReady = true;

            if (!wasReady && mission.resetOnReady) {
                if (mission.type === 'total_healing_done') {
                    state.totalHealingDone = 0;
                }
                if (mission.type === 'stack_threshold') {
                    const key = mission.counter;
                    if (key) {
                        state.counters[key] = 0;
                    }
                }
            }
        }
    }

    addCounter(character, key, delta, min = 0, max = null) {
        const state = this.ensureState(character);
        const current = Number(state.counters[key]) || 0;
        let next = current + delta;
        if (typeof min === 'number') next = Math.max(min, next);
        if (typeof max === 'number') next = Math.min(max, next);
        state.counters[key] = next;
        return next;
    }

    resetCounter(character, key) {
        const state = this.ensureState(character);
        state.counters[key] = 0;
    }

    applyPermanentStatDelta(playerId, deltas) {
        const character = this.gameState?.players?.get(playerId)?.character;
        if (!character) return;

        if (!character.baseStats) {
            character.baseStats = { ...character.stats };
        }

        for (const [stat, value] of Object.entries(deltas || {})) {
            if (stat === 'currentHealth') {
                character.stats.health = (Number(character.stats.health) || 0) + (Number(value) || 0);
                continue;
            }

            const key = stat;
            const base = Number(character.baseStats[key]) || 0;
            character.baseStats[key] = base + (Number(value) || 0);
        }

        if (this.skillSystem && typeof this.skillSystem.recalculateStats === 'function') {
            this.skillSystem.recalculateStats(playerId);
        }

        if (character.stats.health > character.stats.maxHealth) {
            character.stats.health = character.stats.maxHealth;
        }
    }

    rollDevourSkill(playerId) {
        if (!this.gameState) return;
        const player = this.gameState.players.get(playerId);
        const opponentId = playerId === 'player1' ? 'player2' : 'player1';
        const opponent = this.gameState.players.get(opponentId);
        if (!player || !opponent) return;

        const rimuru = player.character;
        if (!rimuru || rimuru.id !== 'rimuru_tempest') return;

        const state = this.ensureState(rimuru);
        const turnCount = Number(this.gameState?.turnCount);
        if (Number.isFinite(turnCount) && state.devourLastTurnCount === turnCount) {
            return;
        }

        const opponentSkills = Array.isArray(opponent.character.skills) ? opponent.character.skills : [];
        const pool = opponentSkills.filter(s => s && s.id && s.id !== 'devour');
        if (pool.length === 0) return;

        const seed = `${this.gameState.gameId || 'game'}:${this.gameState.turnCount || 0}:${playerId}:devour`;
        const rand = this.skillSystem && typeof this.skillSystem.deterministicRandom === 'function'
            ? this.skillSystem.deterministicRandom(seed)
            : Math.random();

        const idx = Math.floor(rand * pool.length);
        const picked = pool[Math.min(pool.length - 1, Math.max(0, idx))];

        const pickedCopy = JSON.parse(JSON.stringify(picked));
        if (pickedCopy && typeof pickedCopy === 'object') {
            delete pickedCopy.cooldown;
        }

        rimuru.devourSkill = pickedCopy;
        state.devourSkill = JSON.parse(JSON.stringify(pickedCopy));
        if (Number.isFinite(turnCount)) {
            state.devourLastTurnCount = turnCount;
        }

        const devour = rimuru.skills.find(s => s && s.id === 'devour');
        if (devour) {
            devour._copiedSkillId = rimuru.devourSkill.id;
            devour._copiedName = rimuru.devourSkill.name;
            devour._copiedDescription = rimuru.devourSkill.description;
        }
    }

    async handleEvent(playerId, eventType, payload = {}) {
        if (!this.gameState) return;
        const player = this.gameState.players.get(playerId);
        if (!player) return;

        const character = player.character;
        if (!character || !character.passive) return;

        const isBloodlustCarrier = () => {
            return Boolean(character && typeof character.itemId === 'string' && character.itemId === 'mace');
        };

        const hasBloodlustBuff = () => {
            const effects = this.skillSystem && this.skillSystem.activeEffects;
            if (!effects || typeof effects.entries !== 'function') return false;
            for (const [, eff] of effects.entries()) {
                if (!eff) continue;
                if (eff.type !== 'buff') continue;
                if (eff.target !== playerId) continue;
                if (eff._itemPassiveId !== 'mace_bloodlust') continue;
                if (eff.stat !== 'attack') continue;
                if ((Number(eff.turnsLeft) || 0) <= 0) continue;
                return true;
            }
            return false;
        };

        const removeBloodlustBuff = () => {
            const effects = this.skillSystem && this.skillSystem.activeEffects;
            if (!effects || typeof effects.entries !== 'function') return;
            const toRemove = [];
            for (const [id, eff] of effects.entries()) {
                if (!eff) continue;
                if (eff.type !== 'buff') continue;
                if (eff.target !== playerId) continue;
                if (eff._itemPassiveId !== 'mace_bloodlust') continue;
                toRemove.push(id);
            }
            for (const id of toRemove) {
                effects.delete(id);
            }
            if (toRemove.length > 0 && this.skillSystem && typeof this.skillSystem.recalculateStats === 'function') {
                this.skillSystem.recalculateStats(playerId);
            }
        };

        const ensureBloodlustState = async () => {
            if (!isBloodlustCarrier()) return;
            const hp = Number(character?.stats?.health) || 0;
            const maxHp = Number(character?.stats?.maxHealth) || 0;
            if (maxHp <= 0) return;
            const below = hp / maxHp < 0.5;

            if (below) {
                if (!hasBloodlustBuff() && this.skillSystem && typeof this.skillSystem.applyBuff === 'function') {
                    await this.skillSystem.applyBuff(character, {
                        stat: 'attack',
                        mode: 'flat',
                        value: 2,
                        duration: 999
                    }, playerId);

                    // Tag the latest buff for cleanup and identification.
                    try {
                        const effects = this.skillSystem.activeEffects;
                        const ids = [];
                        for (const [id, eff] of effects.entries()) {
                            if (!eff) continue;
                            if (eff.type !== 'buff') continue;
                            if (eff.target !== playerId) continue;
                            if (eff.stat !== 'attack') continue;
                            if (eff.value !== 2) continue;
                            if ((Number(eff.turnsLeft) || 0) !== 999) continue;
                            if (eff._itemPassiveId) continue;
                            ids.push(id);
                        }
                        // Mark the most recent candidate.
                        if (ids.length > 0) {
                            const last = ids[ids.length - 1];
                            const eff = effects.get(last);
                            if (eff) {
                                eff._itemPassiveId = 'mace_bloodlust';
                                eff.name = 'Bloodlust';
                                eff.description = 'Gain +2 ATK while below 50% HP';
                            }
                        }
                    } catch (e) {}
                }
            } else {
                removeBloodlustBuff();
            }
        };

        const state = this.ensureState(character);

        const isBrokenSwordCarrier = () => {
            return Boolean(character && typeof character.itemId === 'string' && character.itemId === 'broken_sword');
        };

        const ensureBrokenSwordStartBonus = () => {
            if (!isBrokenSwordCarrier()) return;
            if (state._brokenSwordApplied) return;
            state._brokenSwordApplied = true;
            state._brokenSwordLost = 0;
            state._brokenSwordAppliedTurnCount = Number(this.gameState?.turnCount) || 0;
            this.applyPermanentStatDelta(playerId, { attack: 5 });
        };

        if (eventType === 'turn_start' || eventType === 'damage_taken') {
            await ensureBloodlustState();
        }

        if (eventType === 'turn_start') {
            ensureBrokenSwordStartBonus();
            if (isBrokenSwordCarrier()) {
                const nowTurn = Number(this.gameState?.turnCount) || 0;
                const appliedTurn = (state._brokenSwordAppliedTurnCount !== undefined && state._brokenSwordAppliedTurnCount !== null)
                    ? (Number(state._brokenSwordAppliedTurnCount) || 0)
                    : null;

                // Do not decay on the same turn the +5 is applied.
                // Game init triggers multiple turn_start events at turnCount=0, so we guard by turnCount.
                if (appliedTurn !== null && nowTurn === appliedTurn) {
                    // skip
                } else {
                    const lost = Math.max(0, Math.floor(Number(state._brokenSwordLost) || 0));
                    if (lost < 5) {
                        state._brokenSwordLost = lost + 1;
                        this.applyPermanentStatDelta(playerId, { attack: -1 });
                    }
                }
            }
        }

        if (eventType === 'skill_used') {
            await ensureBloodlustState();

            if (isBloodlustCarrier()) {
                const hpBefore = (payload && payload.hpBefore !== undefined) ? Number(payload.hpBefore) : (Number(character?.stats?.health) || 0);
                const maxHpBefore = (payload && payload.maxHpBefore !== undefined) ? Number(payload.maxHpBefore) : (Number(character?.stats?.maxHealth) || 0);
                const below = maxHpBefore > 0 ? (hpBefore / maxHpBefore < 0.5) : false;
                const isUltimate = payload && payload.skillType === 'ultimate';
                const isAttackSkill = payload && payload.skillType === 'attack';
                if (below && !isUltimate && isAttackSkill && this.skillSystem && typeof this.skillSystem.applyHealing === 'function') {
                    const curMax = Number(character?.stats?.maxHealth) || 0;
                    const amount = Math.max(1, Math.floor(curMax * 0.05));
                    await this.skillSystem.applyHealing(character, amount, playerId);
                }
            }

            // Pillow item passive: 10% chance to stun the enemy for 1 turn when using a utility skill.
            if (character && typeof character.itemId === 'string' && character.itemId === 'pillow') {
                const isUtility = payload && payload.skillType === 'utility';
                if (isUtility && this.skillSystem && typeof this.skillSystem.applyStun === 'function') {
                    const opponentId = playerId === 'player1' ? 'player2' : (playerId === 'player2' ? 'player1' : null);
                    const opponentChar = opponentId ? this.gameState?.players?.get(opponentId)?.character : null;
                    if (opponentId && opponentChar) {
                        state._pillowProcSeq = (Number(state._pillowProcSeq) || 0) + 1;
                        const skillId = payload && payload.skillId ? String(payload.skillId) : 'unknown';
                        const seed = `${this.gameState?.gameId || 'game'}:${this.gameState?.turnCount || 0}:${playerId}:pillow:${skillId}:${state._pillowProcSeq}`;
                        const rand = this.skillSystem && typeof this.skillSystem.deterministicRandom === 'function'
                            ? this.skillSystem.deterministicRandom(seed)
                            : Math.random();

                        if (rand < 0.1) {
                            await this.skillSystem.applyStun(opponentChar, 1, opponentId);
                        }
                    }
                }
            }
        }

        if (eventType === 'skill_used') {
            if (payload && payload.skillType === 'ultimate') {
                // Trafalgar Law: Room Surgeon counter resets when using ultimate.
                if (character.id === 'trafalgar_law' && character.passive && character.passive.id === 'room_surgeon') {
                    state.totalHealingDone = 0;
                }

                // Gojo Satoru: Blossoming Emotion recovery counter resets when using ultimate.
                if (character.id === 'gojo_satoru' && character.passive && character.passive.id === 'blossoming_emotion') {
                    state.totalHealingDone = 0;
                }
            }
            if (character.id === 'zero_two' && payload && payload.skillType === 'ultimate') {
                const turnCount = Number(this.gameState?.turnCount);
                if (Number.isFinite(turnCount)) {
                    state.zeroTwoUltUsedTurnCount = turnCount;
                }
            }
        }

        if (eventType === 'turn_end') {
            if (character.id === 'zero_two') {
                const turnCount = Number(this.gameState?.turnCount);
                const usedThisTurn = Number.isFinite(turnCount) && state.zeroTwoUltUsedTurnCount === turnCount;
                const ultimateReady = Boolean(player.ultimateReady);
                const canUseUltimate = (typeof this.gameState.canUseUltimateWithLimit === 'function')
                    ? this.gameState.canUseUltimateWithLimit(player)
                    : ultimateReady;

                if (ultimateReady && canUseUltimate && !usedThisTurn) {
                    state.zeroTwoUltBaseBonus = (Number(state.zeroTwoUltBaseBonus) || 0) + 0.1;
                }
            }
        }

        if (eventType === 'turn_start') {
            this.rollDevourSkill('player1');
            this.rollDevourSkill('player2');

            if (character.id === 'frieren') {
                const state = this.ensureState(character);
                const turnCount = Number(this.gameState?.turnCount);
                if (Number.isFinite(turnCount) && state.frierenRotatingSkillLastTurnCount === turnCount) {
                    return;
                }
                const allTypes = ['attack', 'buff', 'debuff', 'utility', 'stance', 'ultimate', 'domain'];

                const refillBag = () => {
                    const seedPrefix = `${this.gameState?.gameId || 'game'}:${this.gameState?.turnCount || 0}:${playerId}:frieren:rotate`;
                    const bag = allTypes.slice();
                    for (let i = bag.length - 1; i > 0; i--) {
                        const rand = this.skillSystem && typeof this.skillSystem.deterministicRandom === 'function'
                            ? this.skillSystem.deterministicRandom(`${seedPrefix}:${i}`)
                            : Math.random();
                        const j = Math.floor(rand * (i + 1));
                        const tmp = bag[i];
                        bag[i] = bag[j];
                        bag[j] = tmp;
                    }
                    state.frierenRotatingSkillBag = bag;
                };

                if (!Array.isArray(state.frierenRotatingSkillBag) || state.frierenRotatingSkillBag.length === 0) {
                    refillBag();
                }

                if (Array.isArray(state.frierenRotatingSkillBag) && state.frierenRotatingSkillBag.length > 0) {
                    state.frierenRotatingSkillCurrentType = state.frierenRotatingSkillBag.shift();
                } else {
                    state.frierenRotatingSkillCurrentType = 'attack';
                }

                if (Number.isFinite(turnCount)) {
                    state.frierenRotatingSkillLastTurnCount = turnCount;
                }
            }

            if (character.id === 'naofumi_iwatani') {
                const state = this.ensureState(character);
                const turnCount = Number(this.gameState?.turnCount);
                if (!Number.isFinite(turnCount)) return;

                if (this.gameState?.currentTurn !== playerId) {
                    return;
                }

                if (state.naofumiShieldLastTurnCount === turnCount) {
                    return;
                }
                state.naofumiShieldLastTurnCount = turnCount;

                if (!Array.isArray(state.naofumiShieldBag) || state.naofumiShieldBag.length === 0) {
                    state.naofumiShieldBag = ['leaf', 'chimera', 'prison', 'balloon', 'soul_eater'];
                }

                if (!Array.isArray(state.naofumiBaseSkillIds) || state.naofumiBaseSkillIds.length === 0) {
                    state.naofumiBaseSkillIds = ['naofumi_shield_bash', 'naofumi_defensive_stance'];
                }

                state.naofumiOwnTurnIndex = Math.max(0, Math.floor(Number(state.naofumiOwnTurnIndex) || 0)) + 1;

                if (state.naofumiCurrentShieldKey === 'transformation') {
                    state.naofumiTransformActive = true;
                }

                if (state.naofumiOwnTurnIndex === 1) {
                    state.naofumiCurrentShieldKey = 'legendary';
                } else if (state.naofumiOwnTurnIndex >= 7) {
                    state.naofumiCurrentShieldKey = 'transformation';
                } else if (state.naofumiCurrentShieldKey !== 'transformation') {
                    const seed = `${this.gameState?.gameId || 'game'}:${turnCount}:${playerId}:naofumi:shield`;
                    const rand = this.skillSystem && typeof this.skillSystem.deterministicRandom === 'function'
                        ? this.skillSystem.deterministicRandom(seed)
                        : Math.random();
                    const idx = Math.min(state.naofumiShieldBag.length - 1, Math.max(0, Math.floor(rand * state.naofumiShieldBag.length)));
                    const picked = state.naofumiShieldBag.splice(idx, 1)[0];
                    state.naofumiCurrentShieldKey = picked;
                }

                state.naofumiBalloonTurnCount = null;
                state.naofumiSoulEaterTurnCount = null;

                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                const opponentChar = this.gameState?.players?.get(opponentId)?.character;

                if (state.naofumiCurrentShieldKey === 'legendary' && !state.naofumiLegendaryBuffApplied) {
                    state.naofumiLegendaryBuffApplied = true;
                    if (this.skillSystem && typeof this.skillSystem.applyBuff === 'function') {
                        await this.skillSystem.applyBuff(character, { stat: 'defense', mode: 'flat', value: 7, duration: 999 }, playerId);
                        try {
                            const effects = this.skillSystem.activeEffects;
                            const ids = [];
                            for (const [id, eff] of effects.entries()) {
                                if (!eff) continue;
                                if (eff.type !== 'buff') continue;
                                if (eff.target !== playerId) continue;
                                if (eff.stat !== 'defense') continue;
                                if (eff.mode !== 'flat') continue;
                                if ((Number(eff.value) || 0) !== 7) continue;
                                if ((Number(eff.turnsLeft) || 0) !== 999) continue;
                                if (eff._naofumiShieldKey) continue;
                                ids.push(id);
                            }
                            if (ids.length > 0) {
                                const last = ids[ids.length - 1];
                                const eff = effects.get(last);
                                if (eff) {
                                    eff._naofumiShieldKey = 'legendary';
                                    eff.name = 'Legendary Shield';
                                    eff.description = '+7 DEF';
                                }
                            }
                        } catch (e) {}
                    }
                }

                if (state.naofumiCurrentShieldKey === 'leaf') {
                    if (this.skillSystem && typeof this.skillSystem.applyHealing === 'function') {
                        await this.skillSystem.applyHealing(character, 10, playerId);
                    }
                    if (this.skillSystem && typeof this.skillSystem.cleanse === 'function') {
                        await this.skillSystem.cleanse(character, playerId);
                    }
                }

                if (state.naofumiCurrentShieldKey === 'prison') {
                    if (opponentId && opponentChar) {
                        const immune = this.skillSystem && typeof this.skillSystem.isImmune === 'function'
                            ? this.skillSystem.isImmune(opponentId)
                            : false;
                        const concealed = this.skillSystem && typeof this.skillSystem.isConcealed === 'function'
                            ? this.skillSystem.isConcealed(opponentId)
                            : false;
                        if (!immune && !concealed && this.skillSystem && this.skillSystem.activeEffects && typeof this.skillSystem.activeEffects.set === 'function') {
                            const stunId = `stun_${opponentId}_${Date.now()}`;
                            this.skillSystem.activeEffects.set(stunId, {
                                type: 'stun',
                                target: opponentId,
                                ownerId: playerId,
                                characterId: opponentChar.id,
                                duration: 1,
                                turnsLeft: 1,
                                name: 'Stunned',
                                description: 'Cannot act for 1 turn'
                            });
                        }
                        if (this.skillSystem && typeof this.skillSystem.applyTrueDamageNoDomain === 'function') {
                            await this.skillSystem.applyTrueDamageNoDomain(opponentChar, 10, opponentId, playerId);
                        }
                    }
                }

                if (state.naofumiCurrentShieldKey === 'balloon') {
                    state.naofumiBalloonTurnCount = turnCount;
                }

                if (state.naofumiCurrentShieldKey === 'soul_eater') {
                    state.naofumiSoulEaterTurnCount = turnCount;
                    const cs = this.gameState?.characterSystem || this.skillSystem?.characterSystem;
                    if (cs && typeof cs.getSkill === 'function') {
                        try {
                            const s1 = await cs.getSkill('naofumi_undead_control');
                            const s2 = await cs.getSkill('naofumi_soul_eat');
                            if (s1 && s2) {
                                character.skills = [s2, s1];
                            }
                        } catch (e) {}
                    }
                }

                if (state.naofumiCurrentShieldKey === 'transformation') {
                    state.naofumiTransformActive = true;
                    state.naofumiTransformTurnCount = turnCount;
                    player.ultimateReady = true;
                    state.ultimateReady = true;
                }

                // Reset back to normal skills each turn unless Soul Eater shield is active.
                if (state.naofumiCurrentShieldKey !== 'soul_eater' && Array.isArray(state.naofumiBaseSkillIds)) {
                    const cs = this.gameState?.characterSystem || this.skillSystem?.characterSystem;
                    if (cs && typeof cs.getSkill === 'function') {
                        try {
                            const s1 = await cs.getSkill(state.naofumiBaseSkillIds[0]);
                            const s2 = await cs.getSkill(state.naofumiBaseSkillIds[1]);
                            if (s1 && s2) {
                                character.skills = [s1, s2];
                            }
                        } catch (e) {}
                    }
                }
            }
        }

        if (eventType === 'turn_end') {
            if (character.id === 'naofumi_iwatani') {
                const state = this.ensureState(character);
                const turnCount = Number(this.gameState?.turnCount);
                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                const opponentChar = this.gameState?.players?.get(opponentId)?.character;

                if (state.naofumiCurrentShieldKey === 'transformation') {
                    state.naofumiTransformTrueDamage = Math.max(0, Math.floor(Number(state.naofumiTransformTrueDamage) || 0)) + 1;
                    if (this.skillSystem && typeof this.skillSystem.applyTrueDamageNoDomain === 'function') {
                        await this.skillSystem.applyTrueDamageNoDomain(character, state.naofumiTransformTrueDamage, playerId, null);
                    }
                }

                // Soul Eater skills last only for that one turn.
                if (Number.isFinite(turnCount) && Number(state.naofumiSoulEaterTurnCount) === turnCount) {
                    const cs = this.gameState?.characterSystem || this.skillSystem?.characterSystem;
                    if (cs && typeof cs.getSkill === 'function') {
                        try {
                            const baseIds = Array.isArray(state.naofumiBaseSkillIds) ? state.naofumiBaseSkillIds : null;
                            const b1 = baseIds && typeof baseIds[0] === 'string' ? baseIds[0] : 'naofumi_shield_bash';
                            const b2 = baseIds && typeof baseIds[1] === 'string' ? baseIds[1] : 'naofumi_defensive_stance';
                            const s1 = await cs.getSkill(b1);
                            const s2 = await cs.getSkill(b2);
                            if (s1 && s2) {
                                character.skills = [s1, s2];
                            }
                        } catch (e) {}
                    }
                }
            }
        }

        if (eventType === 'skill_used') {
            if (character.id === 'naofumi_iwatani') {
                const state = this.ensureState(character);
                const turnCount = Number(this.gameState?.turnCount);
                if (Number.isFinite(turnCount) && Number(state.naofumiSoulEaterTurnCount) === turnCount) {
                    const maxHp = Number(character?.stats?.maxHealth) || 0;
                    const heal = Math.max(1, Math.floor(maxHp * 0.03));
                    if (heal > 0 && this.skillSystem && typeof this.skillSystem.applyHealing === 'function') {
                        await this.skillSystem.applyHealing(character, heal, playerId);
                    }
                }
            }
        }

        if (eventType === 'damage_taken_enemy_skill') {
            if (character.id === 'naofumi_iwatani') {
                const state = this.ensureState(character);
                const attackerId = payload && payload.attackerId ? String(payload.attackerId) : null;
                const enemy = attackerId ? this.gameState?.players?.get(attackerId)?.character : null;
                if (state.naofumiCurrentShieldKey === 'chimera' && enemy && this.skillSystem && typeof this.skillSystem.applyTrueDamageNoDomain === 'function') {
                    const dmg = Math.max(0, Math.floor(Number(enemy?.stats?.attack) || 0));
                    if (dmg > 0) {
                        await this.skillSystem.applyTrueDamageNoDomain(enemy, dmg, attackerId, playerId);
                    }
                }
            }
        }

        if (eventType === 'healing_done') {
            const mission = this.getMission(character);
            if (mission && mission.type === 'total_healing_done') {
                // Gojo's Blossoming Emotion should only charge from opponent healing, not self healing.
                if (character.id === 'gojo_satoru' && character.passive && character.passive.id === 'blossoming_emotion') {
                    return;
                }
            }
            if (mission && mission.type === 'total_healing_done') {
                // Trafalgar Law: cap at threshold and do not overflow until ultimate is used.
                if (character.id === 'trafalgar_law' && character.passive && character.passive.id === 'room_surgeon') {
                    const cap = Number(mission.value) || 80;
                    const current = Number(state.totalHealingDone) || 0;
                    const next = Math.min(cap, current + (Number(payload.amount) || 0));
                    state.totalHealingDone = next;
                    this.updateUltimateReady(playerId);
                    return;
                }
            }

            state.totalHealingDone = (Number(state.totalHealingDone) || 0) + (Number(payload.amount) || 0);
            this.updateUltimateReady(playerId);
            return;
        }

        if (eventType === 'opponent_healing_done') {
            // Gojo Glasses item passive: when your opponent recovers health, gain that much ATK as a buff for 1 turn.
            // Must run BEFORE mission logic returns early (e.g., Gojo's Blossoming Emotion).
            if (character && typeof character.itemId === 'string' && character.itemId === 'gojo_satoru_glasses') {
                const amount = Math.max(0, Math.floor(Number(payload?.amount) || 0));
                const targetId = typeof payload?.targetId === 'string' ? payload.targetId : null;
                if (amount > 0 && targetId && targetId !== playerId && this.skillSystem && typeof this.skillSystem.applyBuff === 'function') {
                    await this.skillSystem.applyBuff(character, {
                        stat: 'attack',
                        mode: 'flat',
                        value: amount,
                        duration: 1
                    }, playerId);
                }
            }

            const mission = this.getMission(character);
            if (mission && mission.type === 'total_healing_done') {
                // Trafalgar Law: should never charge from opponent healing (prevents Law vs Law mirror bug).
                if (character.id === 'trafalgar_law' && character.passive && character.passive.id === 'room_surgeon') {
                    return;
                }
                // Special-case: Gojo's Blossoming Emotion should not charge while his domain ultimate is active.
                // Also cap progress at the mission threshold.
                if (character.id === 'gojo_satoru' && character.passive && character.passive.id === 'blossoming_emotion') {
                    const effects = this.skillSystem && this.skillSystem.activeEffects;
                    let gojoDomainActive = false;

                    if (effects && typeof effects.entries === 'function') {
                        for (const [, eff] of effects.entries()) {
                            if (
                                eff &&
                                eff.type === 'array_domain' &&
                                eff.ownerId === playerId &&
                                (Number(eff.turnsLeft) || 0) > 0
                            ) {
                                gojoDomainActive = true;
                                break;
                            }
                        }
                    }

                    if (gojoDomainActive) {
                        return;
                    }

                    const cap = Number(mission.value) || 50;
                    const current = Number(state.totalHealingDone) || 0;
                    const next = Math.min(cap, current + (Number(payload.amount) || 0));
                    state.totalHealingDone = next;
                    this.updateUltimateReady(playerId);
                    return;
                }

                state.totalHealingDone = (Number(state.totalHealingDone) || 0) + (Number(payload.amount) || 0);
                this.updateUltimateReady(playerId);
                return;
            }
        }

        if (eventType === 'opponent_buff_applied' || eventType === 'opponent_skill_used') {
            // handled by data-driven heartbreak_meter effects below
        }

        const effects = Array.isArray(character.passive.effects) ? character.passive.effects : [];
        for (const eff of effects) {
            if (!eff || eff.timing !== eventType) continue;

            if (eff.type === 'grant_ultimate_once') {
                const key = typeof eff.stateKey === 'string' && eff.stateKey ? eff.stateKey : 'grantUltimateOnceUsed';
                if (state[key]) {
                    continue;
                }
                state[key] = true;
                state.ultimateReady = true;
                player.ultimateReady = true;
            }

            if (eff.type === 'cooldown_reduction_random_other_skill') {
                if (eventType !== 'skill_used') continue;
                const usedSkillId = payload && payload.skillId ? String(payload.skillId) : null;
                if (!usedSkillId) continue;

                const amount = Math.max(1, Math.floor(Number(eff.amount) || 1));
                const seed = `${this.gameState?.gameId || 'game'}:${this.gameState?.turnCount || 0}:${playerId}:cdr:${usedSkillId}:passive`;
                if (this.skillSystem && typeof this.skillSystem.applyCooldownReductionToRandomOtherSkill === 'function') {
                    this.skillSystem.applyCooldownReductionToRandomOtherSkill(playerId, usedSkillId, { amount, seed });
                }
            }

            if (eff.type === 'heartbreak_meter') {
                const key = eff.counter || 'heartbreak';
                const gain = Math.max(0, Math.floor(Number(eff.gain) || 0));
                const perAmount = Number(eff.perAmount) || 0;

                let delta = gain;
                if (eff.gainBySkillType && payload && typeof payload.skillType === 'string') {
                    const mapped = eff.gainBySkillType[payload.skillType];
                    delta = Math.max(0, Math.floor(Number(mapped) || 0));
                }
                if (perAmount > 0) {
                    delta = Math.max(0, Math.floor((Number(payload.amount) || 0) * perAmount));
                }

                if (delta > 0) {
                    const max = typeof eff.max === 'number' ? eff.max : null;
                    this.addCounter(character, key, delta, 0, max);
                    this.updateUltimateReady(playerId);
                }
            }

            if (eff.type === 'stacking_stat_buff') {
                const beforeStacks = Number(state.counters[eff.stackKey]) || 0;
                const afterStacks = this.addCounter(character, eff.stackKey, eff.gainPerTrigger || 1, 0, eff.maxStacks);
                const gained = afterStacks - beforeStacks;

                if (eff.statsPerStack && gained !== 0) {
                    const deltas = {};
                    for (const [stat, per] of Object.entries(eff.statsPerStack)) {
                        deltas[stat] = (Number(per) || 0) * gained;
                    }
                    this.applyPermanentStatDelta(playerId, deltas);
                }

                if (eff.grantUltimateAtMax && afterStacks >= eff.maxStacks) {
                    if (eff.resetStacksOnGrant) {
                        // If stacks are being reset/consumed, remove the accumulated per-stack stat gains too.
                        if (eff.statsPerStack && afterStacks > 0) {
                            const deltas = {};
                            for (const [stat, per] of Object.entries(eff.statsPerStack)) {
                                deltas[stat] = (Number(per) || 0) * (-afterStacks);
                            }
                            this.applyPermanentStatDelta(playerId, deltas);
                        }

                        this.resetCounter(character, eff.stackKey);
                    }
                    state.ultimateReady = true;
                    player.ultimateReady = true;
                }

                this.updateUltimateReady(playerId);
            }

            if (eff.type === 'permanent_stack_growth') {
                const stacks = this.addCounter(character, eff.stackKey, eff.gainPerTrigger || 1, 0, eff.maxStacks);
                const deltas = {};

                if (eff.perStack) {
                    for (const [stat, per] of Object.entries(eff.perStack)) {
                        deltas[stat] = (Number(per) || 0);
                    }
                }

                this.applyPermanentStatDelta(playerId, deltas);
                this.updateUltimateReady(playerId);
            }

            if (eff.type === 'convert_stacks') {
                const sourceKey = eff.sourceCounter;
                const targetKey = eff.targetCounter;
                const cost = Math.max(1, Math.floor(Number(eff.sourceCost) || 0));
                if (!sourceKey || !targetKey || !Number.isFinite(cost) || cost <= 0) {
                    continue;
                }

                const current = Number(state.counters[sourceKey]) || 0;
                if (current < cost) {
                    continue;
                }

                const conversions = Math.floor(current / cost);
                if (conversions <= 0) {
                    continue;
                }

                state.counters[sourceKey] = current - (conversions * cost);
                const prevTarget = Number(state.counters[targetKey]) || 0;
                state.counters[targetKey] = prevTarget + conversions;

                if (eff.grantUltimate) {
                    player.ultimateReady = true;
                }
            }

            if (eff.type === 'permanent_stack_loss') {
                if (eff.disableAfterUltimateReady && state.ultimateReady) {
                    continue;
                }

                const before = Number(state.counters[eff.stackKey]) || 0;
                if (before <= (eff.minStacks || 0)) {
                    continue;
                }

                this.addCounter(character, eff.stackKey, -(eff.losePerTrigger || 1), eff.minStacks || 0, null);

                const deltas = {
                    attack: -1,
                    defense: -1,
                    maxHealth: -1,
                    currentHealth: -1
                };

                this.applyPermanentStatDelta(playerId, deltas);
                this.updateUltimateReady(playerId);
            }

            if (eff.type === 'heal_on_damage_dealt') {
                const healValue = Number(eff.heal_value) || 0;
                if (healValue <= 0) continue;

                const healTarget = character;
                const amount = Math.max(1, Math.ceil((Number(healTarget.stats.maxHealth) || 0) * healValue));
                this.skillSystem.applyHealing(healTarget, amount, playerId);
            }

            if (eff.type === 'permanent_stat_delta') {
                const deltas = eff.deltas || eff.stats;
                if (deltas && typeof deltas === 'object') {
                    this.applyPermanentStatDelta(playerId, deltas);
                    this.updateUltimateReady(playerId);
                }
            }

            if (eff.type === 'counter_growth') {
                const key = eff.stackKey || eff.counter;
                if (!key) continue;
                this.addCounter(character, key, eff.gainPerTrigger || 1, 0, eff.maxStacks);
            }

            if (eff.type === 'heal_opponent_flat') {
                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                const opponent = this.gameState.players.get(opponentId);
                if (!opponent || !opponent.character) continue;

                const amount = Math.max(0, Math.floor(Number(eff.amount) || 0));
                if (amount <= 0) continue;

                await this.skillSystem.applyHealing(opponent.character, amount, opponentId);
            }

            if (eff.type === 'sage_orbs') {
                const key = eff.counter || 'sageOrbs';
                const max = typeof eff.max === 'number' ? eff.max : null;

                if (eventType === 'skill_used') {
                    const skillId = payload && payload.skillId ? String(payload.skillId) : null;
                    if (!skillId) continue;

                    const onlyDifferent = Boolean(eff.onlyWhenDifferentSkill);
                    if (onlyDifferent && state.lastSkillId && state.lastSkillId === skillId) {
                        continue;
                    }

                    const before = Number(state.counters[key]) || 0;
                    const after = this.addCounter(character, key, 1, 0, max);

                    state.lastSkillId = skillId;

                    const gained = Math.max(0, after - before);
                    const perAtk = Math.floor(Number(eff.permanentAttackPerOrbGained) || 0);
                    if (gained > 0 && perAtk > 0) {
                        this.applyPermanentStatDelta(playerId, { attack: perAtk * gained });
                    }

                    this.updateUltimateReady(playerId);
                }

                if (eventType === 'turn_start') {
                    const orbs = Number(state.counters[key]) || 0;
                    const healPer = Math.floor(Number(eff.healPerOrb) || 0);
                    const amount = Math.max(0, orbs * Math.max(0, healPer));
                    if (amount > 0) {
                        await this.skillSystem.applyHealing(character, amount, playerId);
                    }
                }
            }

            if (eff.type === 'balance_meter') {
                if (eventType !== 'skill_used') continue;

                const skillId = payload && payload.skillId ? String(payload.skillId) : null;
                if (!skillId) continue;

                const key = eff.counter || 'balance';
                const min = (typeof eff.min === 'number') ? eff.min : -3;
                const max = (typeof eff.max === 'number') ? eff.max : 3;

                const before = Number(state.counters[key]) || 0;

                let delta = Math.floor(Number(eff.delta) || 0);
                if (eff.deltaBySkillId && typeof eff.deltaBySkillId === 'object') {
                    const mapped = eff.deltaBySkillId[skillId];
                    if (mapped !== undefined) {
                        delta = Math.floor(Number(mapped) || 0);
                    }
                }

                if (delta !== 0) {
                    const after = this.addCounter(character, key, delta, min, max);

                    // Naruto: Balance -3 shield should only persist while you remain at -3.
                    if (before === -3 && after !== -3) {
                        if (character && character.stats) {
                            character.stats.shield = 0;
                            character.stats.maxShield = 0;
                        }
                    }

                    // Naruto: while at Balance +3, grant a +10 ATK buff (blue). Remove when leaving +3.
                    if (this.skillSystem && this.skillSystem.activeEffects) {
                        const balanceAtkBuffId = `balance_plus3_attack_${playerId}`;
                        if (after === 3) {
                            const existing = this.skillSystem.activeEffects.get(balanceAtkBuffId);
                            if (!existing) {
                                this.skillSystem.activeEffects.set(balanceAtkBuffId, {
                                    type: 'buff',
                                    target: playerId,
                                    characterId: character.id,
                                    stat: 'attack',
                                    value: 10,
                                    mode: 'flat',
                                    duration: 9999,
                                    turnsLeft: 9999,
                                    name: 'Balance',
                                    description: 'Attack increased by 10 while at Balance +3'
                                });
                                if (this.skillSystem && typeof this.skillSystem.recalculateStats === 'function') {
                                    this.skillSystem.recalculateStats(playerId);
                                }
                            }
                        } else {
                            if (this.skillSystem.activeEffects.has(balanceAtkBuffId)) {
                                this.skillSystem.activeEffects.delete(balanceAtkBuffId);
                                if (this.skillSystem && typeof this.skillSystem.recalculateStats === 'function') {
                                    this.skillSystem.recalculateStats(playerId);
                                }
                            }
                        }
                    }

                    const shieldOnValue = (typeof eff.shieldOnValue === 'number') ? eff.shieldOnValue : null;
                    const shieldAmount = Math.max(0, Math.floor(Number(eff.shieldAmount) || 0));
                    if (shieldOnValue !== null && shieldAmount > 0 && after === shieldOnValue && before !== shieldOnValue) {
                        if (this.skillSystem && typeof this.skillSystem.applyShield === 'function') {
                            await this.skillSystem.applyShield(character, shieldAmount, playerId);
                        }
                    }
                    this.updateUltimateReady(playerId);
                }
            }

            if (eff.type === 'spell_archive_pages') {
                if (eventType !== 'opponent_skill_used') continue;

                const maxPages = typeof eff.maxPages === 'number' ? eff.maxPages : 5;
                const counterKey = eff.counter || 'archivePages';
                const type = payload && typeof payload.skillType === 'string' ? payload.skillType : null;
                if (!type) continue;

                character.passiveState.archiveLastPageType = type;

                const pages = Array.isArray(character.passiveState.archivePages)
                    ? character.passiveState.archivePages
                    : (character.passiveState.archivePages = []);

                pages.push(type);
                while (pages.length > maxPages) pages.shift();

                state.counters[counterKey] = pages.length;
                this.updateUltimateReady(playerId);
            }
        }
    }
}
