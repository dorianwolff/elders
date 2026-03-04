class SkillSystem {
    constructor() {
        this.activeEffects = new Map();
        this.skillCooldowns = new Map();
        this._animationSinkStack = [];
        this._combatTextSeqStack = [];
        this._actionContextStack = [];
        this._cooldownsSkipNextDecrement = new Set();
    }

    getCooldownReductionStackKeyForSkill(skillId) {
        return `cdr_${skillId}`;
    }

    getCooldownReductionStacksForSkill(playerId, skillId) {
        const key = this.getCooldownReductionStackKeyForSkill(skillId);
        return Math.max(0, Math.floor(this.getCounterValue(playerId, key)));
    }

    setCooldownReductionStacksForSkill(playerId, skillId, stacks) {
        const key = this.getCooldownReductionStackKeyForSkill(skillId);
        const next = Math.max(0, Math.floor(Number(stacks) || 0));
        this.setCounterValue(playerId, key, next);
    }

    applyCooldownReductionToRandomOtherSkill(playerId, excludeSkillId, options = {}) {
        const player = this.gameState?.players?.get(playerId);
        if (!player || !player.character) return null;

        const character = player.character;
        const skills = Array.isArray(character.skills) ? character.skills : [];
        const ultimate = character.ultimate;
        const list = [];

        for (const s of skills) {
            if (s && typeof s.id === 'string') {
                list.push({ kind: 'skill', skill: s });
            }
        }
        if (ultimate && typeof ultimate.id === 'string') {
            list.push({ kind: 'ultimate', skill: ultimate });
        }

        const amount = Math.max(1, Math.floor(Number(options.amount) || 1));
        const seed = typeof options.seed === 'string' ? options.seed : null;

        const eligible = [];
        for (const item of list) {
            const s = item.skill;
            if (!s || !s.id) continue;
            if (excludeSkillId && s.id === excludeSkillId) continue;

            const remaining = this.getSkillCooldown({ id: s.id }, playerId);
            const buffCfg = s.cooldownReductionBuff && typeof s.cooldownReductionBuff === 'object'
                ? s.cooldownReductionBuff
                : null;
            const canBuff = Boolean(buffCfg);
            if (remaining > 0 || canBuff) {
                eligible.push({ item, remaining, buffCfg });
            }
        }

        if (eligible.length === 0) return null;

        const rand = (seed && typeof this.deterministicRandom === 'function')
            ? this.deterministicRandom(seed)
            : Math.random();
        const index = Math.min(eligible.length - 1, Math.floor(rand * eligible.length));
        const picked = eligible[index];
        const pickedSkill = picked.item.skill;

        if (picked.remaining > 0) {
            const nextCd = Math.max(0, picked.remaining - amount);
            this.setSkillCooldown(pickedSkill.id, playerId, nextCd);
        }

        if (picked.buffCfg) {
            const maxStacks = (typeof picked.buffCfg.maxStacks === 'number')
                ? Math.max(0, Math.floor(picked.buffCfg.maxStacks))
                : null;
            const cur = this.getCooldownReductionStacksForSkill(playerId, pickedSkill.id);
            const next = maxStacks === null ? (cur + amount) : Math.min(maxStacks, cur + amount);
            this.setCooldownReductionStacksForSkill(playerId, pickedSkill.id, next);
        }

        return { skillId: pickedSkill.id };
    }

    resolveSkillDisplayForCaster(caster, skillId) {
        if (!caster || !skillId) return null;
        const skills = Array.isArray(caster.skills) ? caster.skills : [];
        const s = skills.find(x => x && x.id === skillId);
        if (!s) return null;
        const name = typeof s.name === 'string' ? s.name : null;
        const description = typeof s.description === 'string' ? s.description : null;
        if (!name || !description) return null;
        return { name, description };
    }

    resolveUltimateDisplayForCaster(caster) {
        const u = caster?.ultimate;
        const name = typeof u?.name === 'string' ? u.name : null;
        const description = typeof u?.description === 'string' ? u.description : null;
        if (!name || !description) return null;
        return { name, description };
    }

    getOpponentId(playerId) {
        if (playerId === 'player1') return 'player2';
        if (playerId === 'player2') return 'player1';
        return null;
    }

    getSkillCooldownKey(skillId, playerId) {
        return `${playerId}:${skillId}`;
    }

    getSkillCooldown(skill, playerId) {
        const skillId = skill && typeof skill.id === 'string' ? skill.id : null;
        if (!skillId) return 0;
        if (playerId !== 'player1' && playerId !== 'player2') return 0;
        const key = this.getSkillCooldownKey(skillId, playerId);
        return Math.max(0, Math.floor(Number(this.skillCooldowns.get(key)) || 0));
    }

    setSkillCooldown(skillId, playerId, cooldown) {
        if (!skillId || (playerId !== 'player1' && playerId !== 'player2')) return;
        const key = this.getSkillCooldownKey(skillId, playerId);
        const next = Math.max(0, Math.floor(Number(cooldown) || 0));
        this.skillCooldowns.set(key, next);
    }

    setSkillCooldownFromUse(skillId, playerId, cooldown) {
        this.setSkillCooldown(skillId, playerId, cooldown);
    }

    decrementCooldowns(playerId) {
        if (playerId !== 'player1' && playerId !== 'player2') return;

        const prefix = `${playerId}:`;
        for (const [key, value] of this.skillCooldowns.entries()) {
            if (typeof key !== 'string' || !key.startsWith(prefix)) continue;
            const cur = Math.max(0, Math.floor(Number(value) || 0));
            if (cur <= 0) continue;
            this.skillCooldowns.set(key, cur - 1);
        }
    }

    canUseSkill(skill, playerId) {
        const remaining = this.getSkillCooldown(skill, playerId);
        return remaining <= 0;
    }

    getActiveEffectsForPlayer(playerId) {
        if (playerId !== 'player1' && playerId !== 'player2') return [];
        const list = [];
        for (const [, effect] of this.activeEffects.entries()) {
            if (!effect) continue;
            if (effect.target !== playerId) continue;
            if (typeof effect.turnsLeft === 'number' && effect.turnsLeft <= 0) continue;
            list.push(effect);
        }
        return list;
    }

    getActiveActionContext() {
        return this._actionContextStack.length > 0
            ? this._actionContextStack[this._actionContextStack.length - 1]
            : null;
    }

    async withActionContext(ctx, fn) {
        this._actionContextStack.push(ctx || null);
        try {
            return await fn();
        } finally {
            try {
                const active = this.getActiveActionContext();
                // Apply "after the full action" reactions before popping the context.
                // Naruto: Yin Serenity => after taking damage during this action, gain a shield equal to a ratio of total damage taken.
                if (active && active._damageTakenByTarget && typeof active._damageTakenByTarget === 'object') {
                    const attackerId = typeof active.attackerId === 'string' ? active.attackerId : null;
                    for (const [victimId, totalTakenRaw] of Object.entries(active._damageTakenByTarget)) {
                        const victimPlayerId = String(victimId);
                        const totalTaken = Math.max(0, Math.floor(Number(totalTakenRaw) || 0));
                        if (totalTaken <= 0) continue;
                        if (!attackerId || attackerId === victimPlayerId) continue;
                        if (victimPlayerId !== 'player1' && victimPlayerId !== 'player2') continue;

                        let stance = null;
                        for (const [, eff] of this.activeEffects.entries()) {
                            if (
                                eff &&
                                eff.type === 'stance' &&
                                eff.target === victimPlayerId &&
                                (eff.stanceKey === 'yin_serenity' || eff.key === 'yin_serenity') &&
                                (Number(eff.turnsLeft) || 0) > 0
                            ) {
                                stance = eff;
                                break;
                            }
                        }

                        if (stance) {
                            const ratio = Number(stance.shieldRatioOnDamage);
                            const shieldRatio = Number.isFinite(ratio) ? Math.max(0, ratio) : 0;
                            const amount = Math.max(0, Math.floor(totalTaken * shieldRatio));
                            if (amount > 0) {
                                const victim = this.getPlayerById(victimPlayerId);
                                if (victim) {
                                    await this.applyShield(victim, amount, victimPlayerId);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('Post-action reactions failed:', e);
            }
            this._actionContextStack.pop();
        }
    }

    getPassiveHeartbreakConfig(character) {
        const passive = character?.passive;
        const effects = Array.isArray(passive?.effects) ? passive.effects : [];
        const hb = effects.find(e => e && e.type === 'heartbreak_meter' && e.timing === 'opponent_skill_used');
        if (!hb) return null;
        return {
            max: (typeof hb.max === 'number') ? hb.max : null,
            gainBySkillType: hb.gainBySkillType || null
        };
    }

    getHeartbreakGainForSkillType(character, skillType) {
        const cfg = this.getPassiveHeartbreakConfig(character);
        const map = cfg?.gainBySkillType;
        if (!map || typeof skillType !== 'string') return 0;
        return Math.max(0, Math.floor(Number(map[skillType]) || 0));
    }

    getArchivePages(playerId) {
        const player = this.gameState?.players?.get(playerId);
        const state = player?.character?.passiveState;
        if (!state) return [];
        if (!Array.isArray(state.archivePages)) state.archivePages = [];
        return state.archivePages;
    }

    getArchiveLastPageType(playerId) {
        const player = this.gameState?.players?.get(playerId);
        const state = player?.character?.passiveState;
        const t = state?.archiveLastPageType;
        return typeof t === 'string' ? t : null;
    }

    consumeArchivePages(playerId, count) {
        const n = Math.max(0, Math.floor(Number(count) || 0));
        if (n <= 0) return 0;

        const pages = this.getArchivePages(playerId);
        const removed = Math.min(n, pages.length);
        if (removed <= 0) return 0;

        pages.splice(0, removed);

        const player = this.gameState?.players?.get(playerId);
        if (player?.character?.passiveState?.counters) {
            player.character.passiveState.counters.archivePages = pages.length;
        }
        if (this.passiveSystem && typeof this.passiveSystem.updateUltimateReady === 'function') {
            this.passiveSystem.updateUltimateReady(playerId);
        }
        return removed;
    }

    addArchivePage(playerId, pageType, maxPages = 5) {
        const player = this.gameState?.players?.get(playerId);
        const state = player?.character?.passiveState;
        if (!state) return;
        if (!Array.isArray(state.archivePages)) state.archivePages = [];

        const type = typeof pageType === 'string' ? pageType : null;
        if (!type) return;

        state.archiveLastPageType = type;
        state.archivePages.push(type);
        while (state.archivePages.length > maxPages) state.archivePages.shift();

        if (state.counters) {
            state.counters.archivePages = state.archivePages.length;
        }
        if (this.passiveSystem && typeof this.passiveSystem.updateUltimateReady === 'function') {
            this.passiveSystem.updateUltimateReady(playerId);
        }
    }

    hasCopycatGlyph(playerId) {
        for (const [, eff] of this.activeEffects.entries()) {
            if (
                eff &&
                eff.type === 'copycat_glyph' &&
                eff.target === playerId &&
                (Number(eff.turnsLeft) || 0) > 0
            ) {
                return true;
            }
        }
        return false;
    }

    consumeCopycatGlyph(playerId) {
        let removed = false;
        for (const [id, eff] of this.activeEffects.entries()) {
            if (
                eff &&
                eff.type === 'copycat_glyph' &&
                eff.target === playerId
            ) {
                this.activeEffects.delete(id);
                removed = true;
                break;
            }
        }
        return removed;
    }

    async applyHealBlock(targetPlayerId, duration) {
        const turnsLeft = Math.max(1, Math.floor(Number(duration) || 1));
        const ctx = this.getActiveActionContext();
        const ownerId = ctx && (ctx.attackerId === 'player1' || ctx.attackerId === 'player2')
            ? ctx.attackerId
            : (this.gameState?.currentTurn === 'player1' || this.gameState?.currentTurn === 'player2'
                ? this.gameState.currentTurn
                : null);
        const id = `heal_block_${targetPlayerId}_${Date.now()}`;
        this.activeEffects.set(id, {
            type: 'debuff',
            key: 'heal_block',
            target: targetPlayerId,
            ownerId,
            duration: turnsLeft,
            turnsLeft,
            name: 'Heal Block',
            description: 'Cannot be healed'
        });
    }

    isHealBlocked(playerId) {
        for (const [, eff] of this.activeEffects.entries()) {
            if (
                eff &&
                eff.type === 'debuff' &&
                eff.key === 'heal_block' &&
                eff.target === playerId &&
                (Number(eff.turnsLeft) || 0) > 0
            ) {
                return true;
            }
        }
        return false;
    }

    removeStanceEffects(targetPlayerId) {
        if (!targetPlayerId) return 0;
        const toRemove = [];
        for (const [id, eff] of this.activeEffects.entries()) {
            if (!eff || eff.target !== targetPlayerId) continue;

            const key = typeof eff.key === 'string' ? eff.key : null;
            const stat = typeof eff.stat === 'string' ? eff.stat : null;
            if (eff.type === 'stance' || key === 'stance' || stat === 'stance') {
                toRemove.push(id);
            }
        }

        for (const id of toRemove) {
            this.activeEffects.delete(id);
        }

        if (toRemove.length > 0) {
            this.recalculateStats(targetPlayerId);
        }

        return toRemove.length;
    }

    pushAnimationSink(sink) {
        this._animationSinkStack.push(sink);
        this._combatTextSeqStack.push(new Map());
    }

    popAnimationSink() {
        if (this._animationSinkStack.length > 0) this._animationSinkStack.pop();
        if (this._combatTextSeqStack.length > 0) this._combatTextSeqStack.pop();
    }

    getActiveAnimationSink() {
        if (!this._animationSinkStack.length) return null;
        return this._animationSinkStack[this._animationSinkStack.length - 1];
    }

    getActiveCombatTextSeqMap() {
        if (!this._combatTextSeqStack.length) return null;
        return this._combatTextSeqStack[this._combatTextSeqStack.length - 1];
    }

    emitCombatText(kind, amount, targetPlayerId, delayMs = null) {
        const sink = this.getActiveAnimationSink();
        if (!sink || !Array.isArray(sink)) return;

        const n = Math.max(0, Math.floor(Number(amount) || 0));
        if (n <= 0) return;
        if (targetPlayerId !== 'player1' && targetPlayerId !== 'player2') return;
        if (kind !== 'damage' && kind !== 'heal') return;

        let finalDelay = delayMs;
        if (finalDelay === null || finalDelay === undefined) {
            const seq = this.getActiveCombatTextSeqMap();
            const key = `${targetPlayerId}:${kind}`;
            const idx = seq ? (Number(seq.get(key)) || 0) : 0;
            if (seq) seq.set(key, idx + 1);
            finalDelay = idx * 140;
        }

        sink.push({
            type: 'combat_text',
            kind,
            amount: n,
            targetPlayerId,
            delayMs: Math.max(0, Math.floor(Number(finalDelay) || 0))
        });
    }

    decrementNonDotDurationsForPlayer(playerId) {
        const effectsToRemove = [];

        for (const [effectId, effect] of this.activeEffects.entries()) {
            if (!effect || effect.target !== playerId) continue;

            if (effect && effect._skipNextDecrement) {
                effect._skipNextDecrement = false;
                continue;
            }

            // DoTs tick at end of the affected player's own turn.
            if (effect.type === 'poison' || effect.type === 'curse') continue;

            // Stances tick on enemy turns (handled in processStartOfTurnEffects)
            if (effect.type === 'stance') continue;

            // Decrement timed effects (buff/debuff/stun/mark/conceal/immunity/evade/etc.)
            if (typeof effect.turnsLeft === 'number') {
                effect.turnsLeft--;
                if (effect.turnsLeft <= 0) {
                    effectsToRemove.push(effectId);
                }
            }
        }

        effectsToRemove.forEach(id => this.activeEffects.delete(id));
        if (effectsToRemove.length > 0) {
            this.recalculateStats(playerId);
        }
    }

    async processStartOfTurnEffects(playerId) {
        if (playerId !== 'player1' && playerId !== 'player2') return;

        const toRemove = [];
        const toRecalc = new Set();

        for (const [effectId, effect] of this.activeEffects.entries()) {
            if (!effect || effect.type !== 'stance') continue;

            const targetId = effect.target;
            if (targetId !== 'player1' && targetId !== 'player2') continue;

            const stanceTurnsLeft = Math.max(0, Math.floor(Number(effect.turnsLeft) || 0));
            if (stanceTurnsLeft <= 0) {
                toRemove.push(effectId);
                continue;
            }

            if (targetId === playerId) {
                const healAmount = Math.max(0, Math.floor(Number(effect.healOnTurnStart) || 0));
                if (healAmount > 0) {
                    const character = this.getPlayerById(playerId);
                    if (character) {
                        await this.applyHealing(character, healAmount, playerId);
                    }
                }

                effect.turnsLeft = stanceTurnsLeft - 1;
                if (effect.turnsLeft <= 0) {
                    toRemove.push(effectId);
                    toRecalc.add(playerId);
                }
            }
        }

        for (const id of toRemove) {
            this.activeEffects.delete(id);
        }

        for (const pid of toRecalc) {
            this.recalculateStats(pid);
        }
    }

    decrementNonDotDurationsForOwner(ownerId) {
        if (ownerId !== 'player1' && ownerId !== 'player2') return;

        const effectsToRemove = [];
        const targetsToRecalc = new Set();

        for (const [effectId, effect] of this.activeEffects.entries()) {
            if (!effect) continue;
            if (effect.target !== 'player1' && effect.target !== 'player2') continue;
            if (effect.type === 'poison' || effect.type === 'curse' || effect.type === 'bleed') continue;
            if (effect.type === 'stance') continue;

            const effOwner = typeof effect.ownerId === 'string' ? effect.ownerId : null;
            if (effOwner !== ownerId) continue;

            if (effect && effect._skipNextDecrement) {
                effect._skipNextDecrement = false;
                continue;
            }

            if (typeof effect.turnsLeft === 'number') {
                effect.turnsLeft--;
                if (effect.turnsLeft <= 0) {
                    effectsToRemove.push(effectId);
                    targetsToRecalc.add(effect.target);
                }
            }
        }

        for (const id of effectsToRemove) {
            this.activeEffects.delete(id);
        }

        for (const pid of targetsToRecalc) {
            this.recalculateStats(pid);
        }
    }

    isDomainActive() {
        for (const [, effect] of this.activeEffects.entries()) {
            if (effect && effect.type === 'array_domain' && (Number(effect.turnsLeft) || 0) > 0) {
                return true;
            }
        }
        return false;
    }

    getEnemySkillCooldownBonus(playerId) {
        if (!playerId) return 0;
        let bonus = 0;
        for (const [, effect] of this.activeEffects.entries()) {
            if (!effect) continue;
            if (effect.type !== 'room_domain') continue;
            if ((Number(effect.turnsLeft) || 0) <= 0) continue;
            if (effect.ownerId && effect.ownerId !== playerId) {
                bonus = Math.max(bonus, Math.max(0, Math.floor(Number(effect.enemySkillCooldownBonus) || 0)));
            }
        }
        return bonus;
    }

    removeAllDomains() {
        for (const [id, e] of this.activeEffects.entries()) {
            if (!e) continue;
            if (e.type === 'array_domain' || e.type === 'room_domain' || e.type === 'frieren_domain' || e.type === 'construction_site_domain' || e.type === 'alchemy_domain') {
                this.activeEffects.delete(id);
            }
        }
    }

    getAlchemyDomainEffect() {
        for (const [, effect] of this.activeEffects.entries()) {
            if (effect && effect.type === 'alchemy_domain' && (Number(effect.turnsLeft) || 0) > 0) {
                return effect;
            }
        }
        return null;
    }

    isConstructionSiteActive() {
        for (const [, effect] of this.activeEffects.entries()) {
            if (effect && effect.type === 'construction_site_domain' && (Number(effect.turnsLeft) || 0) > 0) {
                return true;
            }
        }
        return false;
    }

    getGritEffect(playerId) {
        if (!playerId) return null;
        for (const [, effect] of this.activeEffects.entries()) {
            if (effect && effect.type === 'grit_stance' && effect.target === playerId) {
                return effect;
            }
        }
        return null;
    }

    isEvading(playerId) {
        for (const [, effect] of this.activeEffects.entries()) {
            if (
                effect &&
                effect.type === 'buff' &&
                effect.target === playerId &&
                this.normalizeStatKey(effect.stat) === 'evade' &&
                (Number(effect.turnsLeft) || 0) > 0
            ) {
                return true;
            }
        }
        return false;
    }

    getActiveKissMark(playerId) {
        for (const [, effect] of this.activeEffects.entries()) {
            if (
                effect &&
                effect.type === 'kiss_mark' &&
                effect.target === playerId &&
                (Number(effect.turnsLeft) || 0) > 0
            ) {
                return effect;
            }
        }
        return null;
    }

    applyKissMark(playerId, duration) {
        // Replace any existing Kiss Mark on that target
        for (const [id, e] of this.activeEffects.entries()) {
            if (e && e.type === 'kiss_mark' && e.target === playerId) {
                this.activeEffects.delete(id);
            }
        }

        const id = `kiss_mark_${playerId}_${Date.now()}`;
        const turnsLeft = Math.max(1, Math.floor(Number(duration) || 1));

        const ctx = this.getActiveActionContext();
        const ownerId = ctx && (ctx.attackerId === 'player1' || ctx.attackerId === 'player2')
            ? ctx.attackerId
            : (this.gameState?.currentTurn === 'player1' || this.gameState?.currentTurn === 'player2'
                ? this.gameState.currentTurn
                : null);
        this.activeEffects.set(id, {
            type: 'kiss_mark',
            target: playerId,
            ownerId,
            duration: turnsLeft,
            turnsLeft,
            name: 'Kiss Mark',
            description: 'Healing received is stored as heartbreak',
            storedHealing: 0
        });
    }

    consumeKissStoredHealing(playerId) {
        let stored = 0;
        for (const [id, e] of this.activeEffects.entries()) {
            if (e && e.type === 'kiss_mark' && e.target === playerId) {
                stored = Number(e.storedHealing) || 0;
                this.activeEffects.delete(id);
                break;
            }
        }
        return Math.max(0, Math.floor(stored));
    }

    async applyCurse(target, curseEffect, caster, playerId) {
        // Conceal blocks debuffs
        if (this.isConcealed(playerId)) {
            return;
        }

        // Immunity blocks curse
        if (this.isImmune(playerId)) {
            return;
        }

        const curseDamage = Math.max(1, Math.ceil(this.calculateDamage(curseEffect, caster, target)));
        const curseId = `curse_${playerId}_${Date.now()}`;

        this.activeEffects.set(curseId, {
            type: 'curse',
            target: playerId,
            characterId: target.id,
            damage: curseDamage,
            duration: curseEffect.duration,
            turnsLeft: curseEffect.duration,
            name: 'Curse',
            description: `Takes ${curseDamage} damage per turn for ${curseEffect.duration} turns`
        });
    }

    normalizeStatKey(stat) {
        if (stat === 'damage_reduction') return 'damageReduction';
        return stat;
    }

    isImmune(playerId) {
        for (const [, effect] of this.activeEffects) {
            if (effect.target === playerId && effect.type === 'immunity') {
                return true;
            }
        }
        return false;
    }

    recalculateStats(playerId) {
        const character = this.getPlayerById(playerId);
        if (!character || !character.stats) return;

        // Ensure baseStats exists (GameState should set it, but guard anyway)
        if (!character.baseStats) {
            character.baseStats = { ...character.stats };
        }

        const baseAttack = Number(character.baseStats.attack) || 0;
        const baseDefense = Number(character.baseStats.defense) || 0;
        const baseDamageReduction = 0;
        const baseMaxHealth = Number(character.baseStats.maxHealth) || Number(character.stats.maxHealth) || 0;

        let attackMultiplier = 1;
        let defenseMultiplier = 1;
        let attackAdd = 0;
        let defenseAdd = 0;
        let damageReductionAdd = 0;
        let maxHealthAdd = 0;

        // Accumulate buffs/debuffs/stances currently active for this player
        for (const [, effect] of this.activeEffects.entries()) {
            if (effect.target !== playerId) continue;
            if (effect.type !== 'buff' && effect.type !== 'debuff' && effect.type !== 'stance') continue;

            if (effect.type === 'stance') {
                const defenseBonus = Number(effect.defenseBonus) || 0;
                if (defenseBonus !== 0) {
                    defenseAdd += defenseBonus;
                }
                continue;
            }

            const statKey = this.normalizeStatKey(effect.stat);
            const value = Number(effect.value) || 0;
            const mode = effect.mode;

            if (statKey === 'attack') {
                if (mode === 'flat') {
                    attackAdd += value;
                } else {
                    attackMultiplier *= (1 + value);
                }
            } else if (statKey === 'defense') {
                if (mode === 'flat') {
                    defenseAdd += value;
                } else {
                    defenseMultiplier *= (1 + value);
                }
            } else if (statKey === 'damageReduction') {
                damageReductionAdd += value;
            } else if (statKey === 'maxHealth') {
                maxHealthAdd += value;
            }
        }

        // Apply derived stats from base + modifiers
        character.stats.attack = (baseAttack * attackMultiplier) + attackAdd;
        character.stats.defense = (baseDefense * defenseMultiplier) + defenseAdd;
        character.stats.damageReduction = baseDamageReduction + damageReductionAdd;

        // Base lifesteal is not a character stat anymore. Skill-specific lifesteal remains supported.
        if (character.stats.lifesteal !== undefined) {
            character.stats.lifesteal = 0;
        }

        // Low-health passives are derived modifiers (do not mutate baseStats)
        if (character.passive && character.passive.type === 'dual_passive' && character.passive.ongoing_effect) {
            const ongoing = character.passive.ongoing_effect;
            const maxHp = Number(character.stats.maxHealth) || 1;
            const hp = Number(character.stats.health) || 0;
            const hpPct = maxHp > 0 ? hp / maxHp : 0;

            if (ongoing.type === 'low_health_buff') {
                const threshold = Number(ongoing.health_threshold) || 0;
                if (hpPct > 0 && hpPct <= threshold) {
                    character.stats.attack = Math.max(1, character.stats.attack * (1 + (Number(ongoing.attack_bonus) || 0)));
                }
            }

            if (ongoing.type === 'low_health_defense_boost') {
                const threshold = Number(ongoing.health_threshold) || 0;
                if (hpPct > 0 && hpPct <= threshold) {
                    character.stats.damageReduction = (Number(character.stats.damageReduction) || 0) + (Number(ongoing.defense_bonus) || 0);
                }
            }
        }

        character.stats.maxHealth = Math.max(1, baseMaxHealth + maxHealthAdd);

        // Health is not derived, but clamp to maxHealth after modifications
        character.stats.health = Number(character.stats.health) || 0;

        if (character.stats.health > character.stats.maxHealth) {
            character.stats.health = character.stats.maxHealth;
        }

        if (character.stats.shield === undefined || character.stats.shield === null) {
            character.stats.shield = 0;
        }
        if (character.stats.maxShield === undefined || character.stats.maxShield === null) {
            character.stats.maxShield = 0;
        }
    }

    async executeSkill(skill, caster, target, gameState, playerId) {
        try {
            if (!this.canUseSkill(skill, playerId)) {
                throw new Error(`Skill ${skill.name} is on cooldown`);
            }

            // Edward Elric: Alchemy domain (global)
            // While active, whenever a player uses a skill, both players gain Heat.
            try {
                const dom = this.getAlchemyDomainEffect();
                if (dom) {
                    const gain = Math.max(0, Math.floor(Number(dom.heatGain) || 0));
                    const cap = (typeof dom.heatCap === 'number') ? dom.heatCap : 100;
                    if (gain > 0) {
                        for (const pid of ['player1', 'player2']) {
                            this.addCounterValue(pid, 'heat', gain, 0, cap);
                        }
                    }
                }
            } catch (e) {
                console.warn('Alchemy domain heat grant failed:', e);
            }

            const skillTypeForPassive = (skill && skill.id === 'gojo_strike' && this.isDomainActive())
                ? 'heal'
                : (skill && typeof skill.type === 'string' ? skill.type : null);

            if (this.passiveSystem && typeof this.passiveSystem.handleEvent === 'function') {
                this.passiveSystem.handleEvent(playerId, 'skill_used', { skillId: skill.id, skillType: skillTypeForPassive });

                const opponentId = playerId === 'player1' ? 'player2' : (playerId === 'player2' ? 'player1' : null);
                if (opponentId) {
                    this.passiveSystem.handleEvent(opponentId, 'opponent_skill_used', { skillId: skill.id, skillType: skillTypeForPassive, attackerId: playerId });
                }
            }

            const result = await this.withActionContext({
                kind: 'skill',
                attackerId: playerId,
                skillId: skill?.id,
                skillType: skillTypeForPassive,
                isCounter: false
            }, async () => {
                return await this.applySkillEffect(skill.effect, caster, target, gameState, playerId);
            });

            {
                const baseCd = Math.max(0, Math.floor(Number(skill.cooldown) || 0));
                const bonusCd = this.getEnemySkillCooldownBonus(playerId);
                const applied = baseCd + bonusCd;
                if (applied > 0) {
                    // Cooldown N means it is unavailable for the next N of your turns.
                    this.setSkillCooldownFromUse(skill.id, playerId, applied);
                }
            }

            // Monarch passive: cooldown_reset (deterministic)
            if (caster && caster.passive && caster.passive.type === 'dual_passive' && caster.passive.ongoing_effect) {
                const ongoing = caster.passive.ongoing_effect;
                if (ongoing.type === 'cooldown_reset' && typeof ongoing.reset_chance === 'number' && ongoing.reset_chance > 0) {
                    const seed = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:cdr:${skill.id}`;
                    const rand = this.deterministicRandom(seed);
                    if (rand < ongoing.reset_chance) {
                        this.setSkillCooldown(skill.id, playerId, 0);
                    }
                }
            }

            return result;
        } catch (error) {
            console.error('Failed to execute skill:', error);
            throw error;
        }
    }

    deterministicRandom(seed) {
        let h = 2166136261;
        const s = String(seed);
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        return (h >>> 0) / 4294967296;
    }

    async applySkillEffect(effect, caster, target, gameState, playerId, override = {}) {
        const result = {
            damage: 0,
            healing: 0,
            effects: [],
            lightningDamage: 0
        };

        const hadSink = Boolean(this.getActiveAnimationSink());
        if (!hadSink) {
            this.pushAnimationSink(result.animations);
        }
        try {

        const opponentId = playerId === 'player1' ? 'player2' : 'player1';
        const targetPlayerId = target === caster ? playerId : opponentId;

        // Evade: blocks all opponent skills and debuffs for 1 turn
        if (targetPlayerId !== playerId && this.isEvading(targetPlayerId)) {
            result.effects.push('Evaded');
            return result;
        }

        switch (effect.type) {
            case 'damage_with_cdr_stacks':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const stackSkillId = typeof effect.stack_skill_id === 'string' && effect.stack_skill_id
                        ? effect.stack_skill_id
                        : (typeof override.skillId === 'string' ? override.skillId : null);
                    const stacks = stackSkillId ? this.getCooldownReductionStacksForSkill(playerId, stackSkillId) : 0;
                    const base = Number(effect.base_percent) || 0;
                    const per = Number(effect.per_stack_percent) || 0;
                    const mult = Math.max(0, base + (stacks * per));

                    const intended = this.calculateDamage({ scaling: 'attack', value: mult }, caster, target);
                    if (intended > 0) {
                        result.damage = await this.applyDamage(target, intended, targetId, playerId);
                    }

                    if (stackSkillId && effect.reset_stacks_on_use) {
                        this.setCooldownReductionStacksForSkill(playerId, stackSkillId, 0);
                    }

                    // Ch'en: Dragon Strike permanent defense bonus when sufficiently enhanced.
                    const permDefAt = Math.max(0, Math.floor(Number(effect.permanent_defense_if_stacks_at_least) || 0));
                    const permDef = Math.floor(Number(effect.permanent_defense_amount) || 0);
                    if (permDefAt > 0 && permDef !== 0 && stacks >= permDefAt) {
                        if (!caster.baseStats) caster.baseStats = { ...caster.stats };
                        caster.baseStats.defense = (Number(caster.baseStats.defense) || 0) + permDef;
                        this.recalculateStats(playerId);
                        result.effects.push(`Permanently gained +${permDef} defense`);
                    }
                }
                break;

            case 'chen_piercing_assault':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const threshold = Math.max(0, Math.floor(Number(effect.shield_break_if_other_skill_stacks_at_least) || 0));
                    const stackIds = Array.isArray(effect.stack_skill_ids) ? effect.stack_skill_ids : [];
                    let shouldBreakShield = false;
                    if (threshold > 0 && stackIds.length > 0) {
                        for (const sid of stackIds) {
                            if (!sid) continue;
                            const stacks = this.getCooldownReductionStacksForSkill(playerId, sid);
                            if (stacks >= threshold) {
                                shouldBreakShield = true;
                                break;
                            }
                        }
                    }

                    if (shouldBreakShield && target && target.stats && (Number(target.stats.shield) || 0) > 0) {
                        target.stats.shield = 0;
                        target.stats.maxShield = 0;
                        result.effects.push('Shield Broken');
                    }

                    const ratio = Math.max(0, Number(effect.damage_percent) || 0);
                    const intended = this.calculateDamage({ scaling: 'attack', value: ratio }, caster, target);
                    if (intended > 0) {
                        result.damage = await this.applyDamage(target, intended, targetId, playerId);
                    }
                }
                break;

            case 'true_damage_and_apply_cdr_random_other':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const ratio = Math.max(0, Number(effect.true_damage_percent) || 0);
                    const intended = Math.max(0, Math.floor((Number(caster?.stats?.attack) || 0) * ratio));
                    if (intended > 0) {
                        const dealt = await this.applyTrueDamage(target, intended, targetId, playerId);
                        result.damage = (Number(result.damage) || 0) + dealt;
                    }

                    const ctx = this.getActiveActionContext();
                    const exclude = (ctx && typeof ctx.skillId === 'string') ? ctx.skillId : null;
                    const seed = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:cdr:${exclude || 'none'}:skill_effect`;
                    this.applyCooldownReductionToRandomOtherSkill(playerId, exclude, { amount: 1, seed });
                }
                break;

            case 'chen_ultimate_barrage':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const stackSkillId = typeof effect.stack_skill_id === 'string' && effect.stack_skill_id
                        ? effect.stack_skill_id
                        : null;
                    const stacks = stackSkillId ? this.getCooldownReductionStacksForSkill(playerId, stackSkillId) : 0;
                    const base = Number(effect.base_percent) || 0;
                    const hits = Math.max(1, 1 + Math.max(0, Math.floor(stacks)));

                    for (let i = 0; i < hits; i++) {
                        const intended = this.calculateDamage({ scaling: 'attack', value: base }, caster, target);
                        if (intended > 0) {
                            const dealt = await this.applyDamage(target, intended, targetId, playerId);
                            result.damage = (Number(result.damage) || 0) + dealt;
                        }
                    }

                    // Ch'en: If sufficiently enhanced, reduce cooldown of all other skills.
                    const cdrAt = Math.max(0, Math.floor(Number(effect.reduce_other_skill_cooldowns_if_stacks_at_least) || 0));
                    const cdrAmt = Math.max(0, Math.floor(Number(effect.reduce_other_skill_cooldowns_amount) || 0));
                    if (cdrAt > 0 && cdrAmt > 0 && stacks >= cdrAt) {
                        const skills = Array.isArray(caster?.skills) ? caster.skills : [];
                        let reducedAny = false;
                        for (const s of skills) {
                            if (!s || !s.id) continue;
                            if (s.id === stackSkillId) continue;
                            const remaining = Math.max(0, Math.floor(this.getSkillCooldown({ id: s.id }, playerId)));
                            if (remaining > 0) {
                                this.setSkillCooldown(s.id, playerId, Math.max(0, remaining - cdrAmt));
                                reducedAny = true;
                            }

                            const buffCfg = s.cooldownReductionBuff && typeof s.cooldownReductionBuff === 'object'
                                ? s.cooldownReductionBuff
                                : null;
                            if (buffCfg) {
                                const maxStacks = (typeof buffCfg.maxStacks === 'number')
                                    ? Math.max(0, Math.floor(buffCfg.maxStacks))
                                    : null;
                                const cur = this.getCooldownReductionStacksForSkill(playerId, s.id);
                                const next = maxStacks === null ? (cur + cdrAmt) : Math.min(maxStacks, cur + cdrAmt);
                                this.setCooldownReductionStacksForSkill(playerId, s.id, next);
                            }
                        }
                        if (reducedAny) {
                            result.effects.push(`Reduced cooldown of other skills by ${cdrAmt}`);
                        }
                    }

                    if (stackSkillId && effect.reset_stacks_on_use) {
                        this.setCooldownReductionStacksForSkill(playerId, stackSkillId, 0);
                    }
                }
                break;
            case 'stance':
                {
                    const turnsLeft = Math.max(1, Math.floor(Number(effect.enemy_turn_duration) || Number(effect.duration) || 1));
                    const defenseBonus = Math.floor(Number(effect.defense_bonus) || 0);
                    const healOnTurnStart = Math.floor(Number(effect.heal_on_turn_start) || 0);

                    const stanceKey = (typeof effect.stance_key === 'string' && effect.stance_key)
                        ? effect.stance_key
                        : 'stance';

                    for (const [id, e] of this.activeEffects.entries()) {
                        if (e && e.target === playerId && (e.type === 'stance' || e.key === 'stance' || e.stat === 'stance')) {
                            this.activeEffects.delete(id);
                        }
                    }

                    const ctx = this.getActiveActionContext();
                    const display = (ctx && ctx.kind === 'ultimate')
                        ? this.resolveUltimateDisplayForCaster(caster)
                        : this.resolveSkillDisplayForCaster(caster, ctx?.skillId);
                    const displayName = 'Stance';
                    const displayDescription = display?.description || `+${defenseBonus} defense. Heals ${healOnTurnStart} at the start of your turn.`;

                    const id = `stance_${playerId}_${Date.now()}`;
                    this.activeEffects.set(id, {
                        type: 'stance',
                        key: stanceKey,
                        stanceKey,
                        target: playerId,
                        duration: turnsLeft,
                        turnsLeft,
                        name: displayName,
                        description: displayDescription,
                        defenseBonus,
                        healOnTurnStart,
                        doubleHeartbreakOnEnemySkillDamage: Boolean(effect.double_heartbreak_on_enemy_skill_damage),
                        counterPercentPerHeartbreak: Number(effect.counter_percent_per_heartbreak) || 0,

                        // Naruto: Yin Serenity
                        shieldRatioOnDamage: Number(effect.shield_ratio_on_damage),

                        // Edward Elric: Equivalent Exchange config
                        heat_on_trigger: Math.max(0, Math.floor(Number(effect.heat_on_trigger) || 0)),
                        counter_ratio: Number(effect.counter_ratio),
                        counter_hits: Math.max(0, Math.floor(Number(effect.counter_hits) || 0))
                    });

                    this.recalculateStats(playerId);
                    result.effects.push('Stance');
                }
                break;

            case 'evade_and_heal_enemy':
                {
                    const evadeTurns = Math.max(1, Math.floor(Number(effect.evade_duration) || 1));
                    this.applyBuff(caster, { stat: 'evade', value: 1, duration: evadeTurns }, playerId);

                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';

                    const enemy = this.getPlayerById(opponentId);
                    const enemyHeal = Math.max(0, Math.floor(Number(effect.enemy_heal) || 0));
                    if (enemy && enemyHeal > 0) {
                        const healed = await this.applyHealing(enemy, enemyHeal, opponentId);
                        result.healing = (Number(result.healing) || 0) + healed;
                    }
                }
                break;

            case 'alchemy_domain':
                {
                    const duration = Math.max(1, Math.floor(Number(effect.duration) || 1));
                    const gain = Math.max(0, Math.floor(Number(effect.heat_gain) || 0));
                    const cap = (typeof effect.heat_cap === 'number') ? effect.heat_cap : 100;

                    this.removeAllDomains();

                    const domainId = `alchemy_domain_${Date.now()}`;
                    this.activeEffects.set(domainId, {
                        type: 'alchemy_domain',
                        target: 'global',
                        ownerId: playerId,
                        duration,
                        turnsLeft: duration,
                        name: 'Alchemy',
                        description: `Whenever a player uses a skill, both players gain ${gain} Heat for ${duration} turns`,
                        heatGain: gain,
                        heatCap: cap
                    });

                    result.effects.push('Domain Activated');
                }
                break;

            case 'damage_then_enemy_current_health_damage':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const atkMult = Number(effect.attack_value) || 0;
                    const hpRatio = Number(effect.enemy_current_health_ratio) || 0;

                    const firstIntended = this.calculateDamage({ scaling: 'attack', value: atkMult }, caster, target);
                    if (firstIntended > 0) {
                        const dealt1 = await this.applyDamage(target, firstIntended, targetId, playerId);
                        result.damage = (Number(result.damage) || 0) + dealt1;
                    }

                    const enemyCurrent = Math.max(0, Math.floor(Number(target?.stats?.health) || 0));
                    const secondBase = Math.max(0, Math.floor(enemyCurrent * hpRatio));
                    if (secondBase > 0) {
                        const secondIntended = this.calculateDamage({ scaling: 'flat', value: secondBase }, caster, target);
                        const dealt2 = await this.applyDamage(target, secondIntended, targetId, playerId);
                        result.damage = (Number(result.damage) || 0) + dealt2;
                    }
                }
                break;

            case 'room_domain':
                {
                    const duration = Math.max(1, Math.floor(Number(effect.duration) || 1));
                    const cdBonus = Math.max(0, Math.floor(Number(effect.enemy_skill_cooldown_bonus) || 0));

                    this.removeAllDomains();

                    const domainId = `room_domain_${Date.now()}`;
                    this.activeEffects.set(domainId, {
                        type: 'room_domain',
                        target: 'global',
                        ownerId: playerId,
                        duration,
                        turnsLeft: duration,
                        name: 'Room',
                        description: `Enemy skills gain +${cdBonus} cooldown for ${duration} turns`,
                        enemySkillCooldownBonus: cdBonus
                    });

                    result.effects.push('Domain Activated');
                }
                break;

            case 'construction_site_domain':
                {
                    const duration = Math.max(1, Math.floor(Number(effect.duration) || 1));
                    const dmg = Math.max(0, Math.floor(Number(effect.true_damage_per_turn) || 0));

                    this.removeAllDomains();

                    const domainId = `construction_site_domain_${Date.now()}`;
                    this.activeEffects.set(domainId, {
                        type: 'construction_site_domain',
                        target: 'global',
                        ownerId: playerId,
                        duration,
                        turnsLeft: duration,
                        name: 'Construction Site',
                        description: `Shields are disabled. At end of each turn, take ${dmg} true damage.`,
                        trueDamagePerTurn: dmg
                    });

                    // Remove all shields immediately on deploy
                    for (const pid of ['player1', 'player2']) {
                        const c = this.getPlayerById(pid);
                        if (c && c.stats) {
                            c.stats.shield = 0;
                            c.stats.maxShield = Math.max(0, Number(c.stats.maxShield) || 0);
                        }
                    }

                    result.effects.push('Domain Activated');
                }
                break;

            case 'grit_stance':
                {
                    const opponentId = this.getOpponentId(playerId);
                    const enemyId = target === caster ? playerId : opponentId;
                    const enemyChar = target === caster ? caster : target;

                    const existing = this.getGritEffect(playerId);
                    const ratio = Number(effect.release_ratio);
                    const releaseRatio = Number.isFinite(ratio) ? Math.max(0, ratio) : 0.5;

                    if (existing) {
                        const stored = Math.max(0, Math.floor(Number(existing.storedDamage) || 0));
                        const intended = Math.max(0, Math.floor(stored * releaseRatio));
                        for (const [eid, eff] of this.activeEffects.entries()) {
                            if (eff === existing) {
                                this.activeEffects.delete(eid);
                                break;
                            }
                        }

                        if (intended > 0 && enemyId && enemyChar) {
                            const dealt = await this.applyTrueDamageNoDomain(enemyChar, intended, enemyId, playerId);
                            result.damage = (Number(result.damage) || 0) + dealt;
                        }
                        result.effects.push('Stance Released');
                    } else {
                        const id = `grit_stance_${playerId}_${Date.now()}`;
                        this.activeEffects.set(id, {
                            type: 'grit_stance',
                            target: playerId,
                            name: 'Grit',
                            description: 'Stores damage taken. Use again to release 50% as true damage.',
                            storedDamage: 0,
                            releaseRatio
                        });
                        result.effects.push('Stance');
                    }
                }
                break;

            case 'frieren_domain_page':
                {
                    const duration = Math.max(1, Math.floor(Number(effect.duration) || 1));
                    const selfAtk = Math.floor(Number(effect.self_attack_bonus) || 0);
                    const enemyAtk = Math.floor(Number(effect.enemy_attack_penalty) || 0);

                    this.removeAllDomains();

                    const enemyId = this.getOpponentId(playerId);

                    const domainId = `frieren_domain_${Date.now()}`;
                    this.activeEffects.set(domainId, {
                        type: 'frieren_domain',
                        target: 'global',
                        ownerId: playerId,
                        duration,
                        turnsLeft: duration,
                        name: 'Domain',
                        description: `+${selfAtk} ATK to you and -${enemyAtk} ATK to the enemy for ${duration} turns`,
                        selfAttackBonus: selfAtk,
                        enemyAttackPenalty: enemyAtk,
                        selfId: playerId,
                        enemyId
                    });

                    if (selfAtk !== 0) {
                        await this.applyBuff(caster, { stat: 'attack', value: selfAtk, mode: 'flat', duration }, playerId);
                    }
                    if (enemyId && enemyAtk !== 0) {
                        const enemy = this.getPlayerById(enemyId);
                        if (enemy) {
                            await this.applyDebuff(enemy, { stat: 'attack', value: -enemyAtk, mode: 'flat', duration }, enemyId);
                        }
                    }

                    result.effects.push('Domain Activated');
                }
                break;
            case 'archive_minor_utility':
                {
                    const lastType = this.getArchiveLastPageType(playerId);
                    const opponentId = this.getOpponentId(playerId);
                    const enemyId = target === caster ? playerId : opponentId;
                    const enemyChar = target === caster ? caster : target;

                    const executeOnce = async () => {
                        const ctx = this.getActiveActionContext();
                        const prevIgnore = ctx ? Boolean(ctx.ignoreTargetStance) : false;
                        if (ctx && lastType === 'stance') {
                            // Frieren stance page: ignore enemy stance for this attack (do NOT remove stance).
                            ctx.ignoreTargetStance = true;
                        }
                        {
                            const baseScaling = effect.base_damage_scaling || 'attack';
                            const baseValue = effect.base_damage_value !== undefined ? effect.base_damage_value : 0.75;

                            const isUltimatePage = lastType === 'ultimate';
                            const baseIntended = isUltimatePage
                                ? (() => {
                                    const atk = Number(caster?.stats?.attack) || 0;
                                    const maxHp = Number(caster?.stats?.maxHealth) || 0;
                                    const mult = Number(baseValue) || 0;
                                    const raw = baseScaling === 'max_health' ? (maxHp * mult) : (atk * mult);
                                    return Math.max(0, Math.floor(raw));
                                })()
                                : this.calculateDamage({ scaling: baseScaling, value: baseValue }, caster, enemyChar);

                            if (baseIntended > 0) {
                                const baseDealt = isUltimatePage
                                    ? await this.applyTrueDamage(enemyChar, baseIntended, enemyId, playerId)
                                    : await this.applyDamage(enemyChar, baseIntended, enemyId, playerId);
                                result.damage = (Number(result.damage) || 0) + baseDealt;

                                if (isUltimatePage && baseDealt > 0) {
                                    const healAmount = Math.max(0, Math.floor(baseDealt * 0.5));
                                    if (healAmount > 0) {
                                        const healed = await this.applyHealing(caster, healAmount, playerId);
                                        result.healing = (Number(result.healing) || 0) + healed;
                                    }
                                    result.effects.push('Lifesteal');
                                }
                            }
                        }

                        if (ctx) {
                            ctx.ignoreTargetStance = prevIgnore;
                        }

                        if (lastType === 'ultimate') {
                            return;
                        }

                        if (lastType === 'stance') {
                            // Frieren stance page: ignore stance on the attack above; do not remove stance.
                            result.effects.push('Stance Ignored');
                            return;
                        }

                        if (lastType === 'attack') {
                            const amount = this.calculateShield({
                                scaling: effect.shield_scaling || 'max_health',
                                value: effect.shield_value !== undefined ? effect.shield_value : 0.15
                            }, caster);
                            if (amount > 0) {
                                await this.applyShield(caster, amount, playerId);
                                result.effects.push('Barrier');
                            }
                            return;
                        }

                        if (lastType === 'buff') {
                            const removed = this.removeOneBuff(enemyId);
                            if (removed) {
                                result.effects.push('Dispelled');
                            }
                            const intended = this.calculateDamage({
                                scaling: effect.damage_scaling || 'attack',
                                value: effect.damage_value !== undefined ? effect.damage_value : 0.9
                            }, caster, enemyChar);
                            if (intended > 0) {
                                const dealt = await this.applyDamage(enemyChar, intended, enemyId, playerId);
                                result.damage = (Number(result.damage) || 0) + dealt;
                            }
                            return;
                        }

                        if (lastType === 'debuff') {
                            await this.cleanse(caster, playerId);
                            const healAmount = this.calculateHealing({
                                scaling: effect.heal_scaling || 'max_health',
                                value: effect.heal_value !== undefined ? effect.heal_value : 0.12
                            }, caster);
                            if (healAmount > 0) {
                                const healed = await this.applyHealing(caster, healAmount, playerId);
                                result.healing = (Number(result.healing) || 0) + healed;
                            }
                            result.effects.push('Cleansed');
                            return;
                        }

                        if (lastType === 'domain') {
                            await this.applySkillEffect({
                                type: 'frieren_domain_page',
                                duration: 2,
                                self_attack_bonus: 3,
                                enemy_attack_penalty: 3
                            }, caster, enemyChar, gameState, playerId, { skillId: 'frieren_domain_page' });
                            result.effects.push('Domain');
                            return;
                        }

                        if (lastType === 'heal' || lastType === 'recovery' || lastType === 'utility') {
                            const duration = Math.max(1, Math.floor(Number(effect.heal_block_duration) || 2));
                            await this.applyHealBlock(enemyId, duration);
                            result.effects.push('Sealed');
                        }
                    };

                    const shouldDouble = this.hasCopycatGlyph(playerId);
                    if (shouldDouble) {
                        this.consumeCopycatGlyph(playerId);
                    }

                    await executeOnce();
                    if (shouldDouble) {
                        await executeOnce();
                        result.effects.push('Doublecast');
                    }
                }
                break;

            case 'frieren_rotating_page':
                {
                    const opponentId = this.getOpponentId(playerId);
                    const enemyId = target === caster ? playerId : opponentId;
                    const enemyChar = target === caster ? caster : target;

                    const player = this.gameState?.players?.get(playerId);
                    const state = player?.character?.passiveState || {};
                    const pageType = (typeof state.frierenRotatingSkillCurrentType === 'string' && state.frierenRotatingSkillCurrentType)
                        ? state.frierenRotatingSkillCurrentType
                        : 'attack';

                    const maxPages = Math.max(1, Math.floor(Number(effect.max_pages) || 5));
                    this.addArchivePage(playerId, pageType, maxPages);

                    if (pageType === 'ultimate') {
                        const baseIntended = Math.max(0, Math.floor((Number(caster?.stats?.attack) || 0) * 0.75));
                        if (baseIntended > 0) {
                            const dealt = await this.applyTrueDamage(enemyChar, baseIntended, enemyId, playerId);
                            result.damage = (Number(result.damage) || 0) + dealt;

                            if (dealt > 0) {
                                const healAmount = Math.max(0, Math.floor(dealt * 0.5));
                                if (healAmount > 0) {
                                    const healed = await this.applyHealing(caster, healAmount, playerId);
                                    result.healing = (Number(result.healing) || 0) + healed;
                                }
                                result.effects.push('Lifesteal');
                            }
                        }
                        break;
                    }

                    if (pageType === 'stance') {
                        // Frieren stance page: do not remove stance; the next damaging hit ignores stance.
                        if (player && player.character && player.character.passiveState) {
                            player.character.passiveState.ignoreTargetStanceNextHit = true;
                        }
                        result.effects.push('Stance Ignored');
                        break;
                    }

                    if (pageType === 'attack') {
                        const amount = this.calculateShield({ scaling: 'flat', value: 7 }, caster);
                        if (amount > 0) {
                            await this.applyShield(caster, amount, playerId);
                            result.effects.push('Barrier');
                        }
                        break;
                    }

                    if (pageType === 'buff') {
                        const removed = this.removeOneBuff(enemyId);
                        if (removed) result.effects.push('Dispelled');

                        const intended = this.calculateDamage({ scaling: 'attack', value: 0.95 }, caster, enemyChar);
                        if (intended > 0) {
                            const dealt = await this.applyDamage(enemyChar, intended, enemyId, playerId);
                            result.damage = (Number(result.damage) || 0) + dealt;
                        }
                        break;
                    }

                    if (pageType === 'domain') {
                        {
                            const duration = 2;
                            const selfAtk = 3;
                            const enemyAtk = 3;

                            this.removeAllDomains();

                            const enemyId = this.getOpponentId(playerId);
                            const domainId = `frieren_domain_${Date.now()}`;
                            this.activeEffects.set(domainId, {
                                type: 'frieren_domain',
                                target: 'global',
                                ownerId: playerId,
                                duration,
                                turnsLeft: duration,
                                name: 'Domain',
                                description: `+${selfAtk} ATK to you and -${enemyAtk} ATK to the enemy for ${duration} turns`,
                                selfAttackBonus: selfAtk,
                                enemyAttackPenalty: enemyAtk,
                                selfId: playerId,
                                enemyId
                            });

                            if (selfAtk !== 0) {
                                await this.applyBuff(caster, { stat: 'attack', value: selfAtk, mode: 'flat', duration }, playerId);
                            }
                            if (enemyId && enemyAtk !== 0) {
                                const enemy = this.getPlayerById(enemyId);
                                if (enemy) {
                                    await this.applyDebuff(enemy, { stat: 'attack', value: -enemyAtk, mode: 'flat', duration }, enemyId);
                                }
                            }

                            result.effects.push('Domain Activated');
                        }
                        break;
                    }

                    if (pageType === 'debuff') {
                        await this.cleanse(caster, playerId);
                        const healAmount = this.calculateHealing({ scaling: 'flat', value: 5 }, caster);
                        if (healAmount > 0) {
                            const healed = await this.applyHealing(caster, healAmount, playerId);
                            result.healing = (Number(result.healing) || 0) + healed;
                        }
                        result.effects.push('Cleansed');
                        break;
                    }

                    await this.applyHealBlock(enemyId, 2);
                    result.effects.push('Sealed');
                }
                break;

            case 'archive_copycat_glyph':
                {
                    const turnsLeft = Math.max(1, Math.floor(Number(effect.duration) || 1));
                    const id = `copycat_glyph_${playerId}_${Date.now()}`;
                    this.activeEffects.set(id, {
                        type: 'copycat_glyph',
                        target: playerId,
                        duration: turnsLeft,
                        turnsLeft,
                        name: 'Copycat Glyph',
                        description: 'Your next Minor Utility Spell triggers twice.'
                    });
                    result.effects.push('Copycat');
                }
                break;

            case 'archive_grand_release':
                {
                    const opponentId = this.getOpponentId(playerId);
                    const enemyId = target === caster ? playerId : opponentId;
                    const enemyChar = target === caster ? caster : target;

                    const pages = this.getArchivePages(playerId).slice();
                    const count = pages.length;
                    if (count <= 0) {
                        result.effects.push('No Pages');
                        break;
                    }
                    this.consumeArchivePages(playerId, count);

                    // For each page, apply a small themed micro-effect.
                    for (const t of pages) {
                        if (t === 'attack') {
                            const dmg = this.calculateDamage({ scaling: 'attack', value: Number(effect.attack_page_damage) || 0.35 }, caster, enemyChar);
                            const dealt = await this.applyDamage(enemyChar, dmg, enemyId, playerId);
                            result.damage = (Number(result.damage) || 0) + dealt;
                        } else if (t === 'buff') {
                            this.removeOneBuff(enemyId);
                        } else if (t === 'debuff') {
                            await this.cleanse(caster, playerId);
                        } else {
                            // heal / recovery / utility
                            const duration = Math.max(1, Math.floor(Number(effect.heal_block_duration) || 2));
                            await this.applyHealBlock(enemyId, duration);
                        }
                    }

                    // End with a control capstone: small attack debuff.
                    const deb = Number(effect.final_attack_debuff) || 0.15;
                    const dur = Math.max(1, Math.floor(Number(effect.final_debuff_duration) || 2));
                    if (deb > 0) {
                        await this.applyDebuff(enemyChar, { stat: 'attack', value: -deb, duration: dur }, enemyId);
                    }
                    result.effects.push('Archive Released');
                }
                break;

            case 'frieren_minor_utility_barrage':
                {
                    const casts = Math.max(1, Math.floor(Number(effect.casts) || 5));

                    // This ultimate cannot be doubled by Copycat Glyph.
                    // So we intentionally do NOT check/consume copycat_glyph here.
                    const pages = this.getArchivePages(playerId).slice(0, casts);
                    const opponentId = this.getOpponentId(playerId);
                    const enemyId = target === caster ? playerId : opponentId;
                    const enemyChar = target === caster ? caster : target;

                    if (!pages || pages.length <= 0) {
                        result.effects.push('No Pages');
                        break;
                    }

                    // If any replay uses the stance page, the entire ultimate ignores stance on all casts.
                    const ctx = this.getActiveActionContext();
                    const barrageIgnoreStance = pages.includes('stance');
                    const prevIgnore = ctx ? Boolean(ctx.ignoreTargetStance) : false;
                    if (ctx && barrageIgnoreStance) {
                        ctx.ignoreTargetStance = true;
                    }

                    const executeMinorOnceNoCopycat = async (pageType) => {
                        const isUltimatePage = pageType === 'ultimate';
                        const baseIntended = isUltimatePage
                            ? Math.max(0, Math.floor((Number(caster?.stats?.attack) || 0) * 0.75))
                            : this.calculateDamage({ scaling: 'attack', value: 0.75 }, caster, enemyChar);
                        if (baseIntended > 0) {
                            const dealt = isUltimatePage
                                ? await this.applyTrueDamage(enemyChar, baseIntended, enemyId, playerId)
                                : await this.applyDamage(enemyChar, baseIntended, enemyId, playerId);
                            result.damage = (Number(result.damage) || 0) + dealt;

                            if (isUltimatePage && dealt > 0) {
                                const healAmount = Math.max(0, Math.floor(dealt * 0.5));
                                if (healAmount > 0) {
                                    const healed = await this.applyHealing(caster, healAmount, playerId);
                                    result.healing = (Number(result.healing) || 0) + healed;
                                }
                            }
                        }

                        if (pageType === 'ultimate') return result;
                        if (pageType === 'stance') {
                            // Stance page does not remove stance; stance ignore is handled at the action-context level.
                            result.effects.push('Stance Ignored');
                            return result;
                        }

                        if (pageType === 'attack') {
                            const amount = this.calculateShield({ scaling: 'flat', value: 7 }, caster);
                            if (amount > 0) {
                                await this.applyShield(caster, amount, playerId);
                                result.effects.push('Barrier');
                            }
                            return;
                        }

                        if (pageType === 'buff') {
                            const removed = this.removeOneBuff(enemyId);
                            if (removed) result.effects.push('Dispelled');

                            const intended = this.calculateDamage({ scaling: 'attack', value: 0.95 }, caster, enemyChar);
                            if (intended > 0) {
                                const dealt = await this.applyDamage(enemyChar, intended, enemyId, playerId);
                                result.damage = (Number(result.damage) || 0) + dealt;
                            }
                            return;
                        }

                        if (pageType === 'debuff') {
                            await this.cleanse(caster, playerId);
                            const healAmount = this.calculateHealing({ scaling: 'flat', value: 5 }, caster);
                            if (healAmount > 0) {
                                const healed = await this.applyHealing(caster, healAmount, playerId);
                                result.healing = (Number(result.healing) || 0) + healed;
                            }
                            result.effects.push('Cleansed');
                            return;
                        }

                        await this.applyHealBlock(enemyId, 2);
                        result.effects.push('Sealed');
                    };

                    for (const pageType of pages) {
                        await executeMinorOnceNoCopycat(pageType);
                    }

                    if (ctx && barrageIgnoreStance) {
                        ctx.ignoreTargetStance = prevIgnore;
                    }

                    result.effects.push('Archive Barrage');
                }
                break;

            case 'swap_health_and_execute':
                {
                    const targetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                    const oldCasterHp = Number(caster.stats.health) || 0;
                    const oldTargetHp = Number(target.stats.health) || 0;

                    const newCasterHp = Math.min(Number(caster.stats.maxHealth) || 0, oldTargetHp);
                    const newTargetHp = Math.min(Number(target.stats.maxHealth) || 0, oldCasterHp);

                    caster.stats.health = Math.max(0, newCasterHp);
                    target.stats.health = Math.max(0, newTargetHp);

                    // Emit HP swap as combat_text so the UI health bars animate like normal damage/heal.
                    // This is especially important in multiplayer where swap results often come with animations: [].
                    const casterDelta = (Number(caster.stats.health) || 0) - oldCasterHp;
                    const targetDelta = (Number(target.stats.health) || 0) - oldTargetHp;
                    if (playerId) {
                        if (casterDelta > 0) {
                            this.emitCombatText('heal', Math.floor(casterDelta), playerId);
                        } else if (casterDelta < 0) {
                            this.emitCombatText('damage', Math.floor(Math.abs(casterDelta)), playerId);
                        }
                    }
                    if (targetId) {
                        if (targetDelta > 0) {
                            this.emitCombatText('heal', Math.floor(targetDelta), targetId);
                        } else if (targetDelta < 0) {
                            this.emitCombatText('damage', Math.floor(Math.abs(targetDelta)), targetId);
                        }
                    }

                    const gained = Math.max(0, (Number(caster.stats.health) || 0) - oldCasterHp);
                    if (gained > 0 && this.gameState && this.passiveSystem && typeof this.passiveSystem.handleEvent === 'function') {
                        if (typeof this.gameState.updateHealingPassive === 'function') {
                            this.gameState.updateHealingPassive(playerId, gained);
                        }
                        this.passiveSystem.handleEvent(playerId, 'healing_done', { amount: gained });
                        result.healing = gained;
                    }

                    const threshold = (Number(target.stats.maxHealth) || 0) * (Number(effect.execute_threshold) || 0);
                    if ((Number(target.stats.health) || 0) > 0 && (Number(target.stats.health) || 0) <= threshold) {
                        const hp = Number(target.stats.health) || 0;
                        const dealt = await this.applyTrueDamage(target, hp, targetId, playerId);
                        result.damage = (Number(result.damage) || 0) + dealt;
                    }
                }
                break;

            case 'heartbreak_finisher':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const player = this.gameState?.players?.get(playerId);
                    const state = player?.character?.passiveState;
                    const heartbreak = Number(state?.counters?.heartbreak) || 0;

                    const basePercent = Number(effect.base_percent) || 0;
                    const ultBonus = (caster && caster.id === 'zero_two')
                        ? (Number(state?.zeroTwoUltBaseBonus) || 0)
                        : 0;
                    const perHb = Number(effect.per_heartbreak_percent) || 0;
                    const mult = Math.max(0, basePercent + ultBonus + (heartbreak * perHb));
                    const atk = Number(caster?.stats?.attack) || 0;

                    const intended = Math.floor(atk * mult);
                    if (intended > 0) {
                        result.damage = await this.applyDamage(target, intended, targetId, playerId);
                    }

                    const consumeCfg = effect.consume_heartbreak;
                    if (state && state.counters) {
                        if (typeof consumeCfg === 'number' && Number.isFinite(consumeCfg)) {
                            const cur = Math.max(0, Math.floor(Number(state.counters.heartbreak) || 0));
                            const consumeN = Math.max(0, Math.floor(consumeCfg));
                            state.counters.heartbreak = Math.max(0, cur - consumeN);
                        } else {
                            const consumeAll = (typeof consumeCfg === 'boolean') ? consumeCfg : true;
                            if (consumeAll) {
                                state.counters.heartbreak = 0;
                            }
                        }
                    }
                }
                break;

            case 'heal_from_heartbreak':
                {
                    const player = this.gameState?.players?.get(playerId);
                    const state = player?.character?.passiveState;
                    const heartbreak = Number(state?.counters?.heartbreak) || 0;
                    const healPer = Number(effect.heal_per_heartbreak) || 0;
                    const healAmount = Math.floor(Math.max(0, heartbreak) * Math.max(0, healPer));

                    if (healAmount > 0) {
                        await this.applyHealing(caster, healAmount, playerId);
                        result.healing = (Number(result.healing) || 0) + healAmount;
                    }
                }
                break;

            case 'damage':
                result.damage = this.calculateDamage(effect, caster, target);
                const damageTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, damageTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, damageTargetId, result, override, 'damage');
                break;

            case 'damage_remove_stance_true_if_removed':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;
                    const removed = this.removeStanceEffects(targetId);

                    // True damage should ignore defense during calculation.
                    // calculateDamage() includes defense mitigation, so for the true-damage branch we
                    // compute from raw scaling instead.
                    const atk = Math.max(0, Math.floor(Number(caster?.stats?.attack) || 0));
                    const ratio = Number(effect.value);
                    const rawRatio = Number.isFinite(ratio) ? ratio : 0;

                    const intended = removed > 0
                        ? Math.max(0, Math.floor(atk * rawRatio))
                        : this.calculateDamage(effect, caster, target);
                    if (intended > 0) {
                        result.damage = removed > 0
                            ? await this.applyTrueDamage(target, intended, targetId, playerId)
                            : await this.applyDamage(target, intended, targetId, playerId);
                    }
                }
                break;

            case 'damage_and_heat':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;
                    const intended = this.calculateDamage(effect, caster, target);
                    result.damage = await this.applyDamage(target, intended, targetId, playerId);

                    const gain = Math.floor(Number(effect.heat_gain) || 0);
                    const cap = (typeof effect.heat_cap === 'number') ? effect.heat_cap : 100;
                    if (gain !== 0) {
                        this.addCounterValue(playerId, 'heat', gain, 0, cap);
                    }
                }
                break;

            case 'generate_heat_then_vent_to_heal':
                {
                    const gain = Math.max(0, Math.floor(Number(effect.heat_gain) || 0));
                    const cap = (typeof effect.heat_cap === 'number') ? effect.heat_cap : 100;
                    if (gain > 0) {
                        this.addCounterValue(playerId, 'heat', gain, 0, cap);
                    }

                    const per = Math.max(0, Math.floor(Number(effect.heal_per_heat_vented) || 0));
                    if (per <= 0) break;

                    const maxHealth = Math.max(0, Math.floor(Number(caster?.stats?.maxHealth) || 0));
                    const curHealth = Math.max(0, Math.floor(Number(caster?.stats?.health) || 0));
                    const missing = Math.max(0, maxHealth - curHealth);
                    if (missing <= 0) break;

                    const heat = Math.max(0, Math.floor(this.getCounterValue(playerId, 'heat')));
                    if (heat <= 0) break;

                    const vent = Math.min(heat, Math.ceil(missing / per));
                    if (vent > 0) {
                        this.addCounterValue(playerId, 'heat', -vent, 0, cap);
                        const heal = Math.max(0, vent * per);
                        const actual = await this.applyHealing(caster, heal, playerId);
                        result.healing = (Number(result.healing) || 0) + actual;
                    }
                }
                break;

            case 'vent_heat_and_heal':
                {
                    const healAmount = this.calculateHealing(effect, caster, 'heal_scaling');
                    if (Number.isFinite(healAmount) && healAmount > 0) {
                        const actual = await this.applyHealing(caster, healAmount, playerId);
                        result.healing = (result.healing || 0) + actual;
                    }

                    const vent = Math.floor(Number(effect.heat_vent) || 0);
                    if (vent > 0) {
                        const before = this.getCounterValue(playerId, 'heat');
                        this.addCounterValue(playerId, 'heat', -vent, 0, 100);
                        const after = this.getCounterValue(playerId, 'heat');
                        const vented = Math.max(0, before - after);

                        const per = Math.floor(Number(effect.bonus_heal_per_heat_vented) || 0);
                        const bonus = Math.max(0, vented * Math.max(0, per));
                        if (bonus > 0) {
                            await this.applyHealing(caster, bonus, playerId);
                            result.healing = (Number(result.healing) || 0) + bonus;
                        }
                    }
                }
                break;

            case 'redline_combo':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const heat = this.getCounterValue(playerId, 'heat');
                    const basePercent = Number(effect.base_percent) || 0;
                    const perHeat = Number(effect.per_heat_percent) || 0;
                    const mult = Math.max(0, basePercent + (heat * perHeat));
                    const atk = Number(caster?.stats?.attack) || 0;
                    const intended = Math.floor(atk * mult);

                    if (intended > 0) {
                        result.damage = await this.applyDamage(target, intended, targetId, playerId);
                    }

                    const consume = (typeof effect.consume_heat === 'boolean') ? effect.consume_heat : true;
                    if (consume) {
                        this.setCounterValue(playerId, 'heat', 0);
                    }
                }
                break;

            case 'damage_with_counter':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const key = effect.counter || '';
                    const counter = key ? this.getCounterValue(playerId, key) : 0;

                    const basePercent = Number(effect.base_percent) || 0;
                    const per = Number(effect.per_counter_percent) || 0;
                    const multRaw = basePercent + (counter * per);
                    const minMult = (typeof effect.min_multiplier === 'number') ? effect.min_multiplier : 0;
                    const mult = Math.max(minMult, multRaw);

                    const atk = Number(caster?.stats?.attack) || 0;
                    const intendedBase = Math.floor(atk * mult);
                    const intended = this.calculateDamage({ value: intendedBase }, caster, target);
                    if (intended > 0) {
                        result.damage = await this.applyDamage(target, intended, targetId, playerId);
                    }
                }
                break;

            case 'damage_with_counter_and_heal':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const key = effect.counter || '';
                    const counter = key ? this.getCounterValue(playerId, key) : 0;

                    const basePercent = Number(effect.base_percent) || 0;
                    const per = Number(effect.per_counter_percent) || 0;
                    const multRaw = basePercent + (counter * per);
                    const minMult = (typeof effect.min_multiplier === 'number') ? effect.min_multiplier : 0;
                    const mult = Math.max(minMult, multRaw);

                    const atk = Number(caster?.stats?.attack) || 0;
                    const intendedBase = Math.floor(atk * mult);
                    const intended = this.calculateDamage({ value: intendedBase }, caster, target);
                    if (intended > 0) {
                        result.damage = await this.applyDamage(target, intended, targetId, playerId);
                    }

                    const healValue = Number(effect.heal_value) || 0;
                    const healScaling = effect.heal_scaling;
                    let healAmount = 0;
                    if (healScaling === 'max_health') {
                        healAmount = Math.floor((Number(caster?.stats?.maxHealth) || 0) * healValue);
                    } else {
                        healAmount = Math.floor(healValue);
                    }
                    if (healAmount > 0) {
                        result.healing = await this.applyHealing(caster, healAmount, playerId);
                    }
                }
                break;

            case 'damage_repeat_by_counter':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const key = effect.counter || '';
                    const rawCounter = key ? this.getCounterValue(playerId, key) : 0;
                    const onlyPositive = (typeof effect.only_positive_counter === 'boolean') ? effect.only_positive_counter : false;
                    const counter = onlyPositive ? Math.max(0, rawCounter) : rawCounter;

                    const includeBase = (typeof effect.include_base_hit === 'boolean') ? effect.include_base_hit : true;
                    const repeats = Math.max(0, Math.floor(counter));
                    const hitCount = (includeBase ? 1 : 0) + repeats;

                    const perHitIntended = this.calculateDamage(effect, caster, target);
                    if (perHitIntended > 0 && hitCount > 0) {
                        let total = 0;
                        for (let i = 0; i < hitCount; i++) {
                            total += await this.applyDamage(target, perHitIntended, targetId, playerId);
                        }
                        result.damage = (Number(result.damage) || 0) + total;
                    }
                }
                break;

            case 'damage_and_kiss':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const intended = this.calculateDamage(effect, caster, target);
                    result.damage = await this.applyDamage(target, intended, targetId, playerId);
                    await this.applyProcDamageIfAny(caster, target, playerId, targetId, result, override, 'damage_and_kiss');

                    const duration = Math.max(1, Math.floor(Number(effect.kiss_duration) || 1));
                    this.applyKissMark(targetId, duration);
                    result.effects.push('Kissed');
                }
                break;

            case 'consume_kiss':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    // Consume Kiss Mark (even if stored healing isn't used by this variant)
                    this.consumeKissStoredHealing(targetId);

                    // Zero Two: Heartbreak Harvest
                    // Deal (base_percent + per_heartbreak_percent * Heartbreak) * ATK as damage.
                    // Defense is applied in applyDamage(), after the multiplier.
                    const player = this.gameState?.players?.get(playerId);
                    const state = player?.character?.passiveState;
                    const heartbreak = Number(state?.counters?.heartbreak) || 0;

                    const basePercent = Number(effect.base_percent) || 0;
                    const perHb = Number(effect.per_heartbreak_percent) || 0;
                    const mult = Math.max(0, basePercent + (heartbreak * perHb));
                    const atk = Number(caster?.stats?.attack) || 0;

                    const noDamage = Boolean(effect.no_damage);
                    if (!noDamage) {
                        const intended = Math.floor(atk * mult);
                        if (intended > 0) {
                            result.damage = await this.applyDamage(target, intended, targetId, playerId);
                        }
                    }

                    const consumeCfg = effect.consume_heartbreak;
                    if (state && state.counters) {
                        if (typeof consumeCfg === 'number' && Number.isFinite(consumeCfg)) {
                            const cur = Math.max(0, Math.floor(Number(state.counters.heartbreak) || 0));
                            const consumeN = Math.max(0, Math.floor(consumeCfg));
                            state.counters.heartbreak = Math.max(0, cur - consumeN);
                        } else {
                            const consumeAll = Boolean(consumeCfg);
                            if (consumeAll) {
                                state.counters.heartbreak = 0;
                            }
                        }
                    }

                    const healPer = Number(effect.heal_per_heartbreak) || 0;
                    const healAmount = Math.floor(Math.max(0, heartbreak) * Math.max(0, healPer));
                    if (healAmount > 0) {
                        await this.applyHealing(caster, healAmount, playerId);
                        result.healing = (Number(result.healing) || 0) + healAmount;
                    }
                }
                break;

            case 'kiss_of_death_ultimate':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;

                    const player = this.gameState?.players?.get(playerId);
                    const state = player?.character?.passiveState;
                    const heartbreak = Number(state?.counters?.heartbreak) || 0;

                    const stored = this.consumeKissStoredHealing(targetId);
                    const base = this.calculateDamage(effect.base_damage || {}, caster, target);
                    const storedRatio = Number(effect.stored_ratio) || 0;
                    const heartbreakRatio = Number(effect.heartbreak_ratio) || 0;
                    const total = Math.max(0, Math.floor(base + (stored * storedRatio) + (heartbreak * heartbreakRatio)));

                    if (total > 0) {
                        result.damage = await this.applyTrueDamage(target, total, targetId, playerId);
                    }

                    if (state && state.counters) {
                        state.counters.heartbreak = 0;
                    }

                    result.effects.push('KISS OF DEATH');
                }
                break;

            case 'multi_scaling_damage':
                {
                    const targetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                    let parts = Array.isArray(effect.components) ? effect.components : [];

                    if (effect.randomizeComponentsEachTurn && parts.length > 1 && this.gameState) {
                        const seedPrefix = `${this.gameState.gameId || 'game'}:${this.gameState.turnCount || 0}:${playerId}:multi:${(override && override.skillId) || ''}`;
                        const shuffled = parts.slice();
                        for (let i = shuffled.length - 1; i > 0; i--) {
                            const r = this.deterministicRandom(`${seedPrefix}:${i}`);
                            const j = Math.floor(r * (i + 1));
                            const tmp = shuffled[i];
                            shuffled[i] = shuffled[j];
                            shuffled[j] = tmp;
                        }
                        parts = shuffled;
                    }

                    const multiHit = Boolean(effect.multiHit);
                    if (multiHit) {
                        const hitCount = Math.max(1, Math.floor(Number(effect.hitCount) || 1));
                        const hits = hitCount > 1
                            ? Array.from({ length: hitCount }, (_, i) => parts[i % Math.max(1, parts.length)])
                            : parts;
                        let totalDamage = 0;
                        for (const part of hits) {
                            if (!part) continue;
                            const val = Number(part.value) || 0;
                            if (val === 0) continue;

                            let base = 0;
                            if (part.scaling === 'attack') base = (Number(caster.stats.attack) || 0) * val;
                            else if (part.scaling === 'defense') base = (Number(caster.stats.defense) || 0) * val;
                            else if (part.scaling === 'max_health') base = (Number(caster.stats.maxHealth) || 0) * val;
                            else if (part.scaling === 'current_health') base = (Number(caster.stats.health) || 0) * val;
                            else base = val;

                            const perHitDamage = this.calculateDamage({ scaling: 'flat', value: base }, caster, target);
                            const applied = await this.applyDamage(target, perHitDamage, targetId, playerId);
                            totalDamage += (Number(applied) || 0);
                        }

                        result.damage = totalDamage;
                    } else {
                        let total = 0;
                        for (const part of parts) {
                            if (!part) continue;
                            const val = Number(part.value) || 0;
                            if (val === 0) continue;

                            let base = 0;
                            if (part.scaling === 'attack') base = (Number(caster.stats.attack) || 0) * val;
                            else if (part.scaling === 'defense') base = (Number(caster.stats.defense) || 0) * val;
                            else if (part.scaling === 'max_health') base = (Number(caster.stats.maxHealth) || 0) * val;
                            else if (part.scaling === 'current_health') base = (Number(caster.stats.health) || 0) * val;
                            else base = val;

                            total += base;
                        }

                        const summedDamage = this.calculateDamage({ scaling: 'flat', value: total }, caster, target);
                        result.damage = await this.applyDamage(target, summedDamage, targetId, playerId);
                        await this.applyProcDamageIfAny(caster, target, playerId, targetId, result, override, 'multi_scaling_damage');
                    }
                }
                break;

            case 'self_true_damage_and_damage':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const selfDmg = Math.max(0, Math.floor(Number(effect.self_damage) || 0));
                    if (selfDmg > 0) {
                        await this.applyTrueDamage(caster, selfDmg, playerId, playerId);
                    }
                    result.damage = this.calculateDamage(effect, caster, target);
                    result.damage = await this.applyDamage(target, result.damage, opponentId, playerId);
                    await this.applyProcDamageIfAny(caster, target, playerId, opponentId, result, override, 'self_true_damage_and_damage');
                }
                break;

            case 'self_true_damage_then_heal_and_permanent_base_buff':
                {
                    const selfDmg = Math.max(0, Math.floor(Number(effect.self_damage) || 0));
                    if (selfDmg > 0) {
                        await this.applyTrueDamage(caster, selfDmg, playerId, playerId);
                    }

                    result.healing = this.calculateHealing(effect, caster, 'heal_scaling');
                    await this.applyHealing(caster, result.healing, playerId);

                    if (effect.permanent && effect.permanent.stat) {
                        if (!caster.baseStats) caster.baseStats = { ...caster.stats };

                        const statKey = this.normalizeStatKey(effect.permanent.stat);
                        const mode = effect.permanent.mode;
                        const val = Number(effect.permanent.value) || 0;

                        if (mode === 'multiplier') {
                            const base = Number(caster.baseStats[statKey]) || 0;
                            caster.baseStats[statKey] = base + Math.ceil(base * val);
                        } else {
                            caster.baseStats[statKey] = (Number(caster.baseStats[statKey]) || 0) + val;
                        }

                        this.recalculateStats(playerId);
                    }
                }
                break;

            case 'self_true_damage_then_heal_and_buff':
                {
                    const selfDmg = Math.max(0, Math.floor(Number(effect.self_damage) || 0));
                    if (selfDmg > 0) {
                        await this.applyTrueDamage(caster, selfDmg, playerId, playerId);
                    }

                    result.healing = this.calculateHealing(effect, caster, 'heal_scaling');
                    await this.applyHealing(caster, result.healing, playerId);

                    if (effect.buff) {
                        await this.applyBuff(caster, effect.buff, playerId);
                    }
                }
                break;

            case 'damage_and_permanent_stat':
                {
                    const targetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                    result.damage = this.calculateDamage(effect, caster, target);
                    result.damage = await this.applyDamage(target, result.damage, targetId, playerId);
                    await this.applyProcDamageIfAny(caster, target, playerId, targetId, result, override, 'damage_and_permanent_stat');

                    if (effect.permanent && effect.permanent.stat) {
                        if (!caster.baseStats) caster.baseStats = { ...caster.stats };
                        const statKey = this.normalizeStatKey(effect.permanent.stat);
                        const delta = Number(effect.permanent.value) || 0;
                        caster.baseStats[statKey] = (Number(caster.baseStats[statKey]) || 0) + delta;
                        this.recalculateStats(playerId);
                    }
                }
                break;

            case 'devour_copy_skill':
                {
                    const copied = caster.devourSkill;
                    if (copied && copied.effect) {
                        const tmp = { ...copied, cooldown: 0 };
                        const copiedResult = await this.applySkillEffect(tmp.effect, caster, target, gameState, playerId, override);
                        result.damage = (result.damage || 0) + (copiedResult.damage || 0);
                        result.healing = (result.healing || 0) + (copiedResult.healing || 0);
                        if (copiedResult.poisonApplied) result.poisonApplied = true;
                        if (typeof copiedResult.lightningDamage === 'number') result.lightningDamage = copiedResult.lightningDamage;
                    }
                }
                break;

            case 'damage_bleed_and_heal':
                {
                    const targetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                    result.damage = this.calculateDamage(effect, caster, target);
                    result.damage = await this.applyDamage(target, result.damage, targetId, playerId);
                    await this.applyProcDamageIfAny(caster, target, playerId, targetId, result, override, 'damage_bleed_and_heal');

                    if (effect.bleed) {
                        await this.applyBleed(target, effect.bleed, caster, targetId);
                    }

                    if (typeof effect.heal_value === 'number' && effect.heal_scaling) {
                        result.healing = this.calculateHealing(effect, caster, 'heal_scaling');
                        await this.applyHealing(caster, result.healing, playerId);
                    }
                }
                break;

            case 'heal':
                result.healing = this.calculateHealing(effect, caster);
                await this.applyHealing(caster, result.healing, playerId);
                break;

            case 'damage_with_lifesteal':
                result.damage = this.calculateDamage(effect, caster, target);
                const lifestealTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, lifestealTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, lifestealTargetId, result, override, 'damage_with_lifesteal');
                result.healing = result.damage > 0 ? Math.max(1, Math.floor(result.damage * (Number(effect.lifesteal) || 0))) : 0;
                if (result.healing > 0) {
                    await this.applyHealing(caster, result.healing, playerId);
                    result.lifestealDamage = result.damage;
                }
                break;

            case 'damage_and_poison':
                result.damage = this.calculateDamage(effect, caster, target);
                const poisonTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, poisonTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, poisonTargetId, result, override, 'damage_and_poison');
                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                await this.applyPoison(target, effect.poison, caster, opponentId);
                result.poisonApplied = true;
                break;

            case 'massive_poison':
                // Plague Doctor ultimate: apply a high-damage poison to the enemy (damage ticks on enemy end-of-turn)
                {
                    const poisonOpponentId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                    await this.applyPoison(target, effect.poison, caster, poisonOpponentId);
                    result.poisonApplied = true;
                }
                break;

            case 'buff':
                // Special handling for conceal - don't create regular buff
                if (effect.stat === 'conceal') {
                    console.log(`🛡️ BUFF CASE: Applying CONCEAL to ${caster.name} (${playerId}) for ${effect.duration} turns`);
                    this.applyConceal(caster, playerId, effect.duration);
                } else {
                    console.log(`📈 BUFF CASE: Applying regular buff: ${effect.stat}`);
                    await this.applyBuff(caster, effect, playerId);
                }
                break;

            case 'heal_and_buff':
                result.healing = this.calculateHealing(effect, caster);
                await this.applyHealing(caster, result.healing, playerId);
                await this.applyBuff(caster, effect.buff, playerId);
                break;

            case 'damage_with_heal':
                result.damage = this.calculateDamage(effect, caster, target);
                const healTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, healTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, healTargetId, result, override, 'damage_with_heal');
                if (typeof effect.heal_ratio === 'number') {
                    const ratioScaling = effect.heal_ratio_scaling;
                    if (ratioScaling === 'max_health') {
                        const maxHp = Number(caster?.stats?.maxHealth) || 0;
                        result.healing = maxHp > 0 ? Math.max(1, Math.ceil(maxHp * effect.heal_ratio)) : 0;
                    } else {
                        // Default: ratio is based on damage dealt.
                        result.healing = result.damage > 0 ? Math.max(1, Math.ceil(result.damage * effect.heal_ratio)) : 0;
                    }
                    if (result.healing > 0) {
                        await this.applyHealing(caster, result.healing, playerId);
                    }
                } else if (typeof effect.heal_value === 'number' && effect.heal_scaling) {
                    result.healing = this.calculateHealing(effect, caster, 'heal_scaling');
                    if (Number.isFinite(result.healing) && result.healing > 0) {
                        await this.applyHealing(caster, result.healing, playerId);
                    } else {
                        result.healing = 0;
                    }
                } else {
                    result.healing = 0;
                }
                break;

            case 'damage_and_heal':
                result.damage = this.calculateDamage(effect, caster, target);
                const damageHealTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, damageHealTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, damageHealTargetId, result, override, 'damage_and_heal');
                result.healing = this.calculateHealing(effect, caster, 'heal_scaling');
                await this.applyHealing(caster, result.healing, playerId);
                break;

            case 'damage_with_poison_consume':
                // Calculate base damage
                result.damage = this.calculateDamage(effect, caster, target);
                
                // Find and consume poison effects on target
                const targetPlayerId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                const poisonStacks = this.consumePoisonStacks(targetPlayerId);
                
                // Add bonus damage per poison stack
                const bonusDamage = Math.ceil(poisonStacks * effect.poison_bonus * caster.stats.attack);
                result.damage += bonusDamage;
                
                result.damage = await this.applyDamage(target, result.damage, targetPlayerId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, targetPlayerId, result, override, 'damage_with_poison_consume');
                result.effects.push(`Consumed ${poisonStacks} poison stacks for ${bonusDamage} bonus damage`);
                break;

            case 'damage_and_debuff':
                result.damage = this.calculateDamage(effect, caster, target);
                const debuffTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, debuffTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, debuffTargetId, result, override, 'damage_and_debuff');
                if (effect.debuff && effect.debuff.type === 'bleed') {
                    await this.applyBleed(target, effect.debuff, caster, debuffTargetId);
                } else {
                    await this.applyDebuff(target, effect.debuff, debuffTargetId);
                }
                break;

            case 'debuff_and_self_buff':
                {
                    const opponentId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                    if (effect.debuff) {
                        await this.applyDebuff(target, effect.debuff, opponentId);
                    }
                    if (effect.self_buff) {
                        await this.applyBuff(caster, effect.self_buff, playerId);
                    }
                }
                break;

            case 'damage_and_full_heal':
                result.damage = this.calculateDamage(effect, caster, target);
                {
                    const dmgTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                    result.damage = await this.applyDamage(target, result.damage, dmgTargetId, playerId);
                    await this.applyProcDamageIfAny(caster, target, playerId, dmgTargetId, result, override, 'damage_and_full_heal');
                }
                // Heal caster to full
                caster.stats.health = caster.stats.maxHealth;
                break;

            case 'critical_damage':
                // Implement as normal damage (crit flag can drive passive effects)
                result.damage = this.calculateDamage(effect, caster, target);
                {
                    const dmgTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                    result.damage = await this.applyDamage(target, result.damage, dmgTargetId, playerId);
                    await this.applyProcDamageIfAny(caster, target, playerId, dmgTargetId, result, override, 'critical_damage');
                }

                // Artemis passive: crit_heal
                if (caster.passive && caster.passive.type === 'dual_passive' && caster.passive.ongoing_effect && caster.passive.ongoing_effect.type === 'crit_heal') {
                    const ratio = Number(caster.passive.ongoing_effect.heal_ratio) || 0;
                    if (ratio > 0) {
                        const healAmount = Math.max(1, Math.ceil((Number(caster.stats.maxHealth) || 0) * ratio));
                        result.healing = (result.healing || 0) + healAmount;
                        await this.applyHealing(caster, healAmount, playerId);
                    }
                }
                break;

            case 'sacrifice_damage':
                {
                    const currentHp = Number(caster.stats.health) || 0;
                    const sacrificeRatio = Number(effect.sacrifice_ratio) || 0;
                    const sacrificeAmount = Math.max(0, Math.floor(currentHp * sacrificeRatio));
                    caster.stats.health = Math.max(0, currentHp - sacrificeAmount);

                    const dealt = Math.max(1, Math.ceil(sacrificeAmount * (Number(effect.damage_multiplier) || 1)));
                    const victimId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                    result.damage = await this.applyDamage(target, dealt, victimId, playerId);
                    await this.applyProcDamageIfAny(caster, target, playerId, victimId, result, override, 'sacrifice_damage');
                }
                break;

            case 'damage_with_stat_reduction':
                // Kraken ultimate: damage + reduce enemy stats for duration
                result.damage = this.calculateDamage(effect, caster, target);
                {
                    const victimId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                    result.damage = await this.applyDamage(target, result.damage, victimId, playerId);
                    await this.applyProcDamageIfAny(caster, target, playerId, victimId, result, override, 'damage_with_stat_reduction');
                    const reduction = Number(effect.stat_reduction) || 0;
                    const duration = Number(effect.duration) || 0;
                    if (reduction !== 0 && duration > 0) {
                        await this.applyDebuff(target, { stat: 'attack', value: -reduction, duration }, victimId);
                        await this.applyDebuff(target, { stat: 'defense', value: -reduction, duration }, victimId);
                    }
                }
                break;

            case 'damage_with_curse':
                result.damage = this.calculateDamage(effect, caster, target);
                const curseTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, curseTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, curseTargetId, result, override, 'damage_with_curse');
                if (effect.curse) {
                    await this.applyCurse(target, effect.curse, caster, curseTargetId);
                }
                break;

            case 'damage_with_stun':
                result.damage = this.calculateDamage(effect, caster, target);
                const stunTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, stunTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, stunTargetId, result, override, 'damage_with_stun');

                let stunApplied = false;
                if (typeof override.stunApplied === 'boolean') {
                    stunApplied = override.stunApplied;
                } else if (effect.stun_chance) {
                    stunApplied = Math.random() < effect.stun_chance;
                } else if (effect.stun_duration) {
                    // Guaranteed stun
                    stunApplied = true;
                }

                if (stunApplied && effect.stun_duration) {
                    await this.applyStun(target, effect.stun_duration, stunTargetId);
                }

                result.stunApplied = stunApplied;
                result.stunDuration = stunApplied ? effect.stun_duration : 0;
                break;

            case 'damage_and_stun':
                // Same as damage_with_stun but guaranteed if stun_duration is provided
                result.damage = this.calculateDamage(effect, caster, target);
                const guaranteedStunTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, guaranteedStunTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, guaranteedStunTargetId, result, override, 'damage_and_stun');

                // Deterministic in multiplayer if override provided; otherwise guaranteed
                {
                    let stunApplied = true;
                    if (typeof override.stunApplied === 'boolean') {
                        stunApplied = override.stunApplied;
                    }

                    if (stunApplied && effect.stun_duration) {
                        await this.applyStun(target, effect.stun_duration, guaranteedStunTargetId);
                    }

                    result.stunApplied = stunApplied;
                    result.stunDuration = stunApplied ? (effect.stun_duration || 0) : 0;
                }
                break;

            case 'damage_and_self_buff':
                result.damage = this.calculateDamage(effect, caster, target);
                const selfBuffTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, selfBuffTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, selfBuffTargetId, result, override, 'damage_and_self_buff');
                await this.applyBuff(caster, effect.self_buff, playerId);
                break;

            case 'damage_with_permanent_drain':
                // Lilith ultimate: damage + permanently steal % of enemy max health
                result.damage = this.calculateDamage(effect, caster, target);
                const drainVictimId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, drainVictimId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, drainVictimId, result, override, 'damage_with_permanent_drain');

                if (typeof effect.permanent_steal === 'number' && effect.permanent_steal > 0) {
                    const victim = this.getPlayerById(drainVictimId);
                    const stealer = this.getPlayerById(playerId);

                    if (victim && stealer) {
                        if (!victim.baseStats) victim.baseStats = { ...victim.stats };
                        if (!stealer.baseStats) stealer.baseStats = { ...stealer.stats };

                        const victimBaseMax = Number(victim.baseStats.maxHealth) || 0;
                        const stealAmount = Math.max(1, Math.ceil(victimBaseMax * effect.permanent_steal));

                        const victimCurrentHealth = Number(victim.stats.health) || 0;
                        const currentHpSteal = Math.max(0, Math.ceil(victimCurrentHealth * effect.permanent_steal));

                        victim.baseStats.maxHealth = Math.max(1, victimBaseMax - stealAmount);
                        stealer.baseStats.maxHealth = Math.max(1, (Number(stealer.baseStats.maxHealth) || 0) + stealAmount);

                        victim.stats.health = Math.max(0, victimCurrentHealth - currentHpSteal);
                        stealer.stats.health = (Number(stealer.stats.health) || 0) + currentHpSteal;

                        // Recalculate derived stats and clamp health
                        this.recalculateStats(drainVictimId);
                        this.recalculateStats(playerId);

                        if (victim.stats.health > victim.stats.maxHealth) {
                            victim.stats.health = victim.stats.maxHealth;
                        }

                        if (stealer.stats.health > stealer.stats.maxHealth) {
                            stealer.stats.health = stealer.stats.maxHealth;
                        }

                        result.effects.push(`Permanently stole ${stealAmount} max health`);
                        if (currentHpSteal > 0) {
                            result.effects.push(`Stole ${currentHpSteal} current health`);
                        }
                    }
                }
                break;

            case 'damage_heal_immunity':
                // Monarch ultimate: damage + heal to full + immunity
                result.damage = this.calculateDamage(effect, caster, target);
                const ultimateDamageTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                result.damage = await this.applyDamage(target, result.damage, ultimateDamageTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, ultimateDamageTargetId, result, override, 'damage_heal_immunity');

                // Heal caster to full
                caster.stats.health = caster.stats.maxHealth;

                if (effect.immunity_duration) {
                    this.applyImmunity(playerId, caster.id, effect.immunity_duration);
                }
                break;

            case 'debuff_and_heal': {
                const debuffTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');

                await this.applyDebuff(target, effect.debuff, debuffTargetId);

                // heal_target defaults to caster for backward compatibility
                const healTarget = effect.heal_target === 'target' ? 'target' : 'caster';
                const healRecipient = healTarget === 'target' ? target : caster;
                const healRecipientId = healTarget === 'target' ? debuffTargetId : playerId;

                result.healing = this.calculateHealing(effect, healRecipient, 'heal_scaling');
                await this.applyHealing(healRecipient, result.healing, healRecipientId);
                break;
            }

            case 'damage_with_drain':
                result.damage = this.calculateDamage(effect, caster, target);
                const drainTargetId = target === caster ? playerId : (playerId === 'player1' ? 'player2' : 'player1');
                await this.applyDamage(target, result.damage, drainTargetId, playerId);
                await this.applyProcDamageIfAny(caster, target, playerId, drainTargetId, result, override, 'damage_with_drain');
                const drainAmount = Math.ceil(target.stats.maxHealth * effect.drain_ratio);
                result.healing = drainAmount;
                await this.applyHealing(caster, drainAmount, playerId);
                break;

            case 'multi_buff':
                if (effect.buffs) {
                    for (const buff of effect.buffs) {
                        await this.applyBuff(caster, buff, playerId);
                    }
                }
                break;

            case 'transform_self':
                {
                    const toId = effect.transform_to;
                    if (toId) {
                        const keepSkillPalette = (typeof effect.keep_skill_palette === 'boolean')
                            ? effect.keep_skill_palette
                            : true;
                        const keepSkillCount = keepSkillPalette && Array.isArray(caster?.skills)
                            ? caster.skills.length
                            : null;
                        const keepSkillIds = keepSkillPalette && Array.isArray(caster?.skills)
                            ? caster.skills.map(s => s && s.id).filter(Boolean)
                            : null;
                        await this.transformCharacter(playerId, toId, {
                            preservePassiveState: Boolean(effect.preserve_passive_state),
                            keepSkillCount,
                            keepSkillIds
                        });
                    }

                    const healValue = Number(effect.heal_value) || 0;
                    if (healValue > 0) {
                        const healAmount = this.calculateHealing({ ...effect, value: healValue }, caster, 'heal_scaling');
                        if (Number.isFinite(healAmount) && healAmount > 0) {
                            result.healing = await this.applyHealing(caster, healAmount, playerId);
                        }
                    }
                }
                break;

            case 'shield':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = effect.target === 'self' ? playerId : opponentId;
                    const shieldTarget = effect.target === 'self' ? caster : target;

                    const amount = this.calculateShield(effect, caster);
                    if (amount > 0) {
                        await this.applyShield(shieldTarget, amount, targetId);
                    }
                }
                break;

            case 'array_domain':
                {
                    const duration = Math.max(1, Math.floor(Number(effect.duration) || 1));
                    // Only one domain can exist at a time
                    this.removeAllDomains();

                    const domainId = `array_domain_${Date.now()}`;
                    this.activeEffects.set(domainId, {
                        type: 'array_domain',
                        target: 'global',
                        ownerId: playerId,
                        duration,
                        turnsLeft: duration,
                        name: 'Domain',
                        description: `Damage becomes healing and healing becomes damage for ${duration} turns`
                    });

                    result.effects.push('Domain Activated');
                }
                break;

            case 'damage_or_heal_on_domain':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;
                    if (this.isDomainActive()) {
                        // Under domain, healing becomes damage (handled by applyHealing)
                        const healEffect = effect.domain_heal || {};
                        const intended = this.calculateHealing(healEffect, target, 'scaling');
                        result.healing = intended;
                        await this.applyHealing(target, intended, targetId);
                    } else {
                        const dmgEffect = effect.damage || {};
                        const intended = this.calculateDamage(dmgEffect, caster, target);
                        result.damage = await this.applyDamage(target, intended, targetId, playerId);
                        await this.applyProcDamageIfAny(caster, target, playerId, targetId, result, override, 'damage_or_heal_on_domain');
                    }
                }
                break;

            case 'self_true_damage_then_multi_buff':
                {
                    const selfDmg = Math.max(0, Math.floor(Number(effect.self_damage) || 0));
                    if (selfDmg > 0) {
                        await this.applyTrueDamage(caster, selfDmg, playerId, playerId);
                    }

                    if (Array.isArray(effect.buffs)) {
                        for (const buff of effect.buffs) {
                            await this.applyBuff(caster, buff, playerId);
                        }
                    }
                }
                break;
        }

        return result;
        } finally {
            if (!hadSink) {
                this.popAnimationSink();
            }
        }
    }

    async applyDamageNoDomain(target, damage, playerId, attackerIdOverride = undefined) {
        // Check if target is concealed (cannot take damage)
        if (this.isConcealed(playerId)) {
            console.log(`🛡️ DAMAGE BLOCKED: ${target.name} is concealed, damage blocked!`);
            return 0;
        }

        const character = this.getPlayerById(playerId);
        if (character && character.passive && character.passive.type === 'dual_passive' && character.passive.ongoing_effect) {
            const ongoing = character.passive.ongoing_effect;
            if (ongoing.type === 'damage_block' && typeof ongoing.block_chance === 'number' && ongoing.block_chance > 0) {
                const rand = this.deterministicRandom(`${this.gameState?.gameId || 'game'}:${this.gameState?.turnCount || 0}:${playerId}:block:${target.stats.health}:${damage}`);
                if (rand < ongoing.block_chance) {
                    if (this.gameState && typeof this.gameState.updateBlocksPerformed === 'function') {
                        this.gameState.updateBlocksPerformed(playerId);
                    }
                    return 0;
                }
            }
        }

        // Apply mark bonus damage
        const markBonus = this.getMarkBonus(playerId);
        let finalDamage = Math.max(1, Math.ceil(damage * (1 + markBonus)));

        const bleedAmp = this.getDamageTakenMultiplier(playerId);
        if (bleedAmp > 0) {
            finalDamage = Math.max(1, Math.ceil(finalDamage * (1 + bleedAmp)));
        }

        try {
            const ctx = this.getActiveActionContext();
            if (ctx && ctx.kind === 'skill' && ctx.skillId === 'room_incision') {
                const attackerId = attackerIdOverride === undefined ? this.gameState?.currentTurn : attackerIdOverride;
                const attacker = attackerId ? this.getPlayerById(attackerId) : null;
                const attackerSkill = attacker && Array.isArray(attacker.skills)
                    ? attacker.skills.find(s => s && s.id === 'room_incision')
                    : null;
                const atk = Number(attacker?.stats?.attack) || 0;
                const mult = Number(attackerSkill?.effect?.value);
                const base = Number.isFinite(mult) ? (atk * mult) : null;
                const def = Number(target?.stats?.defense) || 0;
                const dr = (Number(target?.stats?.damageReduction) || 0) / 100;
                const reduced = base === null ? null : Math.max(1, base - def);
                const expected = reduced === null ? null : Math.max(1, Math.ceil(reduced * (1 - dr)));
                console.log('ROOM_INCISION_DEBUG', {
                    attackerAtk: atk,
                    mult,
                    baseDamage: base,
                    targetDefense: def,
                    targetDamageReduction: Number(target?.stats?.damageReduction) || 0,
                    expectedAfterMitigation: expected,
                    damagePassedIntoApplyDamage: damage,
                    markBonus,
                    bleedAmp,
                    finalDamageAfterAmp: finalDamage
                });
            }
        } catch (e) {}

        // Edward Elric: Heat makes him take additional true damage (every 10 Heat => +1)
        {
            const victim = this.getPlayerById(playerId);
            if (victim && victim.id === 'edward_elric' && finalDamage > 0) {
                const heat = this.getCounterValue(playerId, 'heat');
                const extra = Math.max(0, Math.floor(heat / 10));
                if (extra > 0) {
                    await this.applyTrueDamageNoDomain(victim, extra, playerId, attackerIdOverride);

                    // If the additional true damage dropped Edward to 0, trigger revive immediately so
                    // multi-hit sequences continue against revived HP (when available).
                    if ((Number(victim?.stats?.health) || 0) === 0) {
                        await this.handleCharacterDeath(victim, playerId);
                    }
                }
            }
        }

        // Edward Elric: Heat makes him deal additional true damage (every 5 Heat => +1)
        {
            const attackerId = attackerIdOverride === undefined ? this.gameState?.currentTurn : attackerIdOverride;
            const attacker = attackerId ? this.getPlayerById(attackerId) : null;
            if (attacker && attacker.id === 'edward_elric') {
                const heat = this.getCounterValue(attackerId, 'heat');
                const extra = Math.max(0, Math.floor(heat / 5));
                if (extra > 0) {
                    await this.applyTrueDamageNoDomain(target, extra, playerId, attackerId);
                }
            }
        }

        const beforeShield = Number(target.stats.shield) || 0;
        const oldHealth = Number(target.stats.health) || 0;
        let _deathChecked = false;

        // Frieren: stance page sets a one-time "ignore stance on next hit" flag.
        // Convert it into an action-context flag for this damage instance.
        try {
            const attackerId = attackerIdOverride === undefined ? this.gameState?.currentTurn : attackerIdOverride;
            const ctx = this.getActiveActionContext();
            if (ctx && attackerId) {
                const attacker = this.getPlayerById(attackerId);
                const state = attacker?.character?.passiveState;
                if (state && state.ignoreTargetStanceNextHit) {
                    state.ignoreTargetStanceNextHit = false;
                    ctx.ignoreTargetStance = true;
                }
            }
        } catch (e) {
            // no-op
        }

        console.log(`💥 DAMAGE APPLIED: Dealing ${finalDamage} damage to ${target.name}`);

        let remaining = finalDamage;
        if (beforeShield > 0) {
            const absorbed = Math.min(beforeShield, remaining);
            target.stats.shield = beforeShield - absorbed;
            remaining -= absorbed;
            if ((Number(target.stats.shield) || 0) <= 0) {
                target.stats.shield = 0;
                target.stats.maxShield = 0;
            }
        }

        if (remaining > 0) {
            target.stats.health = Math.max(0, target.stats.health - remaining);
        }

        // Check for death and potential revive immediately so multi-hit sequences continue against revived HP.
        if ((Number(target.stats.health) || 0) === 0 && oldHealth > 0) {
            _deathChecked = true;
            await this.handleCharacterDeath(target, playerId);
        }

        {
            const grit = this.getGritEffect(playerId);
            if (grit && remaining > 0) {
                grit.storedDamage = Math.max(0, Math.floor(Number(grit.storedDamage) || 0)) + remaining;
            }
        }

        if (remaining > 0) {
            this.emitCombatText('damage', remaining, playerId);
        }

        console.log(`❤️ HEALTH UPDATE: ${target.name} health after damage: ${target.stats.health}`);

        // Track damage taken for passives / ultimate conditions
        if (this.gameState && typeof this.gameState.updateDamageThresholdPassive === 'function') {
            this.gameState.updateDamageThresholdPassive(playerId, remaining);
        }

        if (this.gameState && this.gameState.currentTurn) {
            const attackerId = attackerIdOverride === undefined ? this.gameState.currentTurn : attackerIdOverride;
            this.emitDamageEvents(attackerId, playerId, remaining);
        }

        // Reactive stances on damage taken
        try {
            const ctx = this.getActiveActionContext();
            const attackerId = attackerIdOverride === undefined ? this.gameState?.currentTurn : attackerIdOverride;
            const isEnemySkillDamage =
                remaining > 0 &&
                attackerId &&
                (attackerId === 'player1' || attackerId === 'player2') &&
                attackerId !== playerId &&
                ctx &&
                !ctx.isCounter &&
                (ctx.kind === 'skill' || ctx.kind === 'ultimate') &&
                ctx.attackerId === attackerId;

            const isEnemyCounterOrSkillDamage =
                remaining > 0 &&
                attackerId &&
                (attackerId === 'player1' || attackerId === 'player2') &&
                attackerId !== playerId &&
                ctx &&
                (ctx.kind === 'skill' || ctx.kind === 'ultimate' || ctx.kind === 'counter') &&
                ctx.attackerId === attackerId;

            // Naruto: Yin Serenity needs to know total damage taken across the full action (multi-hits).
            // Accumulate here; it will be consumed at the end of the action context in withActionContext().
            if (isEnemyCounterOrSkillDamage && ctx) {
                if (!ctx._damageTakenByTarget || typeof ctx._damageTakenByTarget !== 'object') {
                    ctx._damageTakenByTarget = {};
                }
                ctx._damageTakenByTarget[playerId] = (Number(ctx._damageTakenByTarget[playerId]) || 0) + remaining;
            }

            // Frieren stance ignore: suppress stance reactions for this attack without removing stance.
            if (isEnemySkillDamage && ctx && ctx.ignoreTargetStance) {
                return remaining;
            }

            if (isEnemySkillDamage) {
                let stance = null;
                for (const [, eff] of this.activeEffects.entries()) {
                    if (
                        eff &&
                        eff.type === 'stance' &&
                        eff.target === playerId &&
                        (Number(eff.turnsLeft) || 0) > 0
                    ) {
                        if (eff.stanceKey === 'dont_hurt_me_baby' || eff.key === 'dont_hurt_me_baby') {
                            stance = eff;
                            break;
                        }
                        if (eff.stanceKey === 'infinity_rebound' || eff.key === 'infinity_rebound') {
                            stance = eff;
                            break;
                        }
                    }
                }

                if (stance) {
                    const victim = this.getPlayerById(playerId);
                    const enemy = attackerId ? this.getPlayerById(attackerId) : null;

                    if (victim && enemy) {
                        if (stance.stanceKey === 'dont_hurt_me_baby' || stance.key === 'dont_hurt_me_baby') {
                            // Double heartbreak gain ONLY when damage was actually taken from a skill.
                            if (stance.doubleHeartbreakOnEnemySkillDamage) {
                                const gain = this.getHeartbreakGainForSkillType(victim, ctx.skillType);
                                if (gain > 0) {
                                    const cfg = this.getPassiveHeartbreakConfig(victim);
                                    const cap = cfg && typeof cfg.max === 'number' ? cfg.max : 100;
                                    this.addCounterValue(playerId, 'heartbreak', gain, 0, cap);
                                    if (this.passiveSystem && typeof this.passiveSystem.updateUltimateReady === 'function') {
                                        this.passiveSystem.updateUltimateReady(playerId);
                                    }
                                }
                            }

                            const heartbreak = this.getCounterValue(playerId, 'heartbreak');
                            const perHb = Number(stance.counterPercentPerHeartbreak) || 0;
                            const mult = Math.max(0, heartbreak * perHb);
                            const atk = Number(victim?.stats?.attack) || 0;
                            const intendedRaw = Math.floor(atk * mult);
                            const intended = (mult > 0 && atk > 0)
                                ? Math.max(1, intendedRaw)
                                : 0;

                            if (intended > 0) {
                                await this.withActionContext({
                                    kind: 'counter',
                                    attackerId: playerId,
                                    isCounter: true
                                }, async () => {
                                    await this.applyDamage(enemy, intended, attackerId, playerId);
                                });
                            }
                        }

                        if (stance.stanceKey === 'infinity_rebound' || stance.key === 'infinity_rebound') {
                            const reflected = Math.max(0, Math.floor(Number(remaining) || 0));
                            if (reflected > 0) {
                                await this.withActionContext({
                                    kind: 'counter',
                                    attackerId: playerId,
                                    isCounter: true
                                }, async () => {
                                    await this.applyDamage(enemy, reflected, attackerId, playerId);
                                    await this.applyHealing(enemy, Math.floor(reflected / 2), attackerId);
                                });
                            }
                        }
                    }
                }
            }

            // Edward Elric: Equivalent Exchange triggers on skill/ultimate AND counter hits (allows mirror chaining)
            if (isEnemyCounterOrSkillDamage) {
                let stance = null;
                for (const [, eff] of this.activeEffects.entries()) {
                    if (
                        eff &&
                        eff.type === 'stance' &&
                        eff.target === playerId &&
                        (eff.stanceKey === 'equivalent_exchange' || eff.key === 'equivalent_exchange') &&
                        (Number(eff.turnsLeft) || 0) > 0
                    ) {
                        stance = eff;
                        break;
                    }
                }

                if (stance) {
                    const enemy = attackerId ? this.getPlayerById(attackerId) : null;
                    if (enemy) {
                        const heat = Math.max(0, Math.floor(Number(stance.heat_on_trigger) || 0));
                        if (heat > 0) {
                            for (const pid of ['player1', 'player2']) {
                                this.addCounterValue(pid, 'heat', heat, 0, 100);
                            }
                        }

                        const ratio = Number(stance.counter_ratio);
                        const counterRatio = Number.isFinite(ratio) ? Math.max(0, ratio) : 0.65;
                        const hits = Math.max(1, Math.floor(Number(stance.counter_hits) || 2));
                        const intendedRaw = Math.max(0, Math.floor(remaining * counterRatio));
                        const intended = (counterRatio > 0 && remaining > 0)
                            ? Math.max(1, intendedRaw)
                            : 0;

                        if (intended > 0) {
                            await this.withActionContext({
                                kind: 'counter',
                                attackerId: playerId,
                                isCounter: true
                            }, async () => {
                                for (let i = 0; i < hits; i++) {
                                    await this.applyDamage(enemy, intended, attackerId, playerId);
                                }
                            });
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('Reactive stance handling failed:', e);
        }

        // Check for death and potential revive
        if (!_deathChecked && target.stats.health === 0 && oldHealth > 0) {
            await this.handleCharacterDeath(target, playerId);
        }

        return remaining;
    }

    async applyHealingNoDomain(target, healing, playerId = null) {
        if (playerId && this.isHealBlocked(playerId)) {
            return 0;
        }
        const before = Number(target.stats.health) || 0;
        const maxHealth = Number(target.stats.maxHealth) || 0;
        const actual = Math.max(0, Math.min(maxHealth - before, Math.floor(healing)));

        target.stats.health = before + actual;

        if (playerId && actual > 0) {
            this.emitCombatText('heal', actual, playerId);
        }

        // Gojo Satoru: Infinity Rebound inverts under Limitless Dominion.
        // While Limitless Dominion is active, enemy skill "damage" becomes healing.
        // When Gojo has the stance, react to this healing like the inverted rule describes.
        try {
            const ctx = this.getActiveActionContext();
            const attackerId = ctx && typeof ctx.attackerId === 'string' ? ctx.attackerId : null;
            const isEnemySkillHeal =
                actual > 0 &&
                playerId &&
                attackerId &&
                attackerId !== playerId &&
                (attackerId === 'player1' || attackerId === 'player2') &&
                ctx &&
                !ctx.isCounter &&
                (ctx.kind === 'skill' || ctx.kind === 'ultimate');

            if (isEnemySkillHeal && this.isDomainActive()) {
                let stance = null;
                for (const [, eff] of this.activeEffects.entries()) {
                    if (
                        eff &&
                        eff.type === 'stance' &&
                        eff.target === playerId &&
                        (eff.stanceKey === 'infinity_rebound' || eff.key === 'infinity_rebound') &&
                        (Number(eff.turnsLeft) || 0) > 0
                    ) {
                        stance = eff;
                        break;
                    }
                }

                if (stance) {
                    const enemy = this.getPlayerById(attackerId);
                    const reflected = Math.max(0, Math.floor(Number(actual) || 0));
                    if (enemy && reflected > 0) {
                        await this.withActionContext({
                            kind: 'counter',
                            attackerId: playerId,
                            isCounter: true
                        }, async () => {
                            // Desired behavior under Limitless Dominion:
                            // 1) "Restore" the same amount to enemy => applyHealing (becomes DAMAGE under domain)
                            // 2) Then deal damage equal to half of that damage dealt => applyDamage (becomes HEALING under domain)
                            const dealt = await this.applyHealing(enemy, reflected, attackerId);
                            const followUpRaw = Math.floor(dealt / 2);
                            const followUp = dealt > 0 ? Math.max(1, followUpRaw) : 0;
                            await this.applyDamage(enemy, followUp, attackerId, playerId);
                        });
                    }
                }
            }
        } catch (e) {
            console.warn('Infinity Rebound healing-react failed:', e);
        }

        // Zero Two: Kiss Mark stores healing the kissed target receives
        if (playerId) {
            const kiss = this.getActiveKissMark(playerId);
            if (kiss && actual > 0) {
                kiss.storedHealing = (Number(kiss.storedHealing) || 0) + actual;
            }
        }

        // Track healing for passive progress (if playerId is provided)
        if (playerId && this.gameState) {
            this.gameState.updateHealingPassive(playerId, actual);
        }

        if (playerId && this.passiveSystem && typeof this.passiveSystem.handleEvent === 'function') {
            this.passiveSystem.handleEvent(playerId, 'healing_done', { amount: actual });

            const opponentId = playerId === 'player1' ? 'player2' : (playerId === 'player2' ? 'player1' : null);
            if (opponentId) {
                this.passiveSystem.handleEvent(opponentId, 'opponent_healing_done', { amount: actual, targetId: playerId });

                // Zero Two: Heartbreak from healing should only apply while Kiss Mark is active.
                const kiss = this.getActiveKissMark(playerId);
                if (kiss && actual > 0) {
                    this.passiveSystem.handleEvent(opponentId, 'opponent_healing_done_kiss_mark', { amount: actual, targetId: playerId });
                }
            }
        }

        return actual;
    }

    async transformCharacter(playerId, transformToId, options = {}) {
        const character = this.getPlayerById(playerId);
        if (!character) return;
        if (!this.characterSystem || typeof this.characterSystem.getCharacter !== 'function') return;

        const template = await this.characterSystem.getCharacter(transformToId);
        if (!template) return;

        // Preserve live combat stats and baseStats; swap only the kit/identity parts.
        const preservedStats = character.stats ? { ...character.stats } : null;
        const preservedBase = character.baseStats ? { ...character.baseStats } : null;
        const preservedInitial = character.initialStats ? { ...character.initialStats } : null;
        const preservedPassiveState = options && options.preservePassiveState ? character.passiveState : null;

        character.id = template.id;
        character.name = template.name;
        character.images = template.images;
        character.skills = template.skills;

        // Keep the exact skill palette (by skill id + order) when requested.
        const keepSkillIds = (options && Array.isArray(options.keepSkillIds))
            ? options.keepSkillIds.map(x => String(x)).filter(Boolean)
            : null;
        if (keepSkillIds && Array.isArray(character.skills)) {
            const nextSkills = character.skills;
            const ordered = [];
            for (const id of keepSkillIds) {
                const found = nextSkills.find(s => s && s.id === id);
                if (found) ordered.push(found);
            }
            // If at least one match exists, use the ordered palette.
            // If no matches exist (unexpected), we fall back to the template skills but keepSkillCount (below)
            // will still prevent extra slots from appearing.
            if (ordered.length > 0) character.skills = ordered;
        }

        // Keep skill palette size consistent when requested (data-driven).
        const keepSkillCount = (options && typeof options.keepSkillCount === 'number')
            ? Math.max(0, Math.floor(options.keepSkillCount))
            : null;
        if (keepSkillCount !== null && Array.isArray(character.skills)) {
            character.skills = character.skills.slice(0, keepSkillCount);
        }
        character.ultimate = template.ultimate;
        character.passive = template.passive;

        if (preservedStats) character.stats = preservedStats;
        if (preservedBase) character.baseStats = preservedBase;
        if (preservedInitial) character.initialStats = preservedInitial;

        if (preservedPassiveState) {
            character.passiveState = preservedPassiveState;
        } else {
            character.passiveState = { counters: {}, totalHealingDone: 0, ultimateReady: false };
        }
        character.passiveProgress = {};

        // Transform should not carry ultimate readiness forward.
        // Example: Naruto enters Sage Mode, but the new kit's ultimate should require new progress.
        if (character.passiveState) {
            character.passiveState.ultimateReady = false;
            character.passiveState.lastSkillId = null;
        }

        // Also reset the owning player's ultimateReady flag; it may have been true from the previous kit.
        // The PassiveSystem will re-evaluate readiness for the new passive below.
        const owningPlayer = this.gameState?.players?.get(playerId);
        if (owningPlayer) {
            owningPlayer.ultimateReady = false;
        }

        // Naruto: entering Sage Mode resets Balance back to 0.
        if (transformToId === 'naruto_sage' && character.passiveState && character.passiveState.counters) {
            character.passiveState.counters.balance = 0;

            // Naruto: if we were at Balance +3 before transforming, remove the +10 ATK buff.
            if (this.activeEffects) {
                const balanceAtkBuffId = `balance_plus3_attack_${playerId}`;
                if (this.activeEffects.has(balanceAtkBuffId)) {
                    this.activeEffects.delete(balanceAtkBuffId);
                }
            }
        }

        // If we preserved counters (e.g., Naruto Sage Orbs), allow the new passive to reinterpret them.
        // Specifically: when entering Sage Mode, existing Sage Orbs should also start granting +1 ATK each.
        if (preservedPassiveState && character.passive && Array.isArray(character.passive.effects)) {
            const sageEff = character.passive.effects.find(e => e && e.type === 'sage_orbs' && typeof e.permanentAttackPerOrbGained === 'number');
            if (sageEff) {
                const key = sageEff.counter || 'sageOrbs';
                const orbs = Math.max(0, Math.floor(Number(character.passiveState?.counters?.[key]) || 0));
                const per = Math.floor(Number(sageEff.permanentAttackPerOrbGained) || 0);
                if (orbs > 0 && per > 0 && this.passiveSystem && typeof this.passiveSystem.applyPermanentStatDelta === 'function') {
                    this.passiveSystem.applyPermanentStatDelta(playerId, { attack: orbs * per });
                }
            }
        }

        if (character.passive && character.passive.alwaysUltimateReady) {
            const player = this.gameState?.players?.get(playerId);
            if (player) {
                player.ultimateReady = true;
            }
            if (character.passiveState) {
                character.passiveState.ultimateReady = true;
            }
        }

        // Re-evaluate ultimate readiness for the new passive mission/counters after transform.
        // This prevents old-kit readiness from leaking into the new kit.
        if (this.passiveSystem && typeof this.passiveSystem.updateUltimateReady === 'function') {
            this.passiveSystem.updateUltimateReady(playerId);
        }

        this.recalculateStats(playerId);
    }

    emitDamageEvents(attackerId, targetId, amount) {
        if (!this.passiveSystem || typeof this.passiveSystem.handleEvent !== 'function') return;
        if (!amount || amount <= 0) return;
        if (attackerId && attackerId !== targetId) {
            this.passiveSystem.handleEvent(attackerId, 'damage_dealt', { amount, targetId });
        }
        if (targetId) {
            this.passiveSystem.handleEvent(targetId, 'damage_taken', { amount, attackerId });
        }
    }

    calculateDamage(effect, caster, target) {
        let baseDamage = 0;

        switch (effect.scaling) {
            case 'attack':
                baseDamage = caster.stats.attack * effect.value;
                break;
            case 'damage_taken':
                baseDamage = (caster.stats.maxHealth - caster.stats.health) * effect.value;
                break;
            case 'enemy_missing_health':
                baseDamage = (target.stats.maxHealth - target.stats.health) * effect.value;
                break;
            default:
                baseDamage = effect.value;
        }

        const defense = target.stats.defense || 0;
        const damageReduction = (target.stats.damageReduction || 0) / 100;

        const reducedDamage = Math.max(1, baseDamage - defense);
        const finalDamage = reducedDamage * (1 - damageReduction);

        return Math.max(1, Math.ceil(finalDamage));
    }

    calculateShield(effect, caster) {
        let base = 0;
        const scaling = effect.shield_scaling || effect.scaling;
        const value = effect.shield_value !== undefined ? effect.shield_value : effect.value;

        switch (scaling) {
            case 'max_health':
                base = (Number(caster.stats.maxHealth) || 0) * (Number(value) || 0);
                break;
            case 'attack':
                base = (Number(caster.stats.attack) || 0) * (Number(value) || 0);
                break;
            default:
                base = Number(value) || 0;
        }

        return Math.max(0, Math.floor(base));
    }

    async applyShield(target, amount, playerId = null) {
        if (!target || !target.stats) return 0;
        const add = Math.max(0, Math.floor(Number(amount) || 0));
        if (add <= 0) return 0;

        if (this.isConstructionSiteActive()) {
            target.stats.shield = 0;
            return 0;
        }

        const before = Number(target.stats.shield) || 0;
        const next = before + add;
        target.stats.shield = next;
        target.stats.maxShield = Math.max(Number(target.stats.maxShield) || 0, next);
        return add;
    }

    calculateHealing(effect, caster, scalingKey = 'scaling') {
        let baseHealing = 0;
        const scaling = effect[scalingKey] || effect.scaling;
        
        // For damage_and_heal type, use heal_value if available, otherwise use value
        const healingValue = effect.heal_value !== undefined ? effect.heal_value : effect.value;

        switch (scaling) {
            case 'max_health':
                baseHealing = caster.stats.maxHealth * healingValue;
                break;
            case 'attack':
                baseHealing = caster.stats.attack * healingValue;
                break;
            default:
                baseHealing = healingValue;
        }

        return Math.max(1, Math.ceil(baseHealing));
    }

    async applyDamage(target, damage, playerId, attackerIdOverride) {
        if (this.isDomainActive()) {
            // Under domain, damage becomes healing
            return await this.applyHealingNoDomain(target, damage, playerId);
        }

        return await this.applyDamageNoDomain(target, damage, playerId, attackerIdOverride);
    }

    async applyTrueDamageNoDomain(target, damage, playerId, attackerIdOverride = undefined) {
        if (this.isConcealed(playerId)) {
            return 0;
        }

        const character = this.getPlayerById(playerId);
        if (character && character.passive && character.passive.type === 'dual_passive' && character.passive.ongoing_effect) {
            const ongoing = character.passive.ongoing_effect;
            if (ongoing.type === 'damage_block' && typeof ongoing.block_chance === 'number' && ongoing.block_chance > 0) {
                const rand = this.deterministicRandom(`${this.gameState?.gameId || 'game'}:${this.gameState?.turnCount || 0}:${playerId}:block:true:${target.stats.health}:${damage}`);
                if (rand < ongoing.block_chance) {
                    if (this.gameState && typeof this.gameState.updateBlocksPerformed === 'function') {
                        this.gameState.updateBlocksPerformed(playerId);
                    }
                    return 0;
                }
            }
        }

        const markBonus = this.getMarkBonus(playerId);
        let finalDamage = Math.max(0, Math.floor(damage * (1 + markBonus)));
        const bleedAmp = this.getDamageTakenMultiplier(playerId);
        if (bleedAmp > 0 && finalDamage > 0) {
            finalDamage = Math.max(1, Math.ceil(finalDamage * (1 + bleedAmp)));
        }
        if (finalDamage <= 0) return 0;

        const oldHealth = target.stats.health;
        target.stats.health = Math.max(0, target.stats.health - finalDamage);

        // Check for death and potential revive immediately so multi-hit sequences continue against revived HP.
        let _deathChecked = false;
        if ((Number(target.stats.health) || 0) === 0 && oldHealth > 0) {
            _deathChecked = true;
            await this.handleCharacterDeath(target, playerId);
        }

        {
            const grit = this.getGritEffect(playerId);
            if (grit && finalDamage > 0) {
                grit.storedDamage = Math.max(0, Math.floor(Number(grit.storedDamage) || 0)) + finalDamage;
            }
        }

        if (finalDamage > 0) {
            this.emitCombatText('damage', finalDamage, playerId);
        }

        if (this.gameState && typeof this.gameState.updateDamageThresholdPassive === 'function') {
            this.gameState.updateDamageThresholdPassive(playerId, finalDamage);
        }

        if (this.gameState && this.gameState.currentTurn) {
            const attackerId = attackerIdOverride === undefined ? this.gameState.currentTurn : attackerIdOverride;
            this.emitDamageEvents(attackerId, playerId, finalDamage);
        }

        if (!_deathChecked && target.stats.health === 0 && oldHealth > 0) {
            await this.handleCharacterDeath(target, playerId);
        }

        return finalDamage;
    }

    async applyTrueDamage(target, damage, playerId, attackerIdOverride = undefined) {
        if (this.isDomainActive()) {
            // Under domain, damage becomes healing
            return await this.applyHealingNoDomain(target, damage, playerId);
        }

        return await this.applyTrueDamageNoDomain(target, damage, playerId, attackerIdOverride);
    }

    async applyProcDamageIfAny(caster, target, casterPlayerId, targetPlayerId, result, override, seedKey) {
        if (!caster || !target) return;
        if (casterPlayerId === targetPlayerId) return;

        if (!caster.passive || caster.passive.type !== 'dual_passive' || !caster.passive.ongoing_effect) return;
        const ongoing = caster.passive.ongoing_effect;
        if (ongoing.type !== 'proc_damage') return;

        const chance = Number(ongoing.chance) || 0;
        const bonusRatio = Number(ongoing.bonus_damage) || 0;
        if (chance <= 0 || bonusRatio <= 0) return;

        let lightningDamage = 0;
        if (override && typeof override.lightningDamage === 'number') {
            lightningDamage = Math.max(0, Math.floor(override.lightningDamage));
        } else {
            const baseDamage = Number(result.damage) || 0;
            if (baseDamage <= 0) return;

            const seed = `${this.gameState?.gameId || 'game'}:${this.gameState?.turnCount || 0}:${casterPlayerId}:zeus:${seedKey}:${baseDamage}`;
            const rand = this.deterministicRandom(seed);
            if (rand >= chance) {
                result.lightningDamage = 0;
                return;
            }

            lightningDamage = Math.max(0, Math.floor(baseDamage * bonusRatio));
        }

        result.lightningDamage = lightningDamage;

        if (lightningDamage > 0) {
            const applied = await this.applyTrueDamage(target, lightningDamage, targetPlayerId, casterPlayerId);
            result.lightningDamage = applied;
            result.damage = (Number(result.damage) || 0) + applied;
        }
    }

    async applyHealing(target, healing, playerId = null) {
        if (this.isDomainActive()) {
            // Under domain, healing becomes damage
            const applied = await this.applyDamageNoDomain(target, healing, playerId, playerId);
            return applied;
        }

        return await this.applyHealingNoDomain(target, healing, playerId);
    }

    async applyBleed(target, bleedEffect, caster, playerId) {
        if (this.isConcealed(playerId)) {
            return;
        }

        if (this.isImmune(playerId)) {
            return;
        }

        const bleedId = `bleed_${playerId}_${Date.now()}`;

        const duration = Math.max(1, Math.floor(Number(bleedEffect?.duration) || 1));
        const amp = Number(bleedEffect?.damage_amp) || 0.5;

        this.activeEffects.set(bleedId, {
            type: 'bleed',
            target: playerId,
            characterId: target.id,
            damageAmp: amp,
            duration,
            turnsLeft: duration,
            name: 'Bleed',
            description: `Takes ${Math.round(amp * 100)}% more damage for ${duration} turns`
        });
    }

    async applyPoison(target, poisonEffect, caster, playerId) {
        // Check if target is concealed (cannot receive debuffs)
        if (this.isConcealed(playerId)) {
            return; // No poison applied if concealed
        }

        // Immunity blocks poison
        if (this.isImmune(playerId)) {
            return;
        }

        // Passive poison immunity
        if (target.passive && target.passive.type === 'dual_passive' && target.passive.ongoing_effect && target.passive.ongoing_effect.type === 'poison_immunity_and_skill_heal') {
            return;
        }

        let poisonDamage = Math.max(1, Math.ceil(this.calculateDamage(poisonEffect, caster, target)));

        // Passive poison boost
        if (caster.passive && caster.passive.type === 'dual_passive' && caster.passive.ongoing_effect && caster.passive.ongoing_effect.type === 'debuff_immunity_and_poison_boost') {
            const bonus = Number(caster.passive.ongoing_effect.poison_bonus) || 0;
            if (bonus > 0) {
                poisonDamage = Math.max(1, Math.ceil(poisonDamage * (1 + bonus)));
            }
        }
        const poisonId = `poison_${playerId}_${Date.now()}`;
        
        this.activeEffects.set(poisonId, {
            type: 'poison',
            target: playerId,
            characterId: target.id,
            damage: poisonDamage,
            duration: poisonEffect.duration,
            turnsLeft: poisonEffect.duration,
            name: 'Poison',
            description: `Takes ${poisonDamage} damage per turn for ${poisonEffect.duration} turns`
        });
    }

    async applyBuff(target, buffEffect, playerId) {
        // Immunity does not block buffs (self/ally positive effects)
        const buffId = `buff_${playerId}_${buffEffect.stat}_${Date.now()}`;
        const ctx = this.getActiveActionContext();
        const ownerId = ctx && (ctx.attackerId === 'player1' || ctx.attackerId === 'player2')
            ? ctx.attackerId
            : (this.gameState?.currentTurn === 'player1' || this.gameState?.currentTurn === 'player2'
                ? this.gameState.currentTurn
                : playerId);
        const normalizedStat = this.normalizeStatKey(buffEffect.stat);
        const buffMode = buffEffect.mode;
        const buffValue = Number(buffEffect.value) || 0;
        const buffText = (normalizedStat === 'damageReduction')
            ? `${buffEffect.stat} increased by ${Math.round(buffValue)}% for ${buffEffect.duration} turns`
            : (normalizedStat === 'lifesteal')
                ? `${buffEffect.stat} increased by ${Math.round(buffValue)}% for ${buffEffect.duration} turns`
                : (buffMode === 'flat')
                    ? `${buffEffect.stat} increased by ${Math.round(buffValue)} for ${buffEffect.duration} turns`
                    : `${buffEffect.stat} increased by ${Math.round(buffValue * 100)}% for ${buffEffect.duration} turns`;
        
        this.activeEffects.set(buffId, {
            type: 'buff',
            target: playerId,
            ownerId,
            characterId: target.id,
            stat: normalizedStat,
            value: buffValue,
            mode: buffEffect.mode,
            duration: buffEffect.duration,
            turnsLeft: buffEffect.duration,
            name: `${buffEffect.stat.charAt(0).toUpperCase() + buffEffect.stat.slice(1)} Boost`,
            description: buffText
        });

        if (this.passiveSystem && typeof this.passiveSystem.handleEvent === 'function') {
            const opponentId = playerId === 'player1' ? 'player2' : (playerId === 'player2' ? 'player1' : null);
            if (opponentId) {
                this.passiveSystem.handleEvent(opponentId, 'opponent_buff_applied', { targetId: playerId, stat: normalizedStat });
            }
        }

        this.recalculateStats(playerId);
    }

    async processEndOfTurnEffects(playerId) {
        const effectsToRemove = [];
        
        for (const [effectId, effect] of this.activeEffects.entries()) {
            if (effect.target === playerId || effect.target === 'global') {
                const isDot = (effect.type === 'poison' || effect.type === 'curse');
                const isGlobal = effect.target === 'global';

                if (isDot) {
                    const target = this.getPlayerById(playerId);
                    if (target) {
                        await this.applyDamage(target, effect.damage, playerId, null);
                    }
                    effect.turnsLeft--;
                } else if (isGlobal) {
                    // Global effects (e.g. Domain) tick each endTurn.
                    const isDomain = effect.type === 'array_domain' || effect.type === 'room_domain' || effect.type === 'frieren_domain' || effect.type === 'construction_site_domain' || effect.type === 'alchemy_domain';
                    const ownerId = effect.ownerId;

                    // Domains tick down only on the opponent's endTurn.
                    // Duration N means N opponent turns.
                    if (effect.type === 'construction_site_domain') {
                        // Construction Site affects both players: remove shields and deal true damage at end of each turn.
                        for (const pid of ['player1', 'player2']) {
                            const c = this.getPlayerById(pid);
                            if (c && c.stats && (Number(c.stats.shield) || 0) > 0) {
                                c.stats.shield = 0;
                            }
                        }

                        const victim = this.getPlayerById(playerId);
                        const dmg = Math.max(0, Math.floor(Number(effect.trueDamagePerTurn) || 0));
                        if (victim && dmg > 0) {
                            await this.applyTrueDamageNoDomain(victim, dmg, playerId, null);
                        }

                        // Tick down only on the opponent's endTurn.
                        if (ownerId && ownerId === playerId) {
                        } else {
                            effect.turnsLeft--;
                        }
                    } else if (isDomain && ownerId && ownerId === playerId) {
                    } else if (isDomain) {
                        effect.turnsLeft--;
                    } else if (effect && effect._skipNextDecrement) {
                        effect._skipNextDecrement = false;
                    } else {
                        effect.turnsLeft--;
                    }
                }
                
                if (effect.turnsLeft <= 0) {
                    effectsToRemove.push(effectId);
                }
            }
        }

        effectsToRemove.forEach(id => {
            this.activeEffects.delete(id);
        });

        // After effects have been removed, recompute derived stats from baseStats + remaining effects.
        if (effectsToRemove.length > 0) {
            this.recalculateStats(playerId);
        }

        // Apply end-of-turn passive effects (e.g., regeneration)
        const character = this.getPlayerById(playerId);
        if (character && character.passive && character.passive.type === 'dual_passive' && character.passive.ongoing_effect) {
            const ongoing = character.passive.ongoing_effect;

            if (ongoing.type === 'passive_heal' && typeof ongoing.value === 'number') {
                const healAmount = Math.max(1, Math.ceil(character.stats.maxHealth * ongoing.value));
                await this.applyHealing(character, healAmount, playerId);
            }

            if (ongoing.type === 'immunity_and_regen' && typeof ongoing.regen_ratio === 'number') {
                const healAmount = Math.max(1, Math.ceil(character.stats.maxHealth * ongoing.regen_ratio));
                await this.applyHealing(character, healAmount, playerId);
            }
        }
    }

    removeBuff(playerId, buffEffect) {
        this.recalculateStats(playerId);
    }

    removeDebuff(playerId, debuffEffect) {
        this.recalculateStats(playerId);
    }

    isConcealed(playerId) {
        console.log(`🔍 CONCEAL CHECK: Checking if ${playerId} is concealed`);
        console.log(`🔍 CONCEAL CHECK: Total active effects: ${this.activeEffects.size}`);
        
        for (const [effectId, effect] of this.activeEffects) {
            console.log(`🔍 CONCEAL CHECK: Effect ${effectId}:`, effect);
            if (effect.target === playerId && effect.type === 'conceal') {
                console.log(`✅ CONCEAL CHECK: ${playerId} IS CONCEALED!`);
                return true;
            }
        }
        
        console.log(`❌ CONCEAL CHECK: ${playerId} is NOT concealed`);
        return false;
    }

    async syncSkillEffects(skill, caster, target, gameState, playerId) {
        // Apply only the non-damage/healing effects to sync between players
        const effect = skill.effect;
        
        switch (effect.type) {
            case 'chen_piercing_assault':
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;
                    if (targetId === playerId) break;

                    const threshold = Math.max(0, Math.floor(Number(effect.shield_break_if_other_skill_stacks_at_least) || 0));
                    const stackIds = Array.isArray(effect.stack_skill_ids) ? effect.stack_skill_ids : [];
                    let shouldBreakShield = false;
                    if (threshold > 0 && stackIds.length > 0) {
                        for (const sid of stackIds) {
                            if (!sid) continue;
                            const stacks = this.getCooldownReductionStacksForSkill(playerId, sid);
                            if (stacks >= threshold) {
                                shouldBreakShield = true;
                                break;
                            }
                        }
                    }

                    if (shouldBreakShield && target && target.stats && (Number(target.stats.shield) || 0) > 0) {
                        target.stats.shield = 0;
                        target.stats.maxShield = 0;
                    }
                }
                break;

            case 'true_damage_and_apply_cdr_random_other':
                {
                    // Sync only the cooldown reduction targeting; damage is pre-calculated.
                    const ctxSkillId = skill && typeof skill.id === 'string' ? skill.id : null;
                    const seed = `${gameState?.gameId || 'game'}:${gameState?.turnCount || 0}:${playerId}:cdr:${ctxSkillId || 'none'}:skill_effect`;
                    if (typeof this.applyCooldownReductionToRandomOtherSkill === 'function') {
                        this.applyCooldownReductionToRandomOtherSkill(playerId, ctxSkillId, { amount: 1, seed });
                    }
                }
                break;

            case 'damage_with_cdr_stacks':
                {
                    const stackSkillId = typeof effect.stack_skill_id === 'string' && effect.stack_skill_id
                        ? effect.stack_skill_id
                        : null;

                    const stacks = stackSkillId ? this.getCooldownReductionStacksForSkill(playerId, stackSkillId) : 0;

                    // Sync Ch'en permanent defense gain (Dragon Strike) when sufficiently enhanced.
                    const permDefAt = Math.max(0, Math.floor(Number(effect.permanent_defense_if_stacks_at_least) || 0));
                    const permDef = Math.floor(Number(effect.permanent_defense_amount) || 0);
                    if (permDefAt > 0 && permDef !== 0 && stacks >= permDefAt) {
                        if (!caster.baseStats) caster.baseStats = { ...caster.stats };
                        caster.baseStats.defense = (Number(caster.baseStats.defense) || 0) + permDef;
                        this.recalculateStats(playerId);
                    }

                    // This effect only mutates stacks when reset_on_use is enabled.
                    if (effect.reset_stacks_on_use && stackSkillId) {
                        this.setCooldownReductionStacksForSkill(playerId, stackSkillId, 0);
                    }
                }
                break;

            case 'chen_ultimate_barrage':
                {
                    const stackSkillId = typeof effect.stack_skill_id === 'string' && effect.stack_skill_id
                        ? effect.stack_skill_id
                        : null;
                    const stacks = stackSkillId ? this.getCooldownReductionStacksForSkill(playerId, stackSkillId) : 0;

                    // Sync Ch'en ultimate cooldown reduction of other skills when sufficiently enhanced.
                    const cdrAt = Math.max(0, Math.floor(Number(effect.reduce_other_skill_cooldowns_if_stacks_at_least) || 0));
                    const cdrAmt = Math.max(0, Math.floor(Number(effect.reduce_other_skill_cooldowns_amount) || 0));
                    if (cdrAt > 0 && cdrAmt > 0 && stacks >= cdrAt) {
                        const skills = Array.isArray(caster?.skills) ? caster.skills : [];
                        for (const s of skills) {
                            if (!s || !s.id) continue;
                            if (s.id === stackSkillId) continue;
                            const remaining = Math.max(0, Math.floor(this.getSkillCooldown({ id: s.id }, playerId)));
                            if (remaining > 0) {
                                this.setSkillCooldown(s.id, playerId, Math.max(0, remaining - cdrAmt));
                            }

                            const buffCfg = s.cooldownReductionBuff && typeof s.cooldownReductionBuff === 'object'
                                ? s.cooldownReductionBuff
                                : null;
                            if (buffCfg) {
                                const maxStacks = (typeof buffCfg.maxStacks === 'number')
                                    ? Math.max(0, Math.floor(buffCfg.maxStacks))
                                    : null;
                                const cur = this.getCooldownReductionStacksForSkill(playerId, s.id);
                                const next = maxStacks === null ? (cur + cdrAmt) : Math.min(maxStacks, cur + cdrAmt);
                                this.setCooldownReductionStacksForSkill(playerId, s.id, next);
                            }
                        }
                    }

                    if (stackSkillId && effect.reset_stacks_on_use) {
                        this.setCooldownReductionStacksForSkill(playerId, stackSkillId, 0);
                    }
                }
                break;

            case 'stance':
                {
                    const turnsLeft = Math.max(1, Math.floor(Number(effect.enemy_turn_duration) || Number(effect.duration) || 1));
                    const defenseBonus = Math.floor(Number(effect.defense_bonus) || 0);
                    const healOnTurnStart = Math.floor(Number(effect.heal_on_turn_start) || 0);

                    const stanceKey = (typeof effect.stance_key === 'string' && effect.stance_key)
                        ? effect.stance_key
                        : 'stance';

                    for (const [id, e] of this.activeEffects.entries()) {
                        if (e && e.target === playerId && (e.type === 'stance' || e.key === 'stance' || e.stat === 'stance')) {
                            this.activeEffects.delete(id);
                        }
                    }

                    const id = `stance_${playerId}_${Date.now()}`;
                    this.activeEffects.set(id, {
                        type: 'stance',
                        key: stanceKey,
                        stanceKey,
                        target: playerId,
                        duration: turnsLeft,
                        turnsLeft,
                        name: typeof skill?.name === 'string' ? skill.name : (caster?.name ? `${caster.name} Stance` : 'Stance'),
                        description: typeof skill?.description === 'string' ? skill.description : `+${defenseBonus} defense. Heals ${healOnTurnStart} at the start of your turn.`,
                        defenseBonus,
                        healOnTurnStart,
                        doubleHeartbreakOnEnemySkillDamage: Boolean(effect.double_heartbreak_on_enemy_skill_damage),
                        counterPercentPerHeartbreak: Number(effect.counter_percent_per_heartbreak) || 0,

                        // Naruto: Yin Serenity
                        shieldRatioOnDamage: Number(effect.shield_ratio_on_damage),

                        // Edward Elric: Equivalent Exchange config
                        heat_on_trigger: Math.max(0, Math.floor(Number(effect.heat_on_trigger) || 0)),
                        counter_ratio: Number(effect.counter_ratio),
                        counter_hits: Math.max(0, Math.floor(Number(effect.counter_hits) || 0))
                    });

                    this.recalculateStats(playerId);
                }
                break;
            case 'buff':
                if (effect.stat === 'conceal') {
                    console.log(`Syncing conceal effect for ${playerId}`);
                    this.applyConceal(caster, playerId, effect.duration);
                } else {
                    this.applyBuff(caster, playerId, caster.id, effect.stat, effect.value, effect.duration);
                }
                break;
                
            case 'damage_and_poison':
                // Sync only the poison effect, not the damage
                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                await this.applyPoison(target, effect.poison, caster, opponentId);
                break;
                
            case 'heal_and_buff':
                // Sync only the buff effect, not the healing
                await this.applyBuff(caster, effect.buff, playerId);
                break;

            case 'self_true_damage_then_heal_and_buff':
                // Sync only the buff effect; self-damage/heal are handled by pre-calculated values
                if (effect.buff) {
                    await this.applyBuff(caster, effect.buff, playerId);
                }
                break;
                
            case 'damage_and_debuff':
                // Sync only the debuff effect, not the damage
                const debuffOpponentId = playerId === 'player1' ? 'player2' : 'player1';
                if (effect.debuff && effect.debuff.type === 'bleed') {
                    await this.applyBleed(target, effect.debuff, caster, debuffOpponentId);
                } else {
                    await this.applyDebuff(target, effect.debuff, debuffOpponentId);
                }
                break;

            case 'damage_remove_stance_true_if_removed':
                {
                    // Sync only the stance removal; damage is authoritative.
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const targetId = target === caster ? playerId : opponentId;
                    this.removeStanceEffects(targetId);
                }
                break;
                
            case 'damage_with_stun':
                // Sync only the stun effect, not the damage
                const stunOpponentId = playerId === 'player1' ? 'player2' : 'player1';
                if (effect.stun_duration) {
                    await this.applyStun(target, effect.stun_duration, stunOpponentId);
                }
                break;
                
            case 'damage_and_self_buff':
                // Sync only the self buff effect
                await this.applyBuff(caster, effect.self_buff, playerId);
                break;

            case 'archive_copycat_glyph':
                {
                    // Pages are local state; only sync the buff that enables the next double-cast.
                    const turnsLeft = Math.max(1, Math.floor(Number(effect.duration) || 1));
                    const id = `copycat_glyph_${playerId}_${Date.now()}`;
                    this.activeEffects.set(id, {
                        type: 'copycat_glyph',
                        target: playerId,
                        duration: turnsLeft,
                        turnsLeft,
                        name: 'Copycat Glyph',
                        description: 'Your next Minor Utility Spell triggers twice.'
                    });
                }
                break;

            case 'archive_minor_utility':
                {
                    // We only need to sync the debuff-ish effects it may apply.
                    // If this side used the heal-block branch, the authoritative result will have applied it already;
                    // we mirror it here based on the last archived page type.
                    const lastType = this.getArchiveLastPageType(playerId) || 'attack';
                    if (lastType === 'heal' || lastType === 'recovery' || lastType === 'utility') {
                        const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                        await this.applyHealBlock(opponentId, Math.max(1, Math.floor(Number(effect.heal_block_duration) || 2)));
                    }
                }
                break;
                
            case 'mark':
                // Sync the mark effect
                const markOpponentId = playerId === 'player1' ? 'player2' : 'player1';
                await this.applyMark(target, effect, markOpponentId);
                break;
                
            // Other effects that don't need syncing (pure damage/heal)
            case 'damage':
            case 'heal':
            case 'damage_with_lifesteal':
            case 'damage_with_heal':
            case 'damage_and_heal':
            case 'damage_with_poison_consume':
            case 'debuff_and_heal':
            case 'damage_with_drain':
            case 'multi_buff':
            case 'cleanse_and_heal':
                // These are handled by pre-calculated values, no sync needed
                break;
        }
    }

    async syncUltimateEffects(ultimate, caster, target, gameState, playerId) {
        // Apply only the non-damage/healing effects from ultimates
        const effect = ultimate.effect;
        
        switch (effect.type) {
            case 'buff':
                if (effect.stat === 'conceal') {
                    this.applyConceal(caster, playerId, effect.duration);
                } else {
                    this.applyBuff(caster, playerId, caster.id, effect.stat, effect.value, effect.duration);
                }
                break;
                
            case 'damage_and_poison':
                // Sync only the poison effect
                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                await this.applyPoison(target, effect.poison, caster, opponentId);
                break;

            case 'massive_poison':
                // Sync massive poison ultimate (Plague Doctor)
                {
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    await this.applyPoison(target, effect.poison, caster, opponentId);
                }
                break;

            case 'archive_grand_release':
                {
                    // Mirror the possible heal-blocks + final debuff.
                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                    const duration = Math.max(1, Math.floor(Number(effect.heal_block_duration) || 2));
                    await this.applyHealBlock(opponentId, duration);

                    const deb = Number(effect.final_attack_debuff) || 0;
                    const dur = Math.max(1, Math.floor(Number(effect.final_debuff_duration) || 2));
                    if (deb > 0) {
                        await this.applyDebuff(target, { stat: 'attack', value: -deb, duration: dur }, opponentId);
                    }
                }
                break;

            case 'frieren_minor_utility_barrage':
                {
                    // Sync only the status effects that could be applied by Minor Utility.
                    const casts = Math.max(1, Math.floor(Number(effect.casts) || 5));
                    const pages = this.getArchivePages(playerId).slice(0, casts);
                    if (!pages || pages.length <= 0) break;

                    const opponentId = playerId === 'player1' ? 'player2' : 'player1';

                    for (const pageType of pages) {
                        if (pageType === 'ultimate') {
                            continue;
                        }
                        if (pageType === 'stance') {
                            // Frieren stance page does not remove stance; stance ignore is applied during the authoritative damage resolution.
                            continue;
                        }
                        if (pageType === 'attack') {
                            // Shield is a stat; syncing it here is safe.
                            const amount = this.calculateShield({ scaling: 'flat', value: 7 }, caster);
                            if (amount > 0) {
                                await this.applyShield(caster, amount, playerId);
                            }
                            continue;
                        }
                        if (pageType === 'buff') {
                            this.removeOneBuff(opponentId);
                            continue;
                        }
                        if (pageType === 'debuff') {
                            await this.cleanse(caster, playerId);
                            continue;
                        }
                        await this.applyHealBlock(opponentId, 2);
                    }
                }
                break;
                
            // Other ultimate effects handled by pre-calculated values
            default:
                break;
        }
    }

    async applyDebuff(target, debuffEffect, playerId) {
        // Conceal blocks debuffs
        if (this.isConcealed(playerId)) {
            return;
        }

        // Immunity blocks debuffs
        if (this.isImmune(playerId)) {
            return;
        }

        // Passive: debuff immunity (Plague Doctor)
        if (target.passive && target.passive.type === 'dual_passive' && target.passive.ongoing_effect && target.passive.ongoing_effect.type === 'debuff_immunity_and_poison_boost') {
            return;
        }

        const debuffId = `debuff_${playerId}_${debuffEffect.stat}_${Date.now()}`;

        const ctx = this.getActiveActionContext();
        const ownerId = ctx && (ctx.attackerId === 'player1' || ctx.attackerId === 'player2')
            ? ctx.attackerId
            : (this.gameState?.currentTurn === 'player1' || this.gameState?.currentTurn === 'player2'
                ? this.gameState.currentTurn
                : null);

        const normalizedStat = this.normalizeStatKey(debuffEffect.stat);
        const debuffMode = debuffEffect.mode;
        const debuffValue = Number(debuffEffect.value) || 0;
        const debuffText = (normalizedStat === 'damageReduction')
            ? `${debuffEffect.stat} reduced by ${Math.round(Math.abs(debuffValue))}% for ${debuffEffect.duration} turns`
            : (normalizedStat === 'lifesteal')
                ? `${debuffEffect.stat} reduced by ${Math.round(Math.abs(debuffValue))}% for ${debuffEffect.duration} turns`
                : (debuffMode === 'flat')
                    ? `${debuffEffect.stat} reduced by ${Math.round(Math.abs(debuffValue))} for ${debuffEffect.duration} turns`
                    : `${debuffEffect.stat} reduced by ${Math.round(Math.abs(debuffValue) * 100)}% for ${debuffEffect.duration} turns`;
        
        this.activeEffects.set(debuffId, {
            type: 'debuff',
            target: playerId,
            ownerId,
            characterId: target.id,
            stat: normalizedStat,
            value: debuffValue,
            mode: debuffEffect.mode,
            duration: debuffEffect.duration,
            turnsLeft: debuffEffect.duration,
            name: `${debuffEffect.stat.charAt(0).toUpperCase() + debuffEffect.stat.slice(1)} Reduction`,
            description: debuffText
        });

        this.recalculateStats(playerId);
    }

    async applyStun(target, duration, playerId) {
        // Conceal blocks debuffs
        if (this.isConcealed(playerId)) {
            return;
        }

        // Immunity blocks stun
        if (this.isImmune(playerId)) {
            return;
        }

        const stunId = `stun_${playerId}_${Date.now()}`;

        const ctx = this.getActiveActionContext();
        const ownerId = ctx && (ctx.attackerId === 'player1' || ctx.attackerId === 'player2')
            ? ctx.attackerId
            : (this.gameState?.currentTurn === 'player1' || this.gameState?.currentTurn === 'player2'
                ? this.gameState.currentTurn
                : null);
        
        this.activeEffects.set(stunId, {
            type: 'stun',
            target: playerId,
            ownerId,
            characterId: target.id,
            duration: duration,
            turnsLeft: duration,
            _skipNextDecrement: true,
            name: 'Stunned',
            description: `Cannot act for ${duration} turns`
        });
    }

    async applyMark(target, markEffect, playerId) {
        // Conceal blocks debuffs
        if (this.isConcealed(playerId)) {
            return;
        }

        // Immunity blocks mark
        if (this.isImmune(playerId)) {
            return;
        }

        const markId = `mark_${playerId}_${Date.now()}`;

        const ctx = this.getActiveActionContext();
        const ownerId = ctx && (ctx.attackerId === 'player1' || ctx.attackerId === 'player2')
            ? ctx.attackerId
            : (this.gameState?.currentTurn === 'player1' || this.gameState?.currentTurn === 'player2'
                ? this.gameState.currentTurn
                : null);
        
        this.activeEffects.set(markId, {
            type: 'mark',
            target: playerId,
            ownerId,
            characterId: target.id,
            damage_bonus: markEffect.damage_bonus,
            duration: markEffect.duration,
            turnsLeft: markEffect.duration,
            name: "Hunter's Mark",
            description: `Takes ${Math.round(markEffect.damage_bonus * 100)}% more damage for ${markEffect.duration} turns`
        });
    }

    async cleanse(target, playerId) {
        const effectsToRemove = [];
        
        for (const [effectId, effect] of this.activeEffects.entries()) {
            if (!effect || effect.target !== playerId) continue;
            // Remove only colored/removable negative effects.
            // Grey effects are considered unremovable.
            if (
                effect.type === 'debuff' ||
                effect.type === 'poison' ||
                effect.type === 'curse' ||
                effect.type === 'stun' ||
                effect.type === 'bleed' ||
                effect.type === 'mark'
            ) {
                effectsToRemove.push(effectId);
            }
        }
        
        effectsToRemove.forEach(id => this.activeEffects.delete(id));
        if (effectsToRemove.length > 0) {
            this.recalculateStats(playerId);
        }
        console.log(`Cleansed ${effectsToRemove.length} negative effects from ${target.name}`);
    }

    removeOneBuff(playerId) {
        let removed = false;

        for (const [effectId, effect] of this.activeEffects.entries()) {
            if (!effect || effect.target !== playerId) continue;
            if (effect.type !== 'buff') continue;

            this.activeEffects.delete(effectId);
            removed = true;
            break;
        }

        if (removed) {
            this.recalculateStats(playerId);
        }

        return removed;
    }

    isStunned(playerId) {
        for (const [effectId, effect] of this.activeEffects) {
            if (effect.target === playerId && effect.type === 'stun') {
                return true;
            }
        }
        return false;
    }

    getMarkBonus(playerId) {
        for (const [effectId, effect] of this.activeEffects) {
            if (effect.target === playerId && effect.type === 'mark') {
                return effect.damage_bonus;
            }
        }
        return 0;
    }

    getDamageTakenMultiplier(playerId) {
        let amp = 0;
        for (const [, effect] of this.activeEffects.entries()) {
            if (effect.target === playerId && effect.type === 'bleed') {
                amp = Math.max(amp, Number(effect.damageAmp) || 0);
            }
        }
        return amp;
    }

    serializeActiveEffects() {
        const out = [];
        for (const [id, eff] of this.activeEffects.entries()) {
            if (!id || !eff) continue;
            out.push({ id, effect: eff });
        }
        return out;
    }

    loadActiveEffects(serialized) {
        this.activeEffects = new Map();
        if (!Array.isArray(serialized)) return;
        for (const item of serialized) {
            const id = item && typeof item.id === 'string' ? item.id : null;
            const eff = item ? item.effect : null;
            if (!id || !eff) continue;
            this.activeEffects.set(id, eff);
        }
    }

    serializeSkillCooldowns() {
        const out = [];
        for (const [k, v] of this.skillCooldowns.entries()) {
            out.push([k, v]);
        }
        return out;
    }

    loadSkillCooldowns(serialized) {
        this.skillCooldowns = new Map();
        if (!Array.isArray(serialized)) return;
        for (const item of serialized) {
            if (!Array.isArray(item) || item.length !== 2) continue;
            this.skillCooldowns.set(item[0], item[1]);
        }
    }

    getCounterValue(playerId, key) {
        const player = this.gameState?.players?.get(playerId);
        const state = player?.character?.passiveState;
        return Number(state?.counters?.[key]) || 0;
    }

    setCounterValue(playerId, key, value) {
        const player = this.gameState?.players?.get(playerId);
        if (!player || !player.character) return;
        if (!player.character.passiveState) {
            player.character.passiveState = { counters: {}, totalHealingDone: 0, ultimateReady: false };
        }
        if (!player.character.passiveState.counters) player.character.passiveState.counters = {};
        player.character.passiveState.counters[key] = value;

        if (this.passiveSystem && typeof this.passiveSystem.updateUltimateReady === 'function') {
            this.passiveSystem.updateUltimateReady(playerId);
        }
    }

    addCounterValue(playerId, key, delta, min = 0, max = null) {
        const cur = this.getCounterValue(playerId, key);
        let next = cur + delta;
        if (typeof min === 'number') next = Math.max(min, next);
        if (typeof max === 'number') next = Math.min(max, next);
        this.setCounterValue(playerId, key, next);
        return next;
    }

    async handleCharacterDeath(character, playerId) {
        console.log(`💀 CHARACTER DEATH: ${character.name} has died, checking for revive...`);
        
        // Check if character has revive passive
        if (character.passive && character.passive.ongoing_effect && character.passive.ongoing_effect.type === 'revive') {
            const reviveEffect = character.passive.ongoing_effect;
            
            // Initialize revive counter if not exists
            if (!character.reviveCount) {
                character.reviveCount = 0;
            }
            
            // Check if revives are available
            if (character.reviveCount < reviveEffect.max_revives) {
                character.reviveCount++;
                const reviveHealth = Math.ceil(character.stats.maxHealth * reviveEffect.revive_health);
                character.stats.health = reviveHealth;
                
                console.log(`✨ REVIVE: ${character.name} revived with ${reviveHealth} health! (${character.reviveCount}/${reviveEffect.max_revives} revives used)`);
                
                // Add visual effect
                this.activeEffects.set(`revive_${playerId}_${Date.now()}`, {
                    type: 'revive',
                    target: playerId,
                    characterId: character.id,
                    turnsLeft: 1,
                    name: 'Revived',
                    description: `Revived with ${Math.round(reviveEffect.revive_health * 100)}% health`
                });
                
                return true; // Character was revived
            }
        }
        
        console.log(`💀 FINAL DEATH: ${character.name} has no more revives available`);
        return false; // Character stays dead
    }
}
