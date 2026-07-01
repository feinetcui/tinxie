require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const roomManager = require('./room');
const aiService = require('./ai');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;

// 静态文件服务
app.use(express.static(path.join(__dirname, '..', 'public')));

// API 路由
app.use(express.json({ limit: '10mb' }));

// 上传图片进行 OCR 识别
app.post('/api/ocr', async (req, res) => {
  try {
    const { image } = req.body;
    const words = await aiService.recognizeText(image);
    res.json({ success: true, words });
  } catch (error) {
    console.error('OCR error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 手写识别判定
app.post('/api/check-handwriting', async (req, res) => {
  try {
    const { image, correctWord } = req.body;
    const result = await aiService.checkHandwriting(image, correctWord);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Handwriting check error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// WebSocket 连接处理
wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection');

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      handleMessage(ws, message, req);
    } catch (error) {
      console.error('Message parse error:', error);
    }
  });

  ws.on('close', () => {
    roomManager.removePlayer(ws);
  });
});

function handleMessage(ws, message, req) {
  switch (message.type) {
    case 'create_room':
      const roomId = roomManager.createRoom(ws);
      ws.send(JSON.stringify({
        type: 'room_created',
        roomId,
        url: getPublicUrl(req, roomId)
      }));
      break;

    case 'join_room':
      const result = roomManager.joinRoom(message.roomId, ws, message.nickname);
      if (result.success) {
        ws.send(JSON.stringify({
          type: 'room_joined',
          roomId: message.roomId,
          nickname: message.nickname
        }));
        // 通知控制端有新玩家加入
        roomManager.notifyHost(message.roomId, {
          type: 'player_joined',
          nickname: message.nickname,
          playerCount: roomManager.getPlayerCount(message.roomId)
        });
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          message: result.error
        }));
      }
      break;

    case 'start_round':
      const room = roomManager.getRoom(message.roomId);
      if (room) {
        room.players.forEach(player => {
          if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({
              type: 'round_started',
              words: message.words,
              timeLimit: message.timeLimit
            }));
          }
        });
      }
      break;

    case 'update_time_limit':
      const updateRoom = roomManager.getRoom(message.roomId);
      if (updateRoom) {
        updateRoom.players.forEach(player => {
          if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({
              type: 'time_limit_updated',
              timeLimit: message.timeLimit
            }));
          }
        });
      }
      break;

    case 'submit_answer':
      const submitRoom = roomManager.getRoom(message.roomId);
      if (submitRoom) {
        submitRoom.host.ws.send(JSON.stringify({
          type: 'answer_submitted',
          nickname: message.nickname,
          word: message.word,
          image: message.image
        }));
      }
      break;

    case 'answer_result':
      const resultRoom = roomManager.getRoom(message.roomId);
      if (resultRoom) {
        const player = resultRoom.players.find(p => p.nickname === message.nickname);
        if (player && player.ws.readyState === WebSocket.OPEN) {
          player.ws.send(JSON.stringify({
            type: 'answer_result',
            word: message.word,
            correct: message.correct,
            recognized: message.recognized
          }));
        }
      }
      break;

    case 'dictation_complete':
      const completeRoom = roomManager.getRoom(message.roomId);
      if (completeRoom) {
        completeRoom.players.forEach(player => {
          if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({
              type: 'dictation_complete',
              results: message.results
            }));
          }
        });
      }
      break;

    case 'start_practice':
      const practiceRoom = roomManager.getRoom(message.roomId);
      if (practiceRoom) {
        practiceRoom.players.forEach(player => {
          if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({
              type: 'practice_started',
              words: message.words,
              round: message.round,
              totalRounds: message.totalRounds
            }));
          }
        });
      }
      break;

    case 'practice_result':
      const practiceResultRoom = roomManager.getRoom(message.roomId);
      if (practiceResultRoom) {
        practiceResultRoom.host.ws.send(JSON.stringify({
          type: 'practice_result',
          nickname: message.nickname,
          word: message.word,
          round: message.round,
          correct: message.correct
        }));
      }
      break;

    case 'final_score':
      const finalRoom = roomManager.getRoom(message.roomId);
      if (finalRoom) {
        finalRoom.players.forEach(player => {
          if (player.ws.readyState === WebSocket.OPEN) {
            player.ws.send(JSON.stringify({
              type: 'final_score',
              scores: message.scores
            }));
          }
        });
      }
      break;

    case 'practice_complete':
      const pcRoom = roomManager.getRoom(message.roomId);
      if (pcRoom && pcRoom.host.ws.readyState === WebSocket.OPEN) {
        pcRoom.host.ws.send(JSON.stringify({
          type: 'practice_complete',
          nickname: message.nickname
        }));
      }
      break;
  }
}

function getPublicUrl(req, roomId) {
  const protocol = req.headers.host.includes('localhost') ? 'http' : 'https';
  return `${protocol}://${req.headers.host}/player.html?room=${roomId}`;
}

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Control panel: http://localhost:${PORT}/host.html`);
});
