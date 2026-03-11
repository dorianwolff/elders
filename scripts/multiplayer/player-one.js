class PlayerOne {
    constructor(gameCoordinator) {
        this.gameCoordinator = gameCoordinator;
        this.isActive = false;
        this.character = null;
        this.gameState = null;
    }

    async initialize(character, gameState) {
        this.character = character;
        this.gameState = gameState;
        this.isActive = true;
        
        console.log('Player One initialized with character:', character.name);
    }

    async useSkill(skillIndex) {
        if (!this.isActive || !this.gameState) {
            throw new Error('Player One not active');
        }

        try {
            const liveCharacter = this.gameState.players.get('player1')?.character;
            const liveSkill = liveCharacter && Array.isArray(liveCharacter.skills) ? liveCharacter.skills[skillIndex] : null;

            // Execute skill locally (IMMEDIATE LOGIC)
            const result = await this.gameState.useSkill('player1', skillIndex);

            const effectiveType = result && result._effectiveActionType ? result._effectiveActionType : 'skill';
            const effectiveSkillIndex = (effectiveType === 'skill')
                ? (Number.isFinite(Number(result?._effectiveSkillIndex)) ? Number(result._effectiveSkillIndex) : skillIndex)
                : undefined;
            const effectiveCharacter = this.gameState.players.get('player1')?.character;
            const effectiveSkill = (effectiveType === 'skill' && effectiveCharacter && Array.isArray(effectiveCharacter.skills))
                ? effectiveCharacter.skills[effectiveSkillIndex]
                : null;

            // Notify game coordinator (IMMEDIATE SYNC)
            await this.gameCoordinator.handlePlayerAction('player1', effectiveType === 'ultimate' ? 'ultimate' : 'skill', {
                skillIndex: effectiveType === 'skill' ? effectiveSkillIndex : undefined,
                skillId: effectiveType === 'skill' ? effectiveSkill?.id : undefined,
                skillType: effectiveType === 'skill' ? effectiveSkill?.type : undefined,
                skillName: effectiveType === 'skill' ? (effectiveSkill?.name || 'Skill') : undefined,
                ultimateName: effectiveType === 'ultimate' ? (effectiveCharacter?.ultimate?.name || 'Ultimate') : undefined,
                actorCharacterId: effectiveCharacter?.id || liveCharacter?.id,
                result
            });

            return result;
        } catch (error) {
            console.error('Player One skill execution failed:', error);
            throw error;
        }
    }

    async useUltimate() {
        if (!this.isActive || !this.gameState) {
            throw new Error('Player One not active');
        }

        try {
            const actorCharacterId = this.gameState.players.get('player1')?.character?.id;
            const liveCharacter = this.gameState.players.get('player1')?.character;

            // Execute ultimate locally (IMMEDIATE LOGIC)
            const result = await this.gameState.useUltimate('player1');

            const effectiveType = result && result._effectiveActionType ? result._effectiveActionType : 'ultimate';
            const effectiveSkillIndex = (effectiveType === 'skill')
                ? (Number.isFinite(Number(result?._effectiveSkillIndex)) ? Number(result._effectiveSkillIndex) : 0)
                : undefined;
            const effectiveCharacter = this.gameState.players.get('player1')?.character;
            const effectiveSkill = (effectiveType === 'skill' && effectiveCharacter && Array.isArray(effectiveCharacter.skills))
                ? effectiveCharacter.skills[effectiveSkillIndex]
                : null;
            
            // Notify game coordinator (IMMEDIATE SYNC)
            await this.gameCoordinator.handlePlayerAction('player1', effectiveType === 'skill' ? 'skill' : 'ultimate', {
                skillIndex: effectiveType === 'skill' ? effectiveSkillIndex : undefined,
                skillId: effectiveType === 'skill' ? effectiveSkill?.id : undefined,
                skillType: effectiveType === 'skill' ? effectiveSkill?.type : undefined,
                skillName: effectiveType === 'skill' ? (effectiveSkill?.name || 'Skill') : undefined,
                ultimateName: effectiveType === 'ultimate' ? (effectiveCharacter?.ultimate?.name || 'Ultimate') : undefined,
                actorCharacterId: effectiveCharacter?.id || actorCharacterId,
                result
            });

            return result;
        } catch (error) {
            console.error('Player One ultimate execution failed:', error);
            throw error;
        }
    }

    async playSkillAnimation(skillIndex, result) {
        const liveCharacter = this.gameState?.players?.get('player1')?.character;
        const skill = liveCharacter && Array.isArray(liveCharacter.skills) ? liveCharacter.skills[skillIndex] : null;
        
        // Basic animation logic - can be expanded later
        console.log(`Playing animation for ${skill ? skill.name : 'Skill'}`);
        
        if (result.damage > 0) {
            await this.playDamageAnimation(result.damage);
        }
        
        if (result.healing > 0) {
            await this.playHealingAnimation(result.healing);
        }

        // Simulate animation duration
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    async playUltimateAnimation(result) {
        const liveCharacter = this.gameState?.players?.get('player1')?.character;
        console.log(`Playing ultimate animation for ${liveCharacter?.ultimate?.name || 'Ultimate'}`);
        
        if (result.damage > 0) {
            await this.playDamageAnimation(result.damage);
        }
        
        if (result.healing > 0) {
            await this.playHealingAnimation(result.healing);
        }

        // Simulate longer animation for ultimate
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    async playDamageAnimation(damage) {
        console.log(`Player One deals ${damage} damage`);
        // Animation logic for dealing damage
    }

    async playHealingAnimation(healing) {
        console.log(`Player One heals for ${healing}`);
        // Animation logic for healing
    }

    async receiveDamage(damage, source) {
        if (!this.isActive) return;

        // Check if player is concealed (invincible)
        if (this.gameState && this.gameState.skillSystem && this.gameState.skillSystem.isConcealed('player1')) {
            console.log(`Player One damage blocked by conceal`);
            return;
        }

        console.log(`Player One receives ${damage} damage from ${source}`);
        
        // Update damage threshold passive if applicable
        this.gameState.updateDamageThresholdPassive('player1', damage);
        
        // Play damage received animation
        await this.playDamageReceivedAnimation(damage);
    }

    async receiveHealing(healing, source) {
        if (!this.isActive) return;

        console.log(`Player One receives ${healing} healing from ${source}`);
        
        // Play healing received animation
        await this.playHealingReceivedAnimation(healing);
    }

    async playDamageReceivedAnimation(damage) {
        console.log(`Player One takes ${damage} damage`);
        // Animation logic for taking damage
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    async playHealingReceivedAnimation(healing) {
        console.log(`Player One is healed for ${healing}`);
        // Animation logic for receiving healing
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    async onTurnStart() {
        if (!this.isActive) return;
        
        console.log('Player One turn started');
        
        // Process any start-of-turn effects
        // Update UI to show it's player's turn
    }

    async onTurnEnd() {
        if (!this.isActive) return;
        
        console.log('Player One turn ended');
        
        // Process any end-of-turn effects
        // Update UI to show turn ended
    }

    getCharacterState() {
        if (!this.gameState) return null;
        
        return this.gameState.getGameStateForPlayer('player1');
    }

    canUseSkill(skillIndex) {
        if (!this.gameState) return false;
        
        const liveCharacter = this.gameState.players.get('player1')?.character;
        const skills = liveCharacter && Array.isArray(liveCharacter.skills) ? liveCharacter.skills : [];
        const skill = skills[skillIndex];
        if (!skill || !skill.id) return false;
        return this.gameState.skillSystem.canUseSkill(skill, 'player1');
    }

    canUseUltimate() {
        if (!this.gameState) return false;
        
        const playerData = this.gameState.players.get('player1');
        return Boolean(playerData && playerData.ultimateReady && this.gameState.canUseUltimateWithLimit(playerData));
    }

    cleanup() {
        this.isActive = false;
        this.character = null;
        this.gameState = null;
        console.log('Player One cleaned up');
    }
}
