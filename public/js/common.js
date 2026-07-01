// WebSocket 连接管理
let ws = null;
let roomId = null;

function getWsUrl(room, nickname) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const base = `${protocol}//${window.location.host}`;
  const params = new URLSearchParams();
  if (room) params.set('room', room);
  if (nickname) params.set('nickname', nickname);
  return `${base}/ws?${params.toString()}`;
}

function connectWebSocket(room, nickname) {
  return new Promise((resolve, reject) => {
    const url = getWsUrl(room, nickname);
    console.log('Connecting to WebSocket:', url);
    ws = new WebSocket(url);

    ws.onopen = () => {
      console.log('WebSocket connected successfully');
      resolve(ws);
    };

    ws.onmessage = (event) => {
      console.log('WebSocket message received:', event.data);
      const message = JSON.parse(event.data);
      handleWsMessage(message);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    };

    ws.onclose = (event) => {
      console.log('WebSocket closed, code:', event.code, 'reason:', event.reason);
    };
  });
}

function sendWsMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    console.log('Sending WebSocket message:', message.type);
    ws.send(JSON.stringify(message));
  } else {
    console.error('WebSocket not open, readyState:', ws ? ws.readyState : 'null');
  }
}

// 消息处理回调
const messageHandlers = {};

function onMessage(type, handler) {
  if (!messageHandlers[type]) {
    messageHandlers[type] = [];
  }
  messageHandlers[type].push(handler);
}

function handleWsMessage(message) {
  const handlers = messageHandlers[message.type];
  if (handlers) {
    handlers.forEach(handler => handler(message));
  }
}

// 从 URL 获取参数
function getUrlParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

// 显示/隐藏元素
function showElement(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.style.display = 'block';
  }
}

function hideElement(elementId) {
  const element = document.getElementById(elementId);
  if (element) {
    element.style.display = 'none';
  }
}

// 格式化时间
function formatTime(seconds) {
  return `${seconds}s`;
}

// 延迟
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
