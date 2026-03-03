(function () {
    const BattleAnimations = {
        getCloseAttackTeleportMultiplierForCharacter(character) {
            if (window.BattleAssets && typeof window.BattleAssets.getCloseAttackTeleportMultiplierForCharacter === 'function') {
                return window.BattleAssets.getCloseAttackTeleportMultiplierForCharacter(character);
            }
            return 1.8;
        },

        getCloseAttackHitStartDelayMsForCharacter(character, skillId) {
            if (window.BattleAssets && typeof window.BattleAssets.getCloseAttackHitStartDelayMsForCharacterSkill === 'function') {
                return window.BattleAssets.getCloseAttackHitStartDelayMsForCharacterSkill(character, skillId);
            }
            if (window.BattleAssets && typeof window.BattleAssets.getCloseAttackHitStartDelayMsForCharacter === 'function') {
                return window.BattleAssets.getCloseAttackHitStartDelayMsForCharacter(character);
            }
            return 0;
        },

        withCloseAttackCombatTextOffset(actionResult, actorCharacterId, skillType, skillId) {
            if (!actionResult) return actionResult;
            if (skillType !== 'attack') return actionResult;

            const actorChar = actorCharacterId ? { id: actorCharacterId } : null;
            const hasClose = window.BattleAssets && typeof window.BattleAssets.getCloseAttackAnimationForCharacterSkill === 'function'
                ? Boolean(window.BattleAssets.getCloseAttackAnimationForCharacterSkill(actorChar, skillId))
                : (window.BattleAssets && typeof window.BattleAssets.getCloseAttackAnimationForCharacter === 'function'
                    ? Boolean(window.BattleAssets.getCloseAttackAnimationForCharacter(actorChar))
                    : false);

            if (!hasClose) return actionResult;

            const offsetMs = Math.max(0, Math.floor(Number(this.getCloseAttackHitStartDelayMsForCharacter(actorChar, skillId)) || 0));
            if (offsetMs <= 0) return actionResult;

            const animations = Array.isArray(actionResult.animations) ? actionResult.animations : null;
            if (!animations || !animations.length) return actionResult;

            const shifted = animations.map(a => {
                if (!a || a.type !== 'combat_text') return a;
                return {
                    ...a,
                    delayMs: Math.max(0, Math.floor(Number(a.delayMs) || 0)) + offsetMs
                };
            });

            return {
                ...actionResult,
                animations: shifted
            };
        },

        withRangedAttackCombatTextDelay(actionResult, actorCharacterId, skillId) {
            if (!actionResult) return actionResult;
            if (!actorCharacterId || !skillId) return actionResult;

            const actorChar = actorCharacterId ? { id: actorCharacterId } : null;
            const ranged = (window.BattleAssets && typeof window.BattleAssets.getRangedAttackAnimationForCharacterSkill === 'function')
                ? window.BattleAssets.getRangedAttackAnimationForCharacterSkill(actorChar, skillId)
                : null;
            if (!ranged || !Array.isArray(ranged.attackerFrames) || ranged.attackerFrames.length < 3) return actionResult;

            const frameMs = 120;
            const startDamageMs = (3 - 1) * frameMs;

            const animations = Array.isArray(actionResult.animations) ? actionResult.animations : null;
            if (!animations || !animations.length) return actionResult;

            const shifted = animations.map(a => {
                if (!a || a.type !== 'combat_text') return a;
                const d = Math.max(0, Math.floor(Number(a.delayMs) || 0));
                return {
                    ...a,
                    delayMs: Math.max(d, startDamageMs)
                };
            });

            return {
                ...actionResult,
                animations: shifted
            };
        },

        async playCloseAttackAnimationForSide(battlePage, actionResult, side, actorCharacterId, skillId) {
            const wrapper = battlePage.getSpriteWrapperForSide(side);
            if (!wrapper) return;

            const spriteEl = typeof battlePage.getSpriteElementForSide === 'function'
                ? battlePage.getSpriteElementForSide(side)
                : null;

            const actorChar = actorCharacterId ? { id: actorCharacterId } : null;
            const anim = (window.BattleAssets && typeof window.BattleAssets.getCloseAttackAnimationForCharacterSkill === 'function')
                ? window.BattleAssets.getCloseAttackAnimationForCharacterSkill(actorChar, skillId)
                : ((window.BattleAssets && typeof window.BattleAssets.getCloseAttackAnimationForCharacter === 'function')
                    ? window.BattleAssets.getCloseAttackAnimationForCharacter(actorChar)
                    : null);
            if (!anim || !anim.start || !Array.isArray(anim.hits) || anim.hits.length === 0 || !anim.end) return;

            // Special-case: Ch'en Dragon Strike close combo.
            // Timeline:
            // - start at origin (start frame)
            // - attack_1 at origin
            // - teleport in front (still attack_1)
            // - teleport closer with attack_2
            // - teleport back and show end frame
            if (actorChar && actorChar.id === 'chen' && skillId === 'chen_dragon_strike') {
                const originalTransform = wrapper.style.transform;
                const originalTransition = wrapper.style.transition;

                const enemySide = side === 'player' ? 'opponent' : 'player';
                const enemyWrapper = typeof battlePage.getSpriteWrapperForSide === 'function'
                    ? battlePage.getSpriteWrapperForSide(enemySide)
                    : null;

                const offsetRatio = Number(this.getCloseAttackTeleportMultiplierForCharacter(actorChar)) || 0;

                const computeTeleportDxPx = () => {
                    try {
                        if (!wrapper || !enemyWrapper) return null;
                        const attackerRect = wrapper.getBoundingClientRect();
                        const enemyRect = enemyWrapper.getBoundingClientRect();
                        if (!attackerRect || !enemyRect) return null;
                        if (!(enemyRect.width > 0) || !(attackerRect.width > 0)) return null;

                        const attackerCenterX = attackerRect.left + (attackerRect.width / 2);
                        const enemyCenterX = enemyRect.left + (enemyRect.width / 2);

                        const approachDir = Math.sign(enemyCenterX - attackerCenterX) || 1;
                        const desiredCenterX = enemyCenterX - (approachDir * offsetRatio * enemyRect.width);
                        return Math.round(desiredCenterX - attackerCenterX);
                    } catch (e) {
                        return null;
                    }
                };

                const baseTeleportPx = 160;
                const fallbackApproachDir = side === 'player' ? 1 : -1;
                const fallbackDxPx = Math.round(baseTeleportPx * offsetRatio) * fallbackApproachDir;
                const dxPx = computeTeleportDxPx();

                const inFrontDx = (typeof dxPx === 'number') ? dxPx : fallbackDxPx;
                const closerDx = Math.round(inFrontDx * 1.22);

                const inFrontTransform = `translateX(${inFrontDx}px)`;
                const closerTransform = `translateX(${closerDx}px)`;

                const setTeleportTransform = (transformStr) => {
                    if (!wrapper) return;
                    wrapper.style.transition = 'none';
                    wrapper.style.transform = transformStr
                        ? (originalTransform ? `${originalTransform} ${transformStr}` : transformStr)
                        : (originalTransform || '');
                    void wrapper.offsetWidth;
                };

                const sleepUntil = async (targetMs) => {
                    const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
                        ? performance.now()
                        : Date.now();
                    const delta = Math.max(0, Math.floor(targetMs - now));
                    if (delta > 0) await battlePage.sleep(delta);
                };

                const startTs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
                    ? performance.now()
                    : Date.now();

                const hitTimings = Array.isArray(actionResult?.animations)
                    ? actionResult.animations
                        .filter(a => a && a.type === 'combat_text')
                        .map(a => Math.max(0, Math.floor(Number(a.delayMs) || 0)))
                        .sort((a, b) => a - b)
                    : [];
                const firstHitMs = hitTimings.length ? hitTimings[0] : 0;

                const startHoldMs = 90;
                const attack1HoldMs = 130;
                const inFrontHoldMs = 120;
                const attack2HoldMs = 160;
                const endHoldBeforeReturnMs = 160;
                const settleAfterReturnMs = 140;

                const totalDurationMs = Math.max(
                    1000,
                    firstHitMs + startHoldMs + attack1HoldMs + inFrontHoldMs + attack2HoldMs + endHoldBeforeReturnMs + settleAfterReturnMs
                );

                battlePage.playSpriteOverride(side, [anim.start], totalDurationMs, `chen_close_start_${actorCharacterId || 'unknown'}`);
                if (spriteEl) spriteEl.src = anim.start;

                // Attack 1 at origin.
                await sleepUntil(startTs + startHoldMs);
                battlePage.playSpriteOverride(side, [anim.hits[0]], Math.max(200, totalDurationMs - startHoldMs), `chen_close_a1_${actorCharacterId || 'unknown'}`);
                if (spriteEl) spriteEl.src = anim.hits[0];

                // Teleport in front while keeping attack 1.
                await sleepUntil(startTs + startHoldMs + attack1HoldMs);
                setTeleportTransform(inFrontTransform);

                // Teleport closer + switch to attack 2 near first hit timing.
                await sleepUntil(startTs + Math.max(firstHitMs, startHoldMs + attack1HoldMs + inFrontHoldMs));
                setTeleportTransform(closerTransform);
                battlePage.playSpriteOverride(side, [anim.hits[1] || anim.hits[0]], Math.max(220, totalDurationMs - Math.max(firstHitMs, startHoldMs + attack1HoldMs + inFrontHoldMs)), `chen_close_a2_${actorCharacterId || 'unknown'}`);
                if (spriteEl) spriteEl.src = anim.hits[1] || anim.hits[0];

                // End frame, then return.
                await sleepUntil(startTs + Math.max(firstHitMs, startHoldMs + attack1HoldMs + inFrontHoldMs) + attack2HoldMs);
                battlePage.playSpriteOverride(side, [anim.end], Math.max(220, totalDurationMs - (Math.max(firstHitMs, startHoldMs + attack1HoldMs + inFrontHoldMs) + attack2HoldMs)), `chen_close_end_${actorCharacterId || 'unknown'}`);
                if (spriteEl) spriteEl.src = anim.end;

                await sleepUntil(startTs + Math.max(firstHitMs, startHoldMs + attack1HoldMs + inFrontHoldMs) + attack2HoldMs + endHoldBeforeReturnMs);
                setTeleportTransform('');

                await sleepUntil(startTs + totalDurationMs);
                const prev = battlePage.spriteAnimation && battlePage.spriteAnimation.override
                    ? battlePage.spriteAnimation.override[side]
                    : null;
                if (prev && prev.timeoutId) {
                    try {
                        clearTimeout(prev.timeoutId);
                    } catch (e) {}
                }
                if (battlePage.spriteAnimation && battlePage.spriteAnimation.override) {
                    battlePage.spriteAnimation.override[side] = null;
                }
                wrapper.style.transition = originalTransition;
                wrapper.style.transform = originalTransform;
                return;
            }

            const hits = Array.isArray(actionResult?.animations)
                ? actionResult.animations
                    .filter(a => a && a.type === 'combat_text')
                    .map(a => Math.max(0, Math.floor(Number(a.delayMs) || 0)))
                    .sort((a, b) => a - b)
                : [];

            const hitTimings = hits.length ? hits : [0];
            const lastHitMs = hitTimings[hitTimings.length - 1];

            const originalTransform = wrapper.style.transform;
            const originalTransition = wrapper.style.transition;

            const enemySide = side === 'player' ? 'opponent' : 'player';
            const enemyWrapper = typeof battlePage.getSpriteWrapperForSide === 'function'
                ? battlePage.getSpriteWrapperForSide(enemySide)
                : null;

            const offsetRatio = Number(this.getCloseAttackTeleportMultiplierForCharacter(actorChar)) || 0;

            const computeTeleportDxPx = () => {
                try {
                    if (!wrapper || !enemyWrapper) return null;
                    const attackerRect = wrapper.getBoundingClientRect();
                    const enemyRect = enemyWrapper.getBoundingClientRect();
                    if (!attackerRect || !enemyRect) return null;
                    if (!(enemyRect.width > 0) || !(attackerRect.width > 0)) return null;

                    const attackerCenterX = attackerRect.left + (attackerRect.width / 2);
                    const enemyCenterX = enemyRect.left + (enemyRect.width / 2);

                    // Positive offsetRatio means "land on the near side" of the enemy center (from the attacker's approach direction).
                    // Negative offsetRatio means "cross past center" to the far side.
                    const approachDir = Math.sign(enemyCenterX - attackerCenterX) || 1;
                    const desiredCenterX = enemyCenterX - (approachDir * offsetRatio * enemyRect.width);
                    return Math.round(desiredCenterX - attackerCenterX);
                } catch (e) {
                    return null;
                }
            };

            const baseTeleportPx = 160;
            const fallbackApproachDir = side === 'player' ? 1 : -1;
            const fallbackDxPx = Math.round(baseTeleportPx * offsetRatio) * fallbackApproachDir;
            const dxPx = computeTeleportDxPx();
            const inFrontTransform = `translateX(${(typeof dxPx === 'number' ? dxPx : fallbackDxPx)}px)`;

            const setTeleport = (enabled) => {
                if (!wrapper) return;
                wrapper.style.transition = 'none';
                wrapper.style.transform = enabled
                    ? (originalTransform ? `${originalTransform} ${inFrontTransform}` : inFrontTransform)
                    : (originalTransform || '');
                void wrapper.offsetWidth;
            };

            const sleepUntil = async (targetMs) => {
                const now = (typeof performance !== 'undefined' && typeof performance.now === 'function')
                    ? performance.now()
                    : Date.now();
                const delta = Math.max(0, Math.floor(targetMs - now));
                if (delta > 0) await battlePage.sleep(delta);
            };

            const startTs = (typeof performance !== 'undefined' && typeof performance.now === 'function')
                ? performance.now()
                : Date.now();

            const poseHoldMs = 280;
            const endHoldBeforeReturnMs = 160;
            const settleAfterReturnMs = 120;

            const totalDurationMs = Math.max(900, lastHitMs + poseHoldMs + endHoldBeforeReturnMs + settleAfterReturnMs + 220);

            battlePage.playSpriteOverride(side, [anim.start], totalDurationMs, `close_attack_start_${actorCharacterId || 'unknown'}`);
            if (spriteEl) spriteEl.src = anim.start;

            await sleepUntil(startTs + 120);
            setTeleport(true);

            for (let i = 0; i < hitTimings.length; i++) {
                const t = hitTimings[i];
                await sleepUntil(startTs + Math.max(0, t));
                const frame = anim.hits[i % anim.hits.length];
                battlePage.playSpriteOverride(side, [frame], Math.max(120, totalDurationMs - t), `close_attack_hit_${actorCharacterId || 'unknown'}_${i}`);
                if (spriteEl) spriteEl.src = frame;
            }

            await sleepUntil(startTs + lastHitMs + poseHoldMs);
            battlePage.playSpriteOverride(side, [anim.end], Math.max(220, totalDurationMs - (lastHitMs + poseHoldMs)), `close_attack_end_${actorCharacterId || 'unknown'}`);
            if (spriteEl) spriteEl.src = anim.end;

            await sleepUntil(startTs + lastHitMs + poseHoldMs + endHoldBeforeReturnMs);
            setTeleport(false);

            await sleepUntil(startTs + totalDurationMs);
            const prev = battlePage.spriteAnimation && battlePage.spriteAnimation.override
                ? battlePage.spriteAnimation.override[side]
                : null;
            if (prev && prev.timeoutId) {
                try {
                    clearTimeout(prev.timeoutId);
                } catch (e) {}
            }
            if (battlePage.spriteAnimation && battlePage.spriteAnimation.override) {
                battlePage.spriteAnimation.override[side] = null;
            }
            wrapper.style.transition = originalTransition;
            wrapper.style.transform = originalTransform;
        }
        ,

        async playRangedAttackAnimationForSide(battlePage, actionResult, side, actorCharacterId, skillId) {
            if (!battlePage || !actorCharacterId || !skillId) return;

            const actorChar = { id: actorCharacterId };
            const ranged = (window.BattleAssets && typeof window.BattleAssets.getRangedAttackAnimationForCharacterSkill === 'function')
                ? window.BattleAssets.getRangedAttackAnimationForCharacterSkill(actorChar, skillId)
                : null;
            if (!ranged || !Array.isArray(ranged.attackerFrames) || ranged.attackerFrames.length === 0) return;

            const enemySide = side === 'player' ? 'opponent' : 'player';
            const actorSprite = (typeof battlePage.getSpriteElementForSide === 'function')
                ? battlePage.getSpriteElementForSide(side)
                : null;
            const targetOverlay = (typeof battlePage.getSpriteOverlayElementForSide === 'function')
                ? battlePage.getSpriteOverlayElementForSide(enemySide)
                : null;

            if (!actorSprite) return;

            const overlayFrames = Array.isArray(ranged.targetOverlayFrames) ? ranged.targetOverlayFrames : [];
            const overlayCfg = ranged.overlay || {};
            const overlayOpacity = (typeof overlayCfg.opacity === 'number') ? overlayCfg.opacity : 1;
            const bottomOffsetRatio = (typeof overlayCfg.bottomOffsetRatio === 'number') ? overlayCfg.bottomOffsetRatio : 0;

            const sleep = async (ms) => {
                const t = Math.max(0, Math.floor(Number(ms) || 0));
                if (t > 0) await battlePage.sleep(t);
            };

            const frameMs = 120;
            const endHoldMs = 160;
            const totalFrames = Math.max(ranged.attackerFrames.length, overlayFrames.length);
            const totalDurationMs = totalFrames * frameMs + endHoldMs;

            battlePage.playSpriteOverride(side, [ranged.attackerFrames[0]], totalDurationMs, `ranged_${actorCharacterId}_${skillId}`);
            actorSprite.src = ranged.attackerFrames[0];

            if (targetOverlay && overlayFrames.length > 0) {
                targetOverlay.style.display = '';
                targetOverlay.style.opacity = String(Math.max(0, Math.min(1, overlayOpacity)));
                targetOverlay.style.bottom = `${bottomOffsetRatio * 100}%`;
                targetOverlay.src = overlayFrames[0];
            }

            for (let i = 1; i < totalFrames; i++) {
                await sleep(frameMs);

                const attackerFrame = ranged.attackerFrames[i] || ranged.attackerFrames[ranged.attackerFrames.length - 1];
                battlePage.playSpriteOverride(side, [attackerFrame], totalDurationMs - (i * frameMs), `ranged_${actorCharacterId}_${skillId}_${i}`);
                actorSprite.src = attackerFrame;

                if (targetOverlay && overlayFrames.length > 0) {
                    const overlayFrame = overlayFrames[i] || overlayFrames[overlayFrames.length - 1];
                    targetOverlay.src = overlayFrame;
                }
            }

            await sleep(endHoldMs);

            if (targetOverlay) {
                targetOverlay.style.display = 'none';
                targetOverlay.src = '';
            }
        }

        ,

        async playDomainSkillAnimationForSide(battlePage, side, actorCharacterId, skillId) {
            if (!battlePage) return;
            if (!skillId) return;

            const spriteEl = typeof battlePage.getSpriteElementForSide === 'function'
                ? battlePage.getSpriteElementForSide(side)
                : null;
            if (!spriteEl) return;

            const actorChar = actorCharacterId ? { id: actorCharacterId } : null;
            const frames = (window.BattleAssets && typeof window.BattleAssets.getDomainAnimationForCharacterSkill === 'function')
                ? window.BattleAssets.getDomainAnimationForCharacterSkill(actorChar, skillId)
                : null;
            if (!Array.isArray(frames) || frames.length === 0) return;

            const sleep = async (ms) => {
                const t = Math.max(0, Math.floor(Number(ms) || 0));
                if (t > 0) await battlePage.sleep(t);
            };

            const msPerFrame = 180;
            const endHoldMs = 240;
            const totalDurationMs = frames.length * msPerFrame + endHoldMs;

            battlePage.playSpriteOverride(side, [frames[0]], totalDurationMs, `domain_${actorCharacterId || 'unknown'}_${skillId}`);
            spriteEl.src = frames[0];

            for (let i = 1; i < frames.length; i++) {
                await sleep(msPerFrame);
                battlePage.playSpriteOverride(side, [frames[i]], totalDurationMs - (i * msPerFrame), `domain_${actorCharacterId || 'unknown'}_${skillId}_${i}`);
                spriteEl.src = frames[i];
            }

            await sleep(endHoldMs);

            const prev = battlePage.spriteAnimation && battlePage.spriteAnimation.override
                ? battlePage.spriteAnimation.override[side]
                : null;
            if (prev && prev.timeoutId) {
                try {
                    clearTimeout(prev.timeoutId);
                } catch (e) {}
            }
            if (battlePage.spriteAnimation && battlePage.spriteAnimation.override) {
                battlePage.spriteAnimation.override[side] = null;
            }
        }

        ,

        async playSkillSequenceAnimationForSide(battlePage, side, actorCharacterId, skillId, skillType) {
            if (!battlePage) return;
            if (!skillId) return;

            const spriteEl = typeof battlePage.getSpriteElementForSide === 'function'
                ? battlePage.getSpriteElementForSide(side)
                : null;
            if (!spriteEl) return;

            const actorChar = actorCharacterId ? { id: actorCharacterId } : null;
            const frames = (window.BattleAssets && typeof window.BattleAssets.getSkillPreviewAnimationFramesForCharacterSkill === 'function')
                ? window.BattleAssets.getSkillPreviewAnimationFramesForCharacterSkill(actorChar, skillId, skillType)
                : null;
            if (!Array.isArray(frames) || frames.length === 0) return;

            const sleep = async (ms) => {
                const t = Math.max(0, Math.floor(Number(ms) || 0));
                if (t > 0) await battlePage.sleep(t);
            };

            const msPerFrame = 170;
            const endHoldMs = 200;
            const totalDurationMs = frames.length * msPerFrame + endHoldMs;

            battlePage.playSpriteOverride(side, [frames[0]], totalDurationMs, `skill_seq_${actorCharacterId || 'unknown'}_${skillId}`);
            spriteEl.src = frames[0];

            for (let i = 1; i < frames.length; i++) {
                await sleep(msPerFrame);
                battlePage.playSpriteOverride(side, [frames[i]], totalDurationMs - (i * msPerFrame), `skill_seq_${actorCharacterId || 'unknown'}_${skillId}_${i}`);
                spriteEl.src = frames[i];
            }

            await sleep(endHoldMs);

            const prev = battlePage.spriteAnimation && battlePage.spriteAnimation.override
                ? battlePage.spriteAnimation.override[side]
                : null;
            if (prev && prev.timeoutId) {
                try {
                    clearTimeout(prev.timeoutId);
                } catch (e) {}
            }
            if (battlePage.spriteAnimation && battlePage.spriteAnimation.override) {
                battlePage.spriteAnimation.override[side] = null;
            }
        }
    };

    window.BattleAnimations = BattleAnimations;
})();
