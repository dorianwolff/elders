(function () {
    if (!window.BattleHooks || typeof window.BattleHooks.register !== 'function') return;

    function isNaofumi(ctx) {
        const c = ctx && ctx.character;
        return Boolean(c && c.id === 'naofumi_iwatani');
    }

    function upsertNaofumiStageIndicator(skillSystem, playerId, shieldKey) {
        if (!skillSystem || !skillSystem.activeEffects || typeof skillSystem.activeEffects.entries !== 'function') return;
        const effects = skillSystem.activeEffects;

        const toRemove = [];
        for (const [id, eff] of effects.entries()) {
            if (!eff) continue;
            if (eff.target !== playerId) continue;
            if (!eff._naofumiPassiveIndicator) continue;
            toRemove.push(id);
        }
        for (const id of toRemove) effects.delete(id);

        const labelMap = {
            legendary: 'Legendary Shield',
            leaf: 'Leaf Shield',
            chimera: 'Chimera Shield',
            prison: 'Prison Shield',
            slime: 'Slime Shield',
            soul_eater: 'Soul Eater Shield',
            transformation: 'Wrath Shield'
        };

        const name = labelMap[shieldKey] || 'Shield';
        const desc = shieldKey ? `Current shield: ${shieldKey}` : 'Current shield';

        effects.set(`naofumi_stage_${playerId}_${Date.now()}`, {
            type: 'stack-counter',
            target: playerId,
            characterId: 'naofumi_iwatani',
            ownerId: playerId,
            duration: 1,
            turnsLeft: 1,
            name,
            description: desc,
            _naofumiPassiveIndicator: true
        });
    }

    function resetCooldownsForSkills(skillSystem, playerId, skillIds) {
        try {
            if (!skillSystem || typeof skillSystem.setSkillCooldown !== 'function') return;
            if (playerId !== 'player1' && playerId !== 'player2') return;
            const ids = Array.isArray(skillIds) ? skillIds : [];
            for (const sid of ids) {
                if (typeof sid !== 'string' || !sid) continue;
                skillSystem.setSkillCooldown(sid, playerId, 0);

                // If the skill was used last action, SkillSystem may have a one-turn skip flag.
                // Clear it so swaps never carry cooldown timing artifacts.
                try {
                    const key = (typeof skillSystem.getSkillCooldownKey === 'function')
                        ? skillSystem.getSkillCooldownKey(sid, playerId)
                        : `${playerId}:${sid}`;
                    if (skillSystem._cooldownsSkipNextDecrement && typeof skillSystem._cooldownsSkipNextDecrement.delete === 'function') {
                        skillSystem._cooldownsSkipNextDecrement.delete(key);
                    }
                } catch (e) {}
            }
        } catch (e) {}
    }

    window.BattleHooks.register('passive_system:event', async (ctx) => {
        try {
            if (!isNaofumi(ctx)) return;

            const passiveSystem = ctx && ctx.passiveSystem;
            const skillSystem = ctx && ctx.skillSystem;
            const gameState = ctx && ctx.gameState;
            const playerId = ctx && ctx.playerId;
            const player = ctx && ctx.player;
            const character = ctx && ctx.character;
            const eventType = ctx && ctx.eventType;
            const payload = ctx && ctx.payload;

            if (!passiveSystem || typeof passiveSystem.ensureState !== 'function') return;

            if (eventType === 'turn_start') {
                const state = passiveSystem.ensureState(character);
                const turnCount = Number(gameState?.turnCount);
                if (!Number.isFinite(turnCount)) return;

                if (gameState?.currentTurn !== playerId) {
                    return;
                }

                if (state.naofumiShieldLastTurnCount === turnCount) {
                    return;
                }
                state.naofumiShieldLastTurnCount = turnCount;

                if (!Array.isArray(state.naofumiShieldBag) || state.naofumiShieldBag.length === 0) {
                    state.naofumiShieldBag = ['leaf', 'chimera', 'prison', 'slime', 'soul_eater'];
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
                    const seed = `${gameState?.gameId || 'game'}:${turnCount}:${playerId}:naofumi:shield`;
                    const rand = skillSystem && typeof skillSystem.deterministicRandom === 'function'
                        ? skillSystem.deterministicRandom(seed)
                        : Math.random();
                    const idx = Math.min(state.naofumiShieldBag.length - 1, Math.max(0, Math.floor(rand * state.naofumiShieldBag.length)));
                    const picked = state.naofumiShieldBag.splice(idx, 1)[0];
                    state.naofumiCurrentShieldKey = picked;
                }

                state.naofumiSlimeTurnCount = null;
                state.naofumiSoulEaterTurnCount = null;

                const opponentId = playerId === 'player1' ? 'player2' : 'player1';
                const opponentChar = gameState?.players?.get(opponentId)?.character;

                if (state.naofumiCurrentShieldKey === 'legendary' && !state.naofumiLegendaryBuffApplied) {
                    state.naofumiLegendaryBuffApplied = true;
                    if (skillSystem && typeof skillSystem.applyBuff === 'function') {
                        await skillSystem.applyBuff(character, { stat: 'defense', mode: 'flat', value: 7, duration: 999 }, playerId);
                        try {
                            const effects = skillSystem.activeEffects;
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
                    if (skillSystem && typeof skillSystem.applyHealing === 'function') {
                        await skillSystem.applyHealing(character, 10, playerId);
                    }
                    if (skillSystem && typeof skillSystem.cleanse === 'function') {
                        await skillSystem.cleanse(character, playerId);
                    }
                }

                if (state.naofumiCurrentShieldKey === 'prison') {
                    if (opponentId && opponentChar) {
                        const immune = skillSystem && typeof skillSystem.isImmune === 'function'
                            ? skillSystem.isImmune(opponentId)
                            : false;
                        const concealed = skillSystem && typeof skillSystem.isConcealed === 'function'
                            ? skillSystem.isConcealed(opponentId)
                            : false;
                        if (!immune && !concealed && skillSystem && skillSystem.activeEffects && typeof skillSystem.activeEffects.set === 'function') {
                            const stunId = `stun_${opponentId}_${Date.now()}`;
                            skillSystem.activeEffects.set(stunId, {
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
                        if (skillSystem && typeof skillSystem.applyTrueDamageNoDomain === 'function') {
                            await skillSystem.applyTrueDamageNoDomain(opponentChar, 10, opponentId, playerId);
                        }
                    }
                }

                if (state.naofumiCurrentShieldKey === 'slime') {
                    state.naofumiSlimeTurnCount = turnCount;
                }

                if (state.naofumiCurrentShieldKey === 'soul_eater') {
                    state.naofumiSoulEaterTurnCount = turnCount;
                    const cs = gameState?.characterSystem || skillSystem?.characterSystem;
                    if (cs && typeof cs.getSkill === 'function') {
                        try {
                            const s1 = await cs.getSkill('naofumi_undead_control');
                            const s2 = await cs.getSkill('naofumi_soul_eat');
                            if (s1 && s2) {
                                character.skills = [s2, s1];
                                resetCooldownsForSkills(skillSystem, playerId, ['naofumi_soul_eat', 'naofumi_undead_control']);
                            }
                        } catch (e) {}
                    }
                }

                if (state.naofumiCurrentShieldKey === 'transformation') {
                    state.naofumiTransformActive = true;
                    state.naofumiTransformTurnCount = turnCount;
                    if (player) {
                        player.ultimateReady = true;
                    }
                    state.ultimateReady = true;
                }

                if (state.naofumiCurrentShieldKey !== 'soul_eater' && Array.isArray(state.naofumiBaseSkillIds)) {
                    const cs = gameState?.characterSystem || skillSystem?.characterSystem;
                    if (cs && typeof cs.getSkill === 'function') {
                        try {
                            const s1 = await cs.getSkill(state.naofumiBaseSkillIds[0]);
                            const s2 = await cs.getSkill(state.naofumiBaseSkillIds[1]);
                            if (s1 && s2) {
                                character.skills = [s1, s2];
                                resetCooldownsForSkills(skillSystem, playerId, [state.naofumiBaseSkillIds[0], state.naofumiBaseSkillIds[1]]);
                            }
                        } catch (e) {}
                    }
                }

                upsertNaofumiStageIndicator(skillSystem, playerId, state.naofumiCurrentShieldKey);
            }

            if (eventType === 'turn_end') {
                const state = passiveSystem.ensureState(character);
                const turnCount = Number(gameState?.turnCount);

                if (state.naofumiCurrentShieldKey === 'transformation') {
                    state.naofumiTransformTrueDamage = Math.max(0, Math.floor(Number(state.naofumiTransformTrueDamage) || 0)) + 1;
                    if (skillSystem && typeof skillSystem.applyTrueDamageNoDomain === 'function') {
                        await skillSystem.applyTrueDamageNoDomain(character, state.naofumiTransformTrueDamage, playerId, null);
                    }
                }

                if (Number.isFinite(turnCount) && Number(state.naofumiSoulEaterTurnCount) === turnCount) {
                    const cs = gameState?.characterSystem || skillSystem?.characterSystem;
                    if (cs && typeof cs.getSkill === 'function') {
                        try {
                            const baseIds = Array.isArray(state.naofumiBaseSkillIds) ? state.naofumiBaseSkillIds : null;
                            const b1 = baseIds && typeof baseIds[0] === 'string' ? baseIds[0] : 'naofumi_shield_bash';
                            const b2 = baseIds && typeof baseIds[1] === 'string' ? baseIds[1] : 'naofumi_defensive_stance';
                            const s1 = await cs.getSkill(b1);
                            const s2 = await cs.getSkill(b2);
                            if (s1 && s2) {
                                character.skills = [s1, s2];
                                resetCooldownsForSkills(skillSystem, playerId, [b1, b2]);
                            }
                        } catch (e) {}
                    }
                }
            }

            if (eventType === 'skill_used') {
                const state = passiveSystem.ensureState(character);
                const turnCount = Number(gameState?.turnCount);
                if (Number.isFinite(turnCount) && Number(state.naofumiSoulEaterTurnCount) === turnCount) {
                    const maxHp = Number(character?.stats?.maxHealth) || 0;
                    const heal = Math.max(1, Math.floor(maxHp * 0.03));
                    if (heal > 0 && skillSystem && typeof skillSystem.applyHealing === 'function') {
                        await skillSystem.applyHealing(character, heal, playerId);
                    }
                }
            }

            if (eventType === 'damage_taken_enemy_skill') {
                const state = passiveSystem.ensureState(character);
                const attackerId = payload && payload.attackerId ? String(payload.attackerId) : null;
                const enemy = attackerId ? gameState?.players?.get(attackerId)?.character : null;
                if (state.naofumiCurrentShieldKey === 'chimera' && enemy && skillSystem && typeof skillSystem.applyTrueDamageNoDomain === 'function') {
                    const dmg = Math.max(0, Math.floor(Number(enemy?.stats?.attack) || 0));
                    if (dmg > 0) {
                        await skillSystem.applyTrueDamageNoDomain(enemy, dmg, attackerId, playerId);
                    }
                }
            }
        } catch (e) {
        }
    }, { id: 'character:naofumi_iwatani', order: 0 });
})();
