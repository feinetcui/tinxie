// WebSocket 连接管理
let ws = null;
let roomId = null;

function getWsUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(getWsUrl());

    ws.onopen = () => {
      console.log('WebSocket connected');
      resolve(ws);
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      handleWsMessage(message);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      reject(error);
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      // 可以在这里处理重连逻辑
    };
  });
}

function sendWsMessage(message) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
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
