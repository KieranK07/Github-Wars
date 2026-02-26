const fs = require('fs');
const path = require('path');

// File paths
const PLAYERS_FILE = path.join(__dirname, 'players.json');
const README_FILE = path.join(__dirname, 'README.md');

// Environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ISSUE_NUMBER = process.env.ISSUE_NUMBER;
const ISSUE_AUTHOR = process.env.ISSUE_AUTHOR;
const EVENT_NAME = process.env.EVENT_NAME;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

/**
 * Load game state from players.json
 * Returns default state if file is missing or corrupted
 */
function loadGameState() {
  try {
    if (!fs.existsSync(PLAYERS_FILE)) {
      console.log('players.json not found, creating default state');
      return createDefaultState();
    }
    
    const data = fs.readFileSync(PLAYERS_FILE, 'utf8');
    const state = JSON.parse(data);
    
    return normalizeState(state, { logPrefix: 'Load' });
  } catch (error) {
    console.error('Error loading game state:', error.message);
    console.log('Creating default state');
    return createDefaultState();
  }
}

/**
 * Create default game state
 */
function createDefaultState() {
  return {
    season: 1,
    gameStarted: false,
    alivePlayers: [],
    eliminatedPlayers: [],
    winner: null,
    lastEvent: 'Waiting for players to join...',
    lastTick: null
  };
}

/**
 * Normalize state so players.json always uses a valid schema
 */
function normalizeState(rawState, options = {}) {
  const logPrefix = options.logPrefix ? `${options.logPrefix}: ` : '';
  const base = createDefaultState();
  const state = rawState && typeof rawState === 'object' ? rawState : {};

  const normalized = {
    season: Number.isInteger(state.season) && state.season > 0 ? state.season : base.season,
    gameStarted: typeof state.gameStarted === 'boolean' ? state.gameStarted : base.gameStarted,
    alivePlayers: [],
    eliminatedPlayers: [],
    winner: typeof state.winner === 'string' ? state.winner : null,
    lastEvent: typeof state.lastEvent === 'string' ? state.lastEvent : base.lastEvent,
    lastTick: typeof state.lastTick === 'string' || state.lastTick === null ? state.lastTick : null
  };

  const addUnique = (list, value) => {
    if (!value || typeof value !== 'string') {
      return;
    }
    if (!list.includes(value)) {
      list.push(value);
    }
  };

  if (Array.isArray(state.alivePlayers)) {
    state.alivePlayers.forEach((player) => addUnique(normalized.alivePlayers, player));
  }
  if (Array.isArray(state.eliminatedPlayers)) {
    state.eliminatedPlayers.forEach((player) => addUnique(normalized.eliminatedPlayers, player));
  }

  // Remove any eliminated players from alive list to keep lists consistent
  if (normalized.eliminatedPlayers.length > 0 && normalized.alivePlayers.length > 0) {
    normalized.alivePlayers = normalized.alivePlayers.filter(
      (player) => !normalized.eliminatedPlayers.includes(player)
    );
  }

  if (normalized.winner && !normalized.alivePlayers.includes(normalized.winner)) {
    normalized.winner = null;
  }

  if (rawState && JSON.stringify(rawState) !== JSON.stringify(normalized)) {
    console.log(`${logPrefix}State normalized for safe storage`);
  }

  return normalized;
}

/**
 * Save game state to players.json
 */
function saveState(state) {
  try {
    const normalized = normalizeState(state, { logPrefix: 'Save' });
    fs.writeFileSync(PLAYERS_FILE, JSON.stringify(normalized, null, 2), 'utf8');
    console.log('Game state saved successfully');
  } catch (error) {
    console.error('Error saving game state:', error.message);
    throw error;
  }
}

/**
 * Add a new player to the game
 */
function addPlayer(state, username) {
  // Check if game has started
  if (state.gameStarted && state.alivePlayers.length > 1) {
    console.log(`Game already started, ${username} cannot join this season`);
    state.lastEvent = `${username} tried to join, but the game has already started!`;
    return false;
  }
  
  // Check for duplicates
  if (state.alivePlayers.includes(username)) {
    console.log(`Player ${username} already in the game`);
    state.lastEvent = `${username} tried to join again, but they're already in the game!`;
    return false;
  }
  
  // Check if player was eliminated this season
  if (state.eliminatedPlayers.includes(username)) {
    console.log(`Player ${username} was already eliminated this season`);
    state.lastEvent = `${username} tried to rejoin, but they were already eliminated this season!`;
    return false;
  }
  
  // Add player
  state.alivePlayers.push(username);
  state.lastEvent = `🎮 ${username} has joined the battle!`;
  console.log(`Added player: ${username}`);
  
  // Start game if we have at least 2 players
  if (state.alivePlayers.length >= 2 && !state.gameStarted) {
    state.gameStarted = true;
    state.lastEvent = `🎮 ${username} has joined! The battle has begun with ${state.alivePlayers.length} players!`;
  }
  
  return true;
}

