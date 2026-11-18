// Mole Spades — Mole Hub production adaptation of GeoHackers CryptoSpades.
(function () {
  window.WinLEWGameFactories = window.WinLEWGameFactories || {};
  window.WinLEWGameFactories.molespades = function createMoleSpades(deps) {
    // eslint-disable-next-line no-with
    with (deps) {
      return (() => {
        const SUITS = [
          { key: 'SPADE', name: 'Deep Spades', symbol: '♠', color: '#17130f', accent: '#f4b942' },
          { key: 'LANTERN', name: 'Lanterns', symbol: '◆', color: '#b64c25', accent: '#ff9b57' },
          { key: 'GEM', name: 'Cave Gems', symbol: '⬢', color: '#316fc4', accent: '#75c8ff' },
          { key: 'GRUB', name: 'Golden Grubs', symbol: '●', color: '#738c28', accent: '#cbe66b' },
        ];
        const NAMES = ['You', 'Molegan', 'Dirt Digger', 'Lady Burrow'];
        const BOT_ICONS = ['⛏️', '🕳️', '🪱'];
        const TEAM_NAMES = ['Burrow Crew', 'Deep Rivals'];
        const PERSONALITIES = ['', 'Bold opener', 'Steady partner', 'Patient closer'];
        const TARGET = 25;
        const TRUMP = 0;
        const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', 'W'];
        const board = $('moleSpadesBoard');
        const statusEl = $('moleSpadesStatus');
        const statsEl = $('moleSpadesStats');
        const logEl = $('moleSpadesLog');
        const metaKey = Storage.moleSpadesState;
        const sessionKey = Storage.moleSpadesSession;
        let meta = load(metaKey, { matches: 0, wins: 0, best: 0, winlew: 0 });
        const restored = load(sessionKey, null);
        let game = restored?.version === 2 && restored.game ? restored.game : null;
        let botTimer = 0;
        let matchToken = restored?.version === 2 ? String(restored.matchToken || '') : '';

        function persistGame() {
          if (!game) { localStorage.removeItem(sessionKey); return; }
          save(sessionKey, { version: 2, matchToken, game });
        }
        function validRestoredGame(candidate) {
          if (!candidate || !Array.isArray(candidate.hands) || candidate.hands.length !== 4) return false;
          if (!Array.isArray(candidate.teamScores) || candidate.teamScores.length !== 2) return false;
          if (candidate.hands.some((hand) => !Array.isArray(hand) || hand.length > 13)) return false;
          if (!Array.isArray(candidate.trick) || candidate.trick.length > 4) return false;
          const activeCards = [...candidate.hands.flat(), ...candidate.trick.map((entry) => entry?.card)].filter(Boolean);
          if (activeCards.some((card) => typeof card.id !== 'string' || !Number.isInteger(card.suit) || !Number.isInteger(card.rank))) return false;
          if (new Set(activeCards.map((card) => card.id)).size !== activeCards.length) return false;
          if (activeCards.length > 52 || !['contract', 'playing', 'trickEnd', 'roundEnd', 'matchEnd'].includes(candidate.phase)) return false;
          if (candidate.phase === 'contract' && (activeCards.length !== 52 || candidate.hands.some((hand) => hand.length !== 13))) return false;
          if (candidate.phase === 'playing' && (candidate.trick.length > 3 || activeCards.length === 0)) return false;
          if (candidate.phase === 'trickEnd' && candidate.trick.length !== 4) return false;
          return true;
        }
        if (!validRestoredGame(game)) { game = null; matchToken = ''; localStorage.removeItem(sessionKey); }

        function hashSeed(value) {
          let hash = 2166136261;
          for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
          return hash >>> 0;
        }
        function seeded(seed) {
          let value = hashSeed(seed);
          return () => { value += 0x6d2b79f5; let x = value; x = Math.imul(x ^ (x >>> 15), x | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
        }
        function deckFor(seed) {
          const deck = [];
          for (let suit = 0; suit < 4; suit++) {
            for (let rank = 0; rank < 13; rank++) {
              if (suit === TRUMP && rank === 0) continue;
              deck.push({ id: `${suit}-${rank}`, suit, rank, wild: false });
            }
          }
          deck.push({ id: '0-13', suit: TRUMP, rank: 13, wild: true });
          const random = seeded(seed);
          for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
          return deck;
        }
        const sortHand = (hand) => [...hand].sort((a, b) => (a.suit - b.suit) || (a.rank - b.rank));
        function aiContract(hand, personality) {
          const high = hand.filter((c) => c.rank >= 9).length;
          const trump = hand.filter((c) => c.suit === TRUMP).length;
          const bias = personality === 1 ? 0.35 : personality === 2 ? -0.3 : 0;
          const bid = clamp(Math.round(high * 0.72 + Math.max(0, trump - 3) * 0.55 + bias), 0, 7);
          return { bid, stake: bid >= 5 ? 3 : bid >= 2 ? 2 : 1 };
        }
        function newRound(scores = [0, 0, 0, 0], round = 0, topStreak = [0, 0, 0, 0], teamScores = [0, 0]) {
          const deck = deckFor(`${matchToken}:${round}`);
          game = {
            round, scores: [...scores], teamScores: [...teamScores], topStreak: [...topStreak], hands: [0, 1, 2, 3].map((seat) => sortHand(deck.slice(seat * 13, seat * 13 + 13))),
            trick: [], leadSuit: null, trumpBroken: false, turn: round % 4, tricks: [0, 0, 0, 0], streaks: [0, 0, 0, 0], drops: [0, 0, 0, 0],
            bids: null, stakes: [1, 1, 1, 1], settle: null, phase: 'contract', bid: 3, stake: 1, message: 'Study your hand and set a contract.', log: [], lastWinner: null, rewardClaimed: false,
          };
          addLog(`Round ${round + 1} dealt. Dirt Digger is your partner across the table.`);
          render();
        }
        function startOrResume() {
          hideRewardOverlay();
          // Bring the table into view, not the top of the whole site —
          // scrolling to page-top jumps away from the game itself. This is
          // the single entry point for a new match, a resume, and starting
          // the next round, so one call here covers all three.
          board.scrollIntoView({ block: 'start', behavior: 'auto' });
          if (!game) {
            matchToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            newRound();
          } else if (game.phase === 'matchEnd' && !game.rewardClaimed) {
            offerMatchReward(game.winningTeam);
          } else if (game.phase === 'matchEnd') {
            game = null; matchToken = `${Date.now()}-${Math.random().toString(36).slice(2)}`; newRound();
          }
          showView('molespades');
          render();
        }
        function reset() { clearTimeout(botTimer); game = null; matchToken = ''; localStorage.removeItem(sessionKey); hideRewardOverlay(); render(); }
        function addLog(message) {
          if (!game) return;
          game.log.unshift(message); game.log = game.log.slice(0, 10);
        }
        function legalCardsFor(state, player) {
          const hand = state.hands[player];
          if (!state.trick.length) {
            const nonTrump = hand.filter((c) => c.suit !== TRUMP);
            return state.trumpBroken || !nonTrump.length ? hand : nonTrump;
          }
          const follow = hand.filter((c) => c.suit === state.leadSuit);
          return follow.length ? follow : hand;
        }
        function legalCards(player) { return legalCardsFor(game, player); }
        function illegalReason(card) {
          if (game.phase === 'contract') return 'Inspect your hand, then lock a contract';
          if (game.phase !== 'playing') return game.phase === 'trickEnd' ? 'Trick is resolving' : 'Wait for the next deal';
          if (game.turn !== 0) return `Wait for ${NAMES[game.turn]}`;
          if (legalCards(0).some((legal) => legal.id === card.id)) return '';
          if (game.trick.length && game.hands[0].some((held) => held.suit === game.leadSuit)) return `Follow ${SUITS[game.leadSuit].name}`;
          if (!game.trick.length && card.suit === TRUMP && !game.trumpBroken) return 'Deep Spades have not been broken';
          return 'That card is not legal now';
        }
        function currentWinner(trick = game.trick) {
          let best = trick[0];
          for (const candidate of trick.slice(1)) {
            if (candidate.card.suit === TRUMP && best.card.suit !== TRUMP) best = candidate;
            else if (candidate.card.suit === best.card.suit && candidate.card.rank > best.card.rank) best = candidate;
          }
          return best;
        }
        function winnerExplanation(entry, trick = game.trick) {
          const lead = SUITS[trick[0].card.suit].name;
          if (entry.card.wild) return 'The WinLEW Wild is the highest Deep Spade.';
          if (entry.card.suit === TRUMP && trick[0].card.suit !== TRUMP) return `${RANKS[entry.card.rank]} of Deep Spades trumped ${lead}.`;
          return `${RANKS[entry.card.rank]} was the highest ${lead} card.`;
        }
        function cardBeats(card, winning, leadSuit) {
          if (card.suit === TRUMP && winning.suit !== TRUMP) return true;
          if (card.suit === winning.suit) return card.rank > winning.rank;
          return winning.suit !== TRUMP && card.suit === leadSuit;
        }
        function aiChoose(player) {
          const legal = [...legalCards(player)].sort((a, b) => a.rank - b.rank);
          const personality = player - 1;
          if (!game.trick.length) {
            if (personality === 0) return legal.find((c) => c.suit !== TRUMP && c.rank >= 9) || legal[0];
            if (personality === 1) return legal.at(-1);
            return legal[Math.floor(legal.length / 2)];
          }
          const winning = currentWinner().card;
          const winningSeat = currentWinner().player;
          const winners = legal.filter((c) => cardBeats(c, winning, game.leadSuit));
          if (player === 2 && winningSeat % 2 === 0) return legal[0];
          if (winners.length) return personality === 0 ? winners.at(-1) : winners[0];
          return legal[0];
        }
        function playCard(player, cardId) {
          if (game.phase !== 'playing' || game.turn !== player) {
            if (player === 0 && game) { game.message = game.phase === 'contract' ? 'Lock your contract before playing.' : game.phase === 'trickEnd' ? 'The trick is resolving.' : `Wait for ${NAMES[game.turn]}.`; render(); }
            return;
          }
          const legal = legalCards(player);
          const card = game.hands[player].find((c) => c.id === cardId);
          if (!card || !legal.some((c) => c.id === cardId)) { game.message = card ? illegalReason(card) : 'That card is unavailable.'; Sound.blip(150, .08, 'sawtooth', .025); render(); return; }
          game.spotlight = '';
          game.hands[player] = game.hands[player].filter((c) => c.id !== cardId);
          if (!game.trick.length) game.leadSuit = card.suit;
          if (card.suit === TRUMP && !game.trumpBroken) { game.trumpBroken = true; addLog('Deep Spades have been broken.'); }
          game.trick.push({ player, card });
          game.turn = (player + 1) % 4;
          game.message = `${NAMES[player]} played ${RANKS[card.rank]} ${SUITS[card.suit].name}.`;
          Sound.blip(280 + card.rank * 16, .045, 'triangle', .018);
          if (game.trick.length === 4) {
            game.phase = 'trickEnd';
            const winningEntry = currentWinner();
            const winner = winningEntry.player;
            game.lastWinner = winner;
            game.resolveStage = 'show';
            game.winnerReason = winnerExplanation(winningEntry);
            game.message = `${NAMES[winner]} wins the trick — ${game.winnerReason}`;
            addLog(game.message);
            Sound.blip(winner % 2 === 0 ? 720 : 420, .10, 'triangle', .03);
            render();
            botTimer = setTimeout(() => {
              if (!game || game.phase !== 'trickEnd') return;
              game.resolveStage = 'collect';
              render();
              botTimer = setTimeout(resolveTrick, 480);
            }, 1450);
            return;
          }
          render();
          scheduleBot();
        }
        function resolveTrick() {
          if (!game || game.phase !== 'trickEnd') return;
          const winner = currentWinner().player;
          game.tricks[winner]++;
          game.streaks = game.streaks.map((n, i) => i === winner ? n + 1 : 0);
          if (game.streaks[winner] === 3) { game.drops[winner]++; game.streaks[winner] = 0; game.spotlight = `${NAMES[winner]} earned a Tunnel Drop!`; addLog(game.spotlight); Sound.coin(); }
          const roundOver = game.hands.every((hand) => hand.length === 0);
          game.trick = []; game.leadSuit = null; game.turn = winner; game.lastWinner = winner; game.resolveStage = '';
          if (roundOver) settleRound();
          else { game.phase = 'playing'; game.message = winner === 0 ? 'You lead the next trick.' : `${NAMES[winner]} leads next.`; render(); scheduleBot(); }
        }
        function settleRound() {
          const top = Math.max(...game.tricks);
          game.tricks.forEach((count, i) => { if (count >= 6) game.drops[i] += 2; });
          game.topStreak = game.topStreak.map((n, i) => game.tricks[i] === top ? n + 1 : 0);
          game.topStreak.forEach((n, i) => { if (n >= 3) { game.drops[i] += 3; game.topStreak[i] = 0; } });
          game.settle = game.tricks.map((count, i) => { const miss = Math.abs(count - game.bids[i]); return miss === 0 ? game.stakes[i] * 3 : miss === 1 ? 0 : -game.stakes[i]; });
          const gains = game.tricks.map((count, i) => count + game.settle[i] + game.drops[i]);
          game.scores = game.scores.map((score, i) => score + gains[i]);
          game.teamScores = [game.teamScores[0] + gains[0] + gains[2], game.teamScores[1] + gains[1] + gains[3]];
          const best = Math.max(...game.teamScores);
          const teamLeaders = game.teamScores.map((score, i) => score === best ? i : -1).filter((i) => i >= 0);
          game.phase = best >= TARGET && teamLeaders.length === 1 ? 'matchEnd' : 'roundEnd';
          game.message = game.phase === 'matchEnd' ? `${TEAM_NAMES[teamLeaders[0]]} rule the Deep Table!` : `${NAMES[game.tricks.indexOf(top)]} topped the round.`;
          if (game.phase === 'matchEnd') finishMatch(teamLeaders[0]);
          render();
        }
        function finishMatch(winningTeam) {
          game.winningTeam = winningTeam;
          if (!game.finalized) {
            game.finalized = true;
            meta.matches++; if (winningTeam === 0) meta.wins++; meta.best = Math.max(meta.best, game.teamScores[0]); save(metaKey, meta);
          }
          persistGame();
          offerMatchReward(winningTeam);
        }
        function offerMatchReward(winningTeam) {
          const won = winningTeam === 0;
          const rawBase = won ? 65 + game.teamScores[0] + Math.max(0, 8 - game.round) * 3 : 16 + Math.max(0, game.teamScores[0]);
          const baseReward = balanceGameReward('molespades', rawBase);
          showRewardOverlay({
            title: won ? 'Deep Table Champion' : 'Match Complete',
            badge: 'Mole Spades reward',
            text: `${won ? 'You and Dirt Digger conquered the burrow table.' : 'Your crew completed a full match.'}<br><br>Team score: <strong>${game.teamScores[0]}</strong> · Rounds: <strong>${game.round + 1}</strong><br>Base payout: <strong>${baseReward.toFixed(2)} WinLEW</strong><br><small>XL1 payout rail: planned, not active.</small>`,
            boxes: buildRewardBoxes(),
            continueLabel: 'Return to the table',
            onPick: (box) => {
              if (game.rewardClaimed) return { immediate: 'This match reward was already claimed.' };
              game.rewardClaimed = true;
              persistGame();
              const payout = Number((baseReward * box.multiplier).toFixed(2));
              const total = addWallet(payout); meta.winlew = Number((meta.winlew + payout).toFixed(2)); save(metaKey, meta);
              const claimPromise = postRewardClaim({ game: 'molespades', roundKey: `match-${matchToken}`, roundLabel: `Mole Spades match ${game.round + 1}`, baseReward: rawBase, multiplier: box.multiplier, payout, meta: { won, score: game.teamScores[0], rounds: game.round + 1, payoutCurrency: 'WINLEW', futureCurrencies: ['XL1'] } });
              // Corrects this optimistic credit to the server-authoritative
              // amount (up, down, or rolled back entirely) the moment the
              // claim response lands, instead of leaving it to eventually
              // self-heal — which for a guest only ever heals upward.
              const sync = reconcileClaimResult(payout, claimPromise);
              return { immediate: `You earned <strong>${payout.toFixed(2)} WinLEW</strong>.<br>Stored total: <strong>${total.toFixed(2)} WinLEW</strong>.`, sync };
            },
            onContinue: () => { game = null; matchToken = ''; persistGame(); render(); },
          });
        }
        function scheduleBot() {
          clearTimeout(botTimer);
          if (!game || game.phase !== 'playing' || game.turn === 0) return;
          botTimer = setTimeout(() => { if (game?.phase === 'playing' && game.turn !== 0) playCard(game.turn, aiChoose(game.turn).id); }, 460 + Math.random() * 330);
        }
        function lockContract() {
          if (!game || game.phase !== 'contract') return;
          const bots = game.hands.slice(1).map((hand, i) => aiContract(hand, i));
          game.bids = [game.bid, ...bots.map((c) => c.bid)];
          game.stakes = [game.stake, ...bots.map((c) => c.stake)];
          game.phase = 'playing'; game.message = game.turn === 0 ? 'Contract locked. You lead.' : `${NAMES[game.turn]} opens the round.`;
          addLog(`You bid ${game.bid} at ${game.stake}× risk.`); render(); scheduleBot();
        }
        function nextRound() { if (game?.phase === 'roundEnd') newRound(game.scores, game.round + 1, game.topStreak, game.teamScores); }
        function cardHtml(card, playable = false, compact = false, winner = false, preview = false, reason = '') {
          const suit = SUITS[card.suit];
          const handState = !compact && !preview && !playable ? ' illegal' : '';
          const disabled = compact || preview ? 'disabled' : '';
          const label = card.wild ? 'WinLEW Wild, highest Deep Spade' : `${RANKS[card.rank]} ${suit.name}`;
          return `<button class="ms-card${card.wild ? ' wild' : ''}${compact ? ' compact' : ''}${playable ? ' playable' : ''}${preview ? ' preview' : ''}${winner ? ' winner' : ''}${handState}" style="--suit:${suit.color};--accent:${suit.accent}" data-card="${card.id}" ${disabled} aria-disabled="${playable ? 'false' : 'true'}" aria-label="${label}${reason ? `. ${reason}` : ''}" data-reason="${reason}"><span class="ms-corner">${card.wild ? 'W' : RANKS[card.rank]} ${suit.symbol}</span><b>${card.wild ? 'W' : suit.symbol}</b><small>${card.wild ? 'WINLEW WILD' : suit.key}</small>${card.suit === TRUMP ? '<em>TRUMP</em>' : ''}${reason && !compact ? `<span class="ms-card-reason">${reason}</span>` : ''}</button>`;
        }
        function renderHud() {
          const contract = game.bids ? `${game.bids[0]} @ ${game.stakes[0]}×` : 'Not locked';
          const lead = game.leadSuit == null ? '—' : SUITS[game.leadSuit].name;
          return `<div class="ms-hud"><div><span>ROUND</span><strong>${game.round + 1}</strong></div><div><span>TRUMP</span><strong>♠ Deep</strong></div><div><span>LED</span><strong>${lead}</strong></div><div><span>TO WIN</span><strong>${TARGET}</strong></div><div class="team"><span>BURROW CREW</span><strong>${game.teamScores[0]}</strong><small>You + Dirt Digger</small></div><div><span>CONTRACT</span><strong>${contract}</strong></div><div><span>YOUR TRICKS</span><strong>${game.tricks[0]}</strong></div><div><span>TURN</span><strong>${game.phase === 'playing' ? NAMES[game.turn] : game.phase === 'contract' ? 'Bid' : 'Settle'}</strong></div><div><span>SPADES</span><strong>${game.trumpBroken ? 'Broken' : 'Locked'}</strong></div></div>`;
        }
        function seatState(seat) {
          if (game.phase === 'trickEnd' && game.lastWinner === seat) return 'Won trick';
          if (game.trick.some((entry) => entry.player === seat)) return 'Played';
          if (game.phase === 'playing' && game.turn === seat) return game.trick.length ? 'Thinking…' : 'Leading…';
          return 'Waiting';
        }
        function renderTable() {
          const trickBySeat = new Map(game.trick.map((entry) => [entry.player, entry]));
          const winningEntry = game.trick.length ? currentWinner() : null;
          return `<div class="ms-table${game.resolveStage === 'collect' ? ' collecting' : ''}">
            <div class="ms-bot ms-bot-top partner${game.turn === 2 && game.phase === 'playing' ? ' active' : ''}"><span>⛏️</span><strong>${NAMES[2]}</strong><b>YOUR PARTNER · ${PERSONALITIES[2]}</b><small>${game.scores[2]} pts · ${game.tricks[2]} tricks · ${game.hands[2].length} cards</small><em>${seatState(2)}</em></div>
            <div class="ms-bot ms-bot-left${game.turn === 1 && game.phase === 'playing' ? ' active' : ''}"><span>🕳️</span><strong>${NAMES[1]}</strong><b>${PERSONALITIES[1]}</b><small>${game.scores[1]} pts · ${game.tricks[1]} tricks · ${game.hands[1].length} cards</small><em>${seatState(1)}</em></div>
            <div class="ms-bot ms-bot-right${game.turn === 3 && game.phase === 'playing' ? ' active' : ''}"><span>🪱</span><strong>${NAMES[3]}</strong><b>${PERSONALITIES[3]}</b><small>${game.scores[3]} pts · ${game.tricks[3]} tricks · ${game.hands[3].length} cards</small><em>${seatState(3)}</em></div>
            <div class="ms-trick">${[0,1,2,3].map((seat) => { const entry = trickBySeat.get(seat); return `<div class="ms-trick-card seat-${seat}">${entry ? cardHtml(entry.card, false, true, winningEntry === entry) : ''}</div>`; }).join('')}<div class="ms-table-message"><span>${game.phase === 'playing' && game.turn === 0 ? 'YOUR MOVE' : game.phase === 'contract' ? 'SET CONTRACT' : 'DEEP TABLE'}</span><strong>${game.message}</strong></div></div>
            <div class="ms-trump"><span>♠</span> Deep Spades ${game.trumpBroken ? 'broken' : 'locked'}</div>
          </div>`;
        }
        function renderContract() {
          if (game.phase !== 'contract') return '';
          return `<div class="ms-contract-stage"><section class="ms-modal"><span class="eyebrow">ROUND ${game.round + 1} CONTRACT</span><h2>How deep will your crew dig?</h2><p>Inspect your full hand below. Exact bid: <strong>+3 × risk</strong> · Off by one: <strong>no adjustment</strong> · Miss by 2+: <strong>−risk</strong>.</p><div class="ms-contract"><label>TRICK BID<div><button data-adjust="bid:-1" aria-label="Lower trick bid">−</button><strong>${game.bid}</strong><button data-adjust="bid:1" aria-label="Raise trick bid">+</button></div></label><label>RISK<div class="ms-risk-buttons">${[1,2,3].map((risk) => `<button class="${game.stake === risk ? 'selected' : ''}" data-risk="${risk}">${risk}×</button>`).join('')}</div></label></div><button class="btn primary" id="moleSpadesLock">Lock Contract</button></section></div>`;
        }
        function renderResults() {
          if (!['roundEnd', 'matchEnd'].includes(game.phase)) return '';
          return `<div class="ms-overlay"><section class="ms-modal ms-results"><span class="eyebrow">${game.phase === 'matchEnd' ? 'MATCH COMPLETE' : `ROUND ${game.round + 1} SETTLED`}</span><h2>${game.message}</h2><div class="ms-result-grid">${NAMES.map((name, i) => `<div><span>${name}</span><b>${game.tricks[i]}/${game.bids[i]}</b><small>${game.settle[i] >= 0 ? '+' : ''}${game.settle[i]} contract · +${game.drops[i]} drops</small></div>`).join('')}</div>${game.phase === 'roundEnd' ? '<button class="btn primary" id="moleSpadesNext">Deal Next Round</button>' : '<p class="muted">Choose your WinLEW reward box to complete the match.</p>'}</section></div>`;
        }
        function bindBoard() {
          board.querySelectorAll('.ms-hand [data-card]').forEach((el) => el.addEventListener('click', () => playCard(0, el.dataset.card)));
          board.querySelectorAll('[data-adjust]').forEach((el) => el.addEventListener('click', () => { const [field, delta] = el.dataset.adjust.split(':'); game[field] = clamp(game[field] + Number(delta), field === 'bid' ? 0 : 1, field === 'bid' ? 7 : 3); render(); }));
          board.querySelectorAll('[data-risk]').forEach((el) => el.addEventListener('click', () => { game.stake = Number(el.dataset.risk); render(); }));
          $('moleSpadesLock')?.addEventListener('click', lockContract);
          $('moleSpadesNext')?.addEventListener('click', nextRound);
        }
        function render() {
          if (!board) return;
          persistGame();
          statsEl.innerHTML = `<div class="stat"><div class="stat-label">Matches</div><div class="stat-value">${meta.matches}</div></div><div class="stat"><div class="stat-label">Wins</div><div class="stat-value">${meta.wins}</div></div><div class="stat"><div class="stat-label">Best</div><div class="stat-value">${meta.best}</div></div><div class="stat"><div class="stat-label">Earned</div><div class="stat-value">${Number(meta.winlew || 0).toFixed(2)}</div></div>`;
          const active = Boolean(game && !['matchEnd'].includes(game.phase));
          views.molespades?.classList.toggle('ms-active-match', active);
          [$('moleSpadesStartBtn'), $('moleSpadesStartTop')].forEach((button) => button?.classList.toggle('hidden', active));
          if (!game) {
            statusEl.textContent = 'Ready'; logEl.innerHTML = '<div class="log-entry">The Deep Table is ready.</div>';
            board.innerHTML = `<div class="ms-lobby"><div><span class="eyebrow">TRICK-TAKING · SOLO TABLE</span><h2>Mole <em>Spades</em></h2><p>Contract-driven trick taking against three distinct mole rivals. Follow faction, break Deep Spades, land exact bids, and reach 25 first.</p><div class="ms-feature-row"><span>♠ Trump strategy</span><span>🎯 Exact-bid bonuses</span><span>🪙 WinLEW rewards</span><span class="planned">XL1 · Planned</span></div><button class="btn primary" id="moleSpadesLobbyStart">Take Your Seat</button></div><div class="ms-hero-card"><span>DEEP TABLE</span><b>♠</b><small>MOLE SPADES</small></div></div>`;
            $('moleSpadesLobbyStart')?.addEventListener('click', startOrResume); return;
          }
          statusEl.textContent = game.phase === 'contract' ? 'Contract' : game.phase === 'playing' ? (game.turn === 0 ? 'Your turn' : `${NAMES[game.turn]} thinking`) : game.phase === 'trickEnd' ? 'Resolving trick' : game.phase === 'roundEnd' ? 'Round settled' : 'Match complete';
          logEl.innerHTML = game.log.map((line) => `<div class="log-entry">${line}</div>`).join('');
          const playable = new Set(game.phase === 'playing' && game.turn === 0 ? legalCards(0).map((c) => c.id) : []);
          const nextAction = game.phase === 'contract' ? 'Inspect your cards and lock a contract.' : game.phase === 'playing' && game.turn === 0 ? (game.leadSuit == null ? (game.trumpBroken ? 'Lead any card.' : 'Lead a non-spade until Deep Spades are broken.') : `Follow ${SUITS[game.leadSuit].name} if you can.`) : game.phase === 'playing' ? `${NAMES[game.turn]} is ${game.trick.length ? 'thinking' : 'leading'}…` : game.message;
          const liveLog = game.log.slice(0, 3).map((line, index) => `<div class="${index === 0 ? 'latest' : ''}">${line}</div>`).join('');
          board.innerHTML = `<div class="ms-matchbar" role="status" aria-live="polite"><span>BURROW CREW vs DEEP RIVALS</span><span class="${game.turn === 0 ? 'your-turn' : ''}">${game.message}</span></div>${renderHud()}${renderTable()}${game.spotlight ? `<div class="ms-spotlight">${game.spotlight}</div>` : ''}<div class="ms-action-hint">${nextAction}</div><div class="ms-live-log" aria-label="Recent table events">${liveLog}</div><div class="ms-hand-head"><span>YOUR HAND · ${game.hands[0].length} CARDS</span><span>${game.phase === 'contract' ? 'Inspect your cards, then bid' : game.phase === 'playing' && game.turn === 0 ? 'Raised cards are legal' : 'Cards explain why they are unavailable'}</span></div><div class="ms-hand">${game.hands[0].map((card) => { const reason = game.phase === 'contract' ? '' : illegalReason(card); return cardHtml(card, !reason && game.phase !== 'contract', false, false, game.phase === 'contract', reason); }).join('')}</div>${renderContract()}${renderResults()}`;
          bindBoard();
        }

        $('moleSpadesStartBtn').onclick = startOrResume;
        $('moleSpadesStartTop').onclick = startOrResume;
        $('moleSpadesResetBtn').onclick = reset;
        $('moleSpadesResetTop').onclick = reset;
        $('moleSpadesHomeTop').onclick = () => { clearTimeout(botTimer); showView('hub'); };
        render();
        if (game?.phase === 'playing' && game.turn !== 0) scheduleBot();
        if (game?.phase === 'trickEnd') {
          game.resolveStage = 'show';
          botTimer = setTimeout(() => { if (game?.phase === 'trickEnd') resolveTrick(); }, 900);
        }
        return {
          startOrResume, startRun: startOrResume, reset, renderAll: render, draw: render,
          __test: {
            deckFor,
            legalCardsFor,
            currentWinner: (trick) => currentWinner(trick),
            getState: () => game,
            setState: (state) => { game = state; },
            settleRound,
          },
        };
      })();
    }
  };
})();
