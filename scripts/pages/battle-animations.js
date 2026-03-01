(function () {
    const BattleAnimations = {
        getCloseAttackTeleportMultiplierForCharacter(character) {
            if (window.BattleAssets && typeof window.BattleAssets.getCloseAttackTeleportMultiplierForCharacter === 'function') {
                return window.BattleAssets.getCloseAttackTeleportMultiplierForCharacter(character);
            }
            return 1.8;
        },

        getCloseAttackHitStartDelayMsForCharacter(character) {
            if (window.BattleAssets && typeof window.BattleAssets.getCloseAttackHitStartDelayMsForCharacter === 'function') {
                return window.BattleAssets.getCloseAttackHitStartDelayMsForCharacter(character);
            }
            return 0;
        },

        withCloseAttackCombatTextOffset(actionResult, actorCharacterId, skillType) {
            if (!actionResult) return actionResult;
            if (skillType !== 'attack') return actionResult;

            const actorChar = actorCharacterId ? { id: actorCharacterId } : null;
            const hasClose = window.BattleAssets && typeof window.BattleAssets.getCloseAttackAnimationForCharacter === 'function'
                ? Boolean(window.BattleAssets.getCloseAttackAnimationForCharacter(actorChar))
                : false;

            if (!hasClose) return actionResult;

            const offsetMs = Math.max(0, Math.floor(Number(this.getCloseAttackHitStartDelayMsForCharacter(actorChar)) || 0));
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

        async playCloseAttackAnimationForSide(battlePage, actionResult, side, actorCharacterId) {
            const wrapper = battlePage.getSpriteWrapperForSide(side);
            if (!wrapper) return;

            const spriteEl = typeof battlePage.getSpriteElementForSide === 'function'
                ? battlePage.getSpriteElementForSide(side)
                : null;

            const actorChar = actorCharacterId ? { id: actorCharacterId } : null;
            const anim = (window.BattleAssets && typeof window.BattleAssets.getCloseAttackAnimationForCharacter === 'function')
                ? window.BattleAssets.getCloseAttackAnimationForCharacter(actorChar)
                : null;
            if (!anim || !anim.start || !Array.isArray(anim.hits) || anim.hits.length === 0 || !anim.end) return;

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

            const baseTeleportPx = 160;
            const teleportMultiplier = Math.max(0, Number(this.getCloseAttackTeleportMultiplierForCharacter(actorChar)) || 0);
            const teleportPx = Math.round(baseTeleportPx * teleportMultiplier);
            const dir = side === 'player' ? -1 : 1;
            const inFrontTransform = `translateX(${teleportPx * dir}px)`;

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
