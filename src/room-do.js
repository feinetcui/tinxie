// Durable Object: Room - 管理房间状态和 WebSocket 连接
export class Room {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.players = new Map(); // nickname -> { ws, wsKey }
    this.host = null; // { ws, wsKey }
    this.words = [];
    this.currentTime = 10;
    this.currentWordIndex = 0;
    this.isPracticing = false;

    // 恢复 WebSocket 连接
    this.state.blockConcurrencyWhile(async () => {
      const wsKeys = this.state.getWebSockets();
      for (const ws of wsKeys) {
        const tag = this.state.getTags(ws);
        if (tag.includes('host')) {
          this.host = { ws, wsKey: ws };
        } else {
          const nickname = tag.find(t => t.startsWith('player:'))?.replace('player:', '');
          if (nickname) {
            this.players.set(nickname, { ws, wsKey: ws });
          }
        }
      }
    });
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/websocket') {
      return this.handleWebSocketUpgrade(request);
    }

    if (url.pathname === '/info') {
      return Response.json({
        playerCount: this.players.size,
        isPracticing: this.isPracticing
      });
    }

    return new Response('Not Found', { status: 404 });
  }

  handleWebSocketUpgrade(request) {
    const upgradeHeader = request.headers.get('Upgrade');
    console.log('WebSocket upgrade request, Upgrade header:', upgradeHeader);

    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      console.log('Missing or invalid Upgrade header');
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const url = new URL(request.url);
    const role = url.searchParams.get('role') || 'player';
    const nickname = url.searchParams.get('nickname') || '';
    const roomId = url.searchParams.get('roomId') || this.state.id.toString();

    console.log('Creating WebSocket for role:', role, 'nickname:', nickname, 'roomId:', roomId);

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // 保存 roomId 和 nickname
    this.roomId = roomId;

    // 对于选手，使用 nickname 作为标识
    const tags = role === 'host' ? ['host'] : [`player:${nickname}`];
    console.log('WebSocket tags:', tags);

    this.state.acceptWebSocket(server, tags);

    console.log('WebSocket accepted for role:', role);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  async webSocketMessage(ws, message) {
    console.log('WebSocket message received, length:', message.length);
    try {
      const data = JSON.parse(message);
      console.log('Parsed message type:', data.type);
      await this.handleMessage(ws, data);
    } catch (e) {
      console.error('Message parse error:', e.message);
    }
  }

  async webSocketClose(ws, code, reason) {
    console.log('WebSocket closed, code:', code);
    // 移除断开的连接
    for (const [nickname, player] of this.players) {
      if (player.ws === ws) {
        this.players.delete(nickname);
        console.log('Player disconnected:', nickname, 'Remaining:', this.players.size);
        this.sendToHost({
          type: 'player_left',
          playerCount: this.players.size
        });
        break;
      }
    }
  }

  async handleMessage(ws, data) {
    console.log('Handling message type:', data.type);
    try {
      switch (data.type) {
        case 'create_room':
          console.log('Creating room, host connected');
          this.host = { ws };
          const roomId = this.roomId || this.state.id.toString();
          console.log('Host set. Sending room_created with roomId:', roomId);
          ws.send(JSON.stringify({
            type: 'room_created',
            roomId: roomId
          }));
          break;

        case 'join_room':
          console.log('Player joining:', data.nickname, 'to room:', data.roomId);
          if (this.players.has(data.nickname)) {
            console.log('Nickname already taken:', data.nickname);
            ws.send(JSON.stringify({
              type: 'error',
              message: '昵称已被使用'
            }));
            return;
          }
          this.players.set(data.nickname, { ws });
          console.log('Player joined. Total players:', this.players.size);
          ws.send(JSON.stringify({
            type: 'room_joined',
            roomId: data.roomId,
            nickname: data.nickname
          }));
          this.sendToHost({
            type: 'player_joined',
            nickname: data.nickname,
            playerCount: this.players.size
          });
          break;

        case 'start_round':
          console.log('Starting round. Host:', this.host ? 'connected' : 'null', 'Players:', this.players.size);
          console.log('Words:', data.words);
          this.words = data.words;
          this.currentTime = data.timeLimit;
          this.currentWordIndex = 0;
          this.isPracticing = false;
          console.log('Broadcasting round_started to', this.players.size, 'players');
          this.broadcastToPlayers({
            type: 'round_started',
            words: data.words,
            timeLimit: data.timeLimit
          });
          break;

        case 'update_time_limit':
          this.currentTime = data.timeLimit;
          this.broadcastToPlayers({
            type: 'time_limit_updated',
            timeLimit: data.timeLimit
          });
          break;

        case 'submit_answer':
          this.sendToHost({
            type: 'answer_submitted',
            nickname: data.nickname,
            word: data.word,
            image: data.image
          });
          break;

        case 'answer_result': {
          const player = this.players.get(data.nickname);
          if (player && player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({
              type: 'answer_result',
              word: data.word,
              correct: data.correct,
              recognized: data.recognized
            }));
          }
          break;
        }

        case 'dictation_complete':
          this.broadcastToPlayers({
            type: 'dictation_complete',
            results: data.results
          });
          break;

        case 'start_practice':
          this.isPracticing = true;
          this.broadcastToPlayers({
            type: 'practice_started',
            words: data.words,
            round: data.round,
            totalRounds: data.totalRounds
          });
          break;

        case 'practice_result':
          this.sendToHost({
            type: 'practice_result',
            nickname: data.nickname,
            word: data.word,
            round: data.round,
            correct: data.correct
          });
          break;

        case 'practice_complete':
          this.sendToHost({
            type: 'practice_complete',
            nickname: data.nickname
          });
          break;

        case 'final_score':
          this.broadcastToPlayers({
            type: 'final_score',
            scores: data.scores
          });
          break;
      }
    } catch (e) {
      console.error('Handle message error:', e);
    }
  }

  sendToHost(message) {
    if (this.host && this.host.ws.readyState === WebSocket.OPEN) {
      this.host.ws.send(JSON.stringify(message));
    }
  }

  broadcastToPlayers(message) {
    const msg = JSON.stringify(message);
    console.log('Broadcasting to players. Count:', this.players.size);
    let sent = 0;
    for (const [nickname, player] of this.players) {
      console.log('Player:', nickname, 'ws state:', player.ws.readyState);
      if (player.ws.readyState === WebSocket.OPEN) {
        player.ws.send(msg);
        sent++;
      }
    }
    console.log('Broadcast sent to', sent, 'players');
  }
}
