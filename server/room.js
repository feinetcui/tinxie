const rooms = new Map();

function generateRoomId() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

function createRoom(hostWs) {
  let roomId = generateRoomId();
  while (rooms.has(roomId)) {
    roomId = generateRoomId();
  }

  rooms.set(roomId, {
    host: { ws: hostWs },
    players: [],
    createdAt: Date.now()
  });

  return roomId;
}

function joinRoom(roomId, playerWs, nickname) {
  const room = rooms.get(roomId);
  if (!room) {
    return { success: false, error: '房间不存在' };
  }

  // 检查昵称是否重复
  const existingPlayer = room.players.find(p => p.nickname === nickname);
  if (existingPlayer) {
    return { success: false, error: '昵称已被使用' };
  }

  room.players.push({
    ws: playerWs,
    nickname: nickname,
    joinedAt: Date.now()
  });

  return { success: true };
}

function getRoom(roomId) {
  return rooms.get(roomId);
}

function removePlayer(playerWs) {
  for (const [roomId, room] of rooms.entries()) {
    const playerIndex = room.players.findIndex(p => p.ws === playerWs);
    if (playerIndex !== -1) {
      room.players.splice(playerIndex, 1);
      
      // 通知控制端玩家离开
      if (room.host.ws.readyState === 1) {
        room.host.ws.send(JSON.stringify({
          type: 'player_left',
          playerCount: room.players.length
        }));
      }

      // 如果没有玩家了，可以选择删除房间
      if (room.players.length === 0) {
        // 延迟删除，防止误操作
        setTimeout(() => {
          const currentRoom = rooms.get(roomId);
          if (currentRoom && currentRoom.players.length === 0) {
            rooms.delete(roomId);
            console.log(`Room ${roomId} deleted`);
          }
        }, 300000); // 5分钟后删除空房间
      }
      break;
    }
  }
}

function getPlayerCount(roomId) {
  const room = rooms.get(roomId);
  return room ? room.players.length : 0;
}

function notifyHost(roomId, message) {
  const room = rooms.get(roomId);
  if (room && room.host.ws.readyState === 1) {
    room.host.ws.send(JSON.stringify(message));
  }
}

module.exports = {
  createRoom,
  joinRoom,
  getRoom,
  removePlayer,
  getPlayerCount,
  notifyHost
};
