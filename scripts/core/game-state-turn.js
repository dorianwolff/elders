GameState.prototype.endTurn = async function () {
    if (this.gamePhase !== 'active') return;

    if (this.passiveSystem) {
        await this.passiveSystem.handleEvent(this.currentTurn, 'turn_end');

        // Allow character extensions to react to "opponent turn end" specifically.
        const opponentOfCurrent = this.currentTurn === 'player1' ? 'player2' : 'player1';
        await this.passiveSystem.handleEvent(opponentOfCurrent, 'opponent_turn_end', { opponentId: this.currentTurn });
    }

    const currentPlayer = this.players.get(this.currentTurn);
    if (currentPlayer) {
        const condition = this.getUltimateCondition(currentPlayer.character);
        if (condition && condition.type === 'turns_survived') {
            this.ensureUltimateProgressShape(currentPlayer.character);
            currentPlayer.character.passiveProgress.turnsSurvived++;
            this.checkAndSetUltimateReady(currentPlayer);
        }

        const passive = currentPlayer.character.passive;
        if (
            passive &&
            passive.type === 'dual_passive' &&
            passive.ongoing_effect &&
            passive.ongoing_effect.type === 'escalating_power'
        ) {
            const ongoing = passive.ongoing_effect;
            if (!currentPlayer.character.baseStats) {
                currentPlayer.character.baseStats = { ...currentPlayer.character.stats };
            }

            const baseAttack = Number(currentPlayer.character.baseStats.attack) || 0;

            currentPlayer.character.baseStats.attack = Math.max(
                1,
                baseAttack * (1 + (Number(ongoing.damage_per_turn) || 0))
            );

            if (this.skillSystem && typeof this.skillSystem.recalculateStats === 'function') {
                this.skillSystem.recalculateStats(this.currentTurn);
            }
        }
    }

    await this.skillSystem.processEndOfTurnEffects(this.currentTurn);

    this.skillSystem.decrementCooldowns(this.currentTurn);

    const opponentOfCurrent = this.currentTurn === 'player1' ? 'player2' : 'player1';
    if (this.skillSystem && typeof this.skillSystem.decrementNonDotDurationsForOwner === 'function') {
        this.skillSystem.decrementNonDotDurationsForOwner(opponentOfCurrent);
    }

    const currentRound = Math.floor(this.turnCount / 2) + 1;
    if (currentRound >= 10) {
        await this.applyProgressiveHPLoss(this.currentTurn);

        const p1 = this.players.get('player1')?.character;
        const p2 = this.players.get('player2')?.character;
        const p1Hp = Number(p1?.stats?.health) || 0;
        const p2Hp = Number(p2?.stats?.health) || 0;

        if (p1Hp <= 0 && p2Hp <= 0) {
            this.gamePhase = 'finished';
            this.winner = 'draw';
            return;
        }
        if (p1Hp <= 0) {
            this.gamePhase = 'finished';
            this.winner = 'player2';
            return;
        }
        if (p2Hp <= 0) {
            this.gamePhase = 'finished';
            this.winner = 'player1';
            return;
        }
    }

    this.currentTurn = this.currentTurn === 'player1' ? 'player2' : 'player1';
    this.turnCount++;

    if (this.passiveSystem) {
        await this.passiveSystem.handleEvent(this.currentTurn, 'turn_start');
    }

    if (this.skillSystem && typeof this.skillSystem.processStartOfTurnEffects === 'function') {
        await this.skillSystem.processStartOfTurnEffects(this.currentTurn);
    }
};

GameState.prototype.applyProgressiveHPLoss = async function (playerId) {
    const player = this.players.get(playerId);
    if (!player || !player.character || !player.character.stats) return;

    const character = player.character;
    const maxHp = Number(character.stats.maxHealth) || 0;
    if (maxHp <= 1) return;

    const currentRound = Math.floor(this.turnCount / 2) + 1;
    const loss = Math.max(0, 5 + Math.max(0, currentRound - 10));
    character.stats.health = Math.max(0, (Number(character.stats.health) || 0) - loss);

    if (loss > 0 && this.skillSystem && typeof this.skillSystem.emitCombatText === 'function') {
        this.skillSystem.emitCombatText('damage', loss, playerId);
    }

    if (this.skillSystem && typeof this.skillSystem.recalculateStats === 'function') {
        this.skillSystem.recalculateStats(playerId);
    }
};