/**
 * Format a duration in milliseconds into a short string
 */
function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  if (totalMinutes < 60) {
    return `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}

/**
 * Get next event timing info
 */
function getNextEventInfo(state) {
  const intervalMs = 30 * 60 * 1000;
  if (!state.lastTick) {
    return {
      lastTickText: 'Unknown',
      nextTickText: 'Unknown (awaiting next scheduled tick)'
    };
  }

  const lastTickMs = Date.parse(state.lastTick);
  if (Number.isNaN(lastTickMs)) {
    return {
      lastTickText: 'Unknown',
      nextTickText: 'Unknown (awaiting next scheduled tick)'
    };
  }

  const nextTickMs = lastTickMs + intervalMs;
  const nowMs = Date.now();
  const deltaMs = nextTickMs - nowMs;
  const relative = deltaMs >= 0
    ? `${formatDuration(deltaMs)} from now`
    : `${formatDuration(-deltaMs)} ago`;

  return {
    lastTickText: new Date(lastTickMs).toISOString(),
    nextTickText: `${relative} (${new Date(nextTickMs).toISOString()})`
  };
}

/**
 * Run one game tick - eliminate a random player
 */
function runGameTick(state) {
  // Don't run tick if game hasn't started or no players
  if (!state.gameStarted || state.alivePlayers.length === 0) {
    console.log('Game not started or no players');
    return;
  }
  
  // Check for winner
  if (state.alivePlayers.length === 1) {
    const winner = state.alivePlayers[0];
    state.winner = winner;
    state.lastEvent = `👑 ${winner} is the winner of Season ${state.season}!`;
    console.log(`Winner: ${winner}`);
    
    // Reset for next season
    setTimeout(() => {
      resetSeason(state);
    }, 0);
    return;
  }
  
  // Eliminate random player
  const randomIndex = Math.floor(Math.random() * state.alivePlayers.length);
  const eliminatedPlayer = state.alivePlayers.splice(randomIndex, 1)[0];
  state.eliminatedPlayers.push(eliminatedPlayer);
  
  state.lastEvent = `💀 ${eliminatedPlayer} has been eliminated! ${state.alivePlayers.length} players remain.`;
  console.log(`Eliminated: ${eliminatedPlayer}`);
  
  // Check if we have a winner now
  if (state.alivePlayers.length === 1) {
    const winner = state.alivePlayers[0];
    state.winner = winner;
    state.lastEvent = `💀 ${eliminatedPlayer} has been eliminated!\n👑 ${winner} is the winner of Season ${state.season}!`;
    console.log(`Winner: ${winner}`);
  }
}

/**
 * Reset game for next season
 */
function resetSeason(state) {
  state.season += 1;
  state.gameStarted = false;
  state.alivePlayers = [];
  state.eliminatedPlayers = [];
  state.winner = null;
  state.lastEvent = `Season ${state.season} is ready! Open an issue to join the battle!`;
  console.log(`Reset to Season ${state.season}`);
}

/**
 * Update README.md with current game state
 */
function updateReadme(state) {
  const lines = [];
  const nextEventInfo = getNextEventInfo(state);
  
  lines.push('# 🎮 GitHub Wars - Battle Royale');
  lines.push('');
  lines.push('An automated multiplayer Battle Royale game running entirely through GitHub Actions!');
  lines.push('');
  lines.push('## 🕹️ How to Play');
  lines.push('');
  lines.push('**Open a new Issue to join the game!** Your GitHub username will be automatically added to the current season.');
  lines.push('');
  lines.push('- Every 30 minutes, one random player is eliminated');
  lines.push('- Last player standing wins the season');
  lines.push('- New season starts automatically after a winner is declared');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push(`## 📊 Season ${state.season} Status`);
  lines.push('');
  
  if (state.winner) {
    lines.push(`### 👑 WINNER: ${state.winner}`);
    lines.push('');
    lines.push(`**${state.winner}** has won Season ${state.season}!`);
    lines.push('');
    lines.push('🎉 New season starting soon...');
    lines.push('');
  } else if (state.gameStarted) {
    lines.push(`### ⚔️ Battle in Progress`);
    lines.push('');
    lines.push(`**${state.alivePlayers.length} players** are fighting for survival!`);
    lines.push('');
  } else {
    lines.push(`### 🎯 Waiting for Players`);
    lines.push('');
    lines.push('Open an issue to join the battle!');
    lines.push('');
  }
  
  lines.push(`- **Last Event:** ${state.lastEvent}`);
  lines.push(`- **Last Tick:** ${nextEventInfo.lastTickText}`);
  lines.push(`- **Next Event:** ${nextEventInfo.nextTickText}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  
  // Alive players
  lines.push(`### 💚 Alive Players (${state.alivePlayers.length})`);
  lines.push('');
  if (state.alivePlayers.length > 0) {
    state.alivePlayers.forEach((player, index) => {
      lines.push(`${index + 1}. **[@${player}](https://github.com/${player})**`);
    });
  } else {
    lines.push('*No players alive*');
  }
  lines.push('');
  
  // Eliminated players
  lines.push(`### 💀 Eliminated Players (${state.eliminatedPlayers.length})`);
  lines.push('');
  if (state.eliminatedPlayers.length > 0) {
    state.eliminatedPlayers.forEach((player, index) => {
      lines.push(`${index + 1}. ~~[@${player}](https://github.com/${player})~~`);
    });
  } else {
    lines.push('*No eliminations yet*');
  }
  lines.push('');
  
  lines.push('---');
  lines.push('');
  lines.push('## 📜 Game Rules');
  lines.push('');
  lines.push('1. **Join:** Open any issue to join the current season');
  lines.push('2. **Battle:** Every 30 minutes, one player is randomly eliminated');
  lines.push('3. **Win:** Last player standing wins the season');
  lines.push('4. **New Season:** Game resets automatically after a winner is declared');
  lines.push('5. **No Rejoining:** Cannot rejoin during the same season once eliminated');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Powered by GitHub Actions • Updates every 30 minutes*');
  
  const content = lines.join('\n');
  
  try {
    fs.writeFileSync(README_FILE, content, 'utf8');
    console.log('README.md updated successfully');
  } catch (error) {
    console.error('Error updating README:', error.message);
    throw error;
  }
}

/**
 * Close an issue using GitHub API
 */
async function closeIssue(issueNumber) {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !issueNumber) {
    console.log('Missing required info to close issue');
    return;
  }
  
  try {
    const [owner, repo] = GITHUB_REPOSITORY.split('/');
    const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
    
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        state: 'closed'
      })
    });
    
    if (response.ok) {
      console.log(`Issue #${issueNumber} closed successfully`);
    } else {
      console.error(`Failed to close issue: ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error closing issue:', error.message);
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('=== GitHub Wars - Battle Royale ===');
  console.log(`Event: ${EVENT_NAME}`);
  console.log(`Issue Author: ${ISSUE_AUTHOR || 'N/A'}`);
  console.log(`Issue Number: ${ISSUE_NUMBER || 'N/A'}`);
  console.log('');
  
  // Load current state
  let state = loadGameState();
  
  // Handle different event types
  if (EVENT_NAME === 'issues' && ISSUE_AUTHOR) {
    console.log('Processing new player join...');
    
    // Add player
    addPlayer(state, ISSUE_AUTHOR);
    
    // Close the issue immediately
    await closeIssue(ISSUE_NUMBER);
    
  } else if (EVENT_NAME === 'schedule' || EVENT_NAME === 'workflow_dispatch') {
    console.log('Processing scheduled game tick...');

    // Track scheduled tick time
    state.lastTick = new Date().toISOString();
    
    // Run game tick
    runGameTick(state);
    
    // If there's a winner, reset for next season
    if (state.winner && state.alivePlayers.length === 1) {
      // Keep winner displayed for this update
      // Schedule will reset on next run
      const currentWinner = state.winner;
      const currentSeason = state.season;
      
      // Save current state with winner
      saveState(state);
      updateReadme(state);
      
      // Now reset for next season
      resetSeason(state);
    }
  }
  
  // Save state and update README
  if (!Object.prototype.hasOwnProperty.call(state, 'lastTick')) {
    state.lastTick = null;
  }
  saveState(state);
  updateReadme(state);
  
  console.log('');
  console.log('=== Execution Complete ===');
}

// Run main function
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
