// 选手端逻辑
let nickname = '';
let currentWords = [];
let currentWordIndex = 0;
let canvas = null;
let ctx = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;
let lastMidX = 0;
let lastMidY = 0;

// Canvas DPR 和撤销历史
let dpr = 1;
let canvasHistory = [];
let practiceCanvasHistory = [];
const MAX_HISTORY = 20;

// 正计时
let elapsedSeconds = 0;
let elapsedInterval = null;
let roundStartTime = null;

// 错题练习状态
let practiceWords = [];
let practiceWordIndex = 0;
let practiceRound = 0;
let practiceTotalRounds = 3;

// 语音合成
const speechSynth = window.speechSynthesis;

// 音效系统
const audioEffects = {
  correct: () => playTone(880, 0.2, 'sine'),
  wrong: () => playTone(220, 0.3, 'sawtooth'),
  finish: () => {
    playTone(523, 0.15, 'sine');
    setTimeout(() => playTone(659, 0.15, 'sine'), 150);
    setTimeout(() => playTone(784, 0.3, 'sine'), 300);
  }
};

function playTone(frequency, duration, type = 'sine') {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = type;
    gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + duration);
  } catch (e) {
    console.log('Audio not supported');
  }
}

// 触觉反馈
function vibrate(pattern) {
  if (navigator.vibrate) {
    navigator.vibrate(pattern);
  }
}

// 语音播报
function speakWord(word) {
  if (!speechSynth) return;
  speechSynth.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'zh-CN';
  utterance.rate = 0.8;
  utterance.pitch = 1.1;
  speechSynth.speak(utterance);
}

// ============ 正计时 ============
function startElapsedTime() {
  elapsedSeconds = 0;
  roundStartTime = Date.now();
  const timerEl = document.getElementById('timer');
  timerEl.textContent = '0s';

  clearInterval(elapsedInterval);
  elapsedInterval = setInterval(() => {
    elapsedSeconds++;
    timerEl.textContent = elapsedSeconds + 's';
  }, 1000);
}

function stopElapsedTime() {
  clearInterval(elapsedInterval);
}

// 练习模式正计时
let practiceElapsedSeconds = 0;
let practiceElapsedInterval = null;
let practiceRoundStartTime = null;

function startPracticeElapsedTime() {
  practiceElapsedSeconds = 0;
  practiceRoundStartTime = Date.now();
  const timerEl = document.getElementById('practiceTimer');
  timerEl.textContent = '0s';

  clearInterval(practiceElapsedInterval);
  practiceElapsedInterval = setInterval(() => {
    practiceElapsedSeconds++;
    timerEl.textContent = practiceElapsedSeconds + 's';
  }, 1000);
}

function stopPracticeElapsedTime() {
  clearInterval(practiceElapsedInterval);
}

// 初始化
async function init() {
  initCanvas();

  const roomInput = document.getElementById('roomInput');
  const nicknameInput = document.getElementById('nicknameInput');
  const joinBtn = document.getElementById('joinBtn');

  function checkInputs() {
    const roomOk = roomInput.value.trim().length === 4;
    const nickOk = nicknameInput.value.trim().length > 0;
    joinBtn.disabled = !(roomOk && nickOk);
  }

  roomInput.addEventListener('input', checkInputs);
  nicknameInput.addEventListener('input', checkInputs);

  joinBtn.addEventListener('click', async () => {
    roomId = roomInput.value.trim();
    nickname = nicknameInput.value.trim();
    if (roomId && nickname) {
      await joinRoom();
    }
  });

  nicknameInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter' && !joinBtn.disabled) {
      roomId = roomInput.value.trim();
      nickname = nicknameInput.value.trim();
      await joinRoom();
    }
  });
}

async function joinRoom() {
  try {
    await connectWebSocket(roomId, nickname);
    sendWsMessage({
      type: 'join_room',
      roomId,
      nickname
    });
  } catch (error) {
    console.error('Failed to connect:', error);
    alert('连接失败，请重试');
  }
}

// 监听消息
onMessage('room_joined', (message) => {
  hideElement('joinSection');
  showElement('waitingSection');
});

onMessage('error', (message) => {
  alert(message.message);
});

onMessage('round_started', (message) => {
  console.log('Round started! Words:', message.words);
  currentWords = message.words;
  currentWordIndex = 0;

  hideElement('waitingSection');
  showElement('writingSection');

  showCurrentWord();
  startElapsedTime();
});

onMessage('answer_result', (message) => {
  vibrate(message.correct ? [50] : [100, 50, 100]);
  stopElapsedTime();

  showElement('resultFeedback');

  const resultIcon = document.getElementById('resultIcon');
  const resultText = document.getElementById('resultText');
  const correctAnswer = document.getElementById('correctAnswer');

  if (message.correct) {
    resultIcon.textContent = '✓';
    resultIcon.className = 'result-icon correct';
    resultText.textContent = '太棒了！正确！';
    correctAnswer.textContent = '';
    audioEffects.correct();
  } else {
    resultIcon.textContent = '✗';
    resultIcon.className = 'result-icon incorrect';
    resultText.textContent = '没关系，再加油！';
    correctAnswer.textContent = `正确答案：${message.word}`;
    audioEffects.wrong();
  }

  setTimeout(() => {
    hideElement('resultFeedback');
    currentWordIndex++;

    if (currentWordIndex < currentWords.length) {
      showCurrentWord();
      startElapsedTime();
    } else {
      audioEffects.finish();
    }
  }, 2000);
});

onMessage('dictation_complete', (message) => {
  // 不再显示简单成绩单，等待 leaderboard 消息
});

onMessage('leaderboard', (message) => {
  hideElement('writingSection');
  showLeaderboard(message.rankings);
});

onMessage('practice_started', (message) => {
  hideElement('leaderboardOverlay');
  showElement('practiceSection');

  practiceWords = message.words;
  practiceWordIndex = 0;
  practiceRound = 1;
  practiceTotalRounds = message.totalRounds || 3;

  showPracticeWord();
  startPracticeElapsedTime();
});

onMessage('final_score', (message) => {
  // 不再使用，由 leaderboard 替代
});

function showCurrentWord() {
  const word = currentWords[currentWordIndex];
  document.getElementById('pinyinDisplay').textContent = toPinyin(word);
  document.getElementById('wordProgress').textContent =
    `${currentWordIndex + 1}/${currentWords.length}`;

  canvasHistory = [];
  clearCanvas(canvas, ctx);

  setTimeout(() => speakWord(word), 500);
}

function showPracticeWord() {
  const word = practiceWords[practiceWordIndex];
  document.getElementById('practicePinyin').textContent = toPinyin(word);
  document.getElementById('practiceWord').textContent = word;
  document.getElementById('practiceProgress').textContent =
    `第${practiceRound}次 / 共${practiceTotalRounds}次`;

  practiceCanvasHistory = [];
  const pc = document.getElementById('practiceCanvas');
  clearCanvas(pc, pc.getContext('2d'));

  setTimeout(() => speakWord(word), 500);
}

function submitAnswer() {
  vibrate(50);
  stopElapsedTime();

  const word = currentWords[currentWordIndex];
  const imageData = canvas.toDataURL('image/png').split(',')[1];

  sendWsMessage({
    type: 'submit_answer',
    roomId,
    nickname,
    word,
    image: imageData,
    submittedAt: Date.now()
  });
}

function submitPracticeAnswer() {
  vibrate(50);
  stopPracticeElapsedTime();

  const word = practiceWords[practiceWordIndex];
  const practiceCanvas = document.getElementById('practiceCanvas');
  const imageData = practiceCanvas.toDataURL('image/png').split(',')[1];

  fetch('/api/check-handwriting', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: imageData, correctWord: word })
  })
  .then(res => res.json())
  .then(result => {
    sendWsMessage({
      type: 'practice_result',
      roomId,
      nickname,
      word,
      round: practiceRound,
      correct: result.correct
    });

    vibrate(result.correct ? [50] : [100, 50, 100]);
    showElement('resultFeedback');
    const resultIcon = document.getElementById('resultIcon');
    const resultText = document.getElementById('resultText');
    const correctAnswer = document.getElementById('correctAnswer');

    if (result.correct) {
      resultIcon.textContent = '✓';
      resultIcon.className = 'result-icon correct';
      resultText.textContent = '正确！';
      correctAnswer.textContent = '';
    } else {
      resultIcon.textContent = '✗';
      resultIcon.className = 'result-icon incorrect';
      resultText.textContent = '错误';
      correctAnswer.textContent = `正确答案：${word}`;
    }

    setTimeout(() => {
      hideElement('resultFeedback');
      advancePractice();
    }, 1500);
  });
}

function advancePractice() {
  practiceRound++;

  if (practiceRound > practiceTotalRounds) {
    practiceRound = 1;
    practiceWordIndex++;

    if (practiceWordIndex >= practiceWords.length) {
      hideElement('practiceSection');
      sendWsMessage({
        type: 'practice_complete',
        roomId,
        nickname
      });
      return;
    }
  }

  showPracticeWord();
  startPracticeElapsedTime();
}

// ============ 排名显示 ============
function showLeaderboard(rankings) {
  const list = document.getElementById('leaderboardList');
  const selfEl = document.getElementById('leaderboardSelf');
  list.innerHTML = '';

  const medals = ['🥇', '🥈', '🥉'];

  rankings.forEach(r => {
    const item = document.createElement('div');
    item.className = 'leaderboard-item';
    if (r.nickname === nickname) item.classList.add('self');
    if (r.rank === 1) item.classList.add('rank-1');

    const rankDisplay = r.rank <= 3 ? medals[r.rank - 1] : r.rank;

    item.innerHTML = `
      <div class="leaderboard-rank">${rankDisplay}</div>
      <div class="leaderboard-name">${r.nickname}</div>
      <div class="leaderboard-stats">
        <span class="correct">${r.correct}✓</span>
        <span class="incorrect">${r.incorrect}✗</span>
        <span class="time">${r.totalTime}s</span>
      </div>
    `;
    list.appendChild(item);
  });

  // 显示当前用户个人成绩
  const myResult = rankings.find(r => r.nickname === nickname);
  if (myResult) {
    selfEl.textContent = `你的成绩：${myResult.correct}✓ ${myResult.incorrect}✗  ${myResult.totalTime}s`;
    selfEl.style.display = '';
  } else {
    selfEl.style.display = 'none';
  }

  showElement('leaderboardOverlay');
}

// ============ 画布初始化 ============
function initCanvas() {
  canvas = document.getElementById('writingCanvas');
  ctx = canvas.getContext('2d');
  dpr = window.devicePixelRatio || 1;

  function resizeCanvas() {
    const container = canvas.parentElement;
    const displayWidth = container.clientWidth - 16;
    const maxHeight = Math.min(350, window.innerHeight * 0.45);

    canvas.style.width = displayWidth + 'px';
    canvas.style.height = maxHeight + 'px';
    canvas.width = displayWidth * dpr;
    canvas.height = maxHeight * dpr;

    ctx.scale(dpr, dpr);
    redrawCanvas(ctx, canvasHistory, displayWidth, maxHeight);
  }

  resizeCanvas();
  window.addEventListener('resize', () => {
    const container = canvas.parentElement;
    const displayWidth = container.clientWidth - 16;
    const maxHeight = Math.min(350, window.innerHeight * 0.45);

    if (canvasHistory.length > 0) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      canvasHistory.push(imageData);
    }

    canvas.style.width = displayWidth + 'px';
    canvas.style.height = maxHeight + 'px';
    canvas.width = displayWidth * dpr;
    canvas.height = maxHeight * dpr;

    ctx.scale(dpr, dpr);
    redrawCanvas(ctx, canvasHistory, displayWidth, maxHeight);
  });

  drawTianzige(ctx, parseFloat(canvas.style.width), parseFloat(canvas.style.height));

  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', stopDrawing);

  canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
  canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
  canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', handleTouchEnd, { passive: false });
}

// ============ 触摸处理 ============
function getCanvasCoords(touch) {
  const rect = canvas.getBoundingClientRect();
  return [touch.clientX - rect.left, touch.clientY - rect.top];
}

function handleTouchStart(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const [x, y] = getCanvasCoords(touch);
  isDrawing = true;
  lastX = x;
  lastY = y;
  lastMidX = x;
  lastMidY = y;
  saveCanvasState(canvasHistory);
}

function handleTouchMove(e) {
  e.preventDefault();
  if (!isDrawing) return;

  const touch = e.touches[0];
  const [x, y] = getCanvasCoords(touch);
  const midX = (lastX + x) / 2;
  const midY = (lastY + y) / 2;

  ctx.beginPath();
  ctx.moveTo(lastMidX, lastMidY);
  ctx.quadraticCurveTo(lastX, lastY, midX, midY);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  lastX = x;
  lastY = y;
  lastMidX = midX;
  lastMidY = midY;
}

function handleTouchEnd(e) {
  e.preventDefault();
  isDrawing = false;
  lastMidX = lastX;
  lastMidY = lastY;
}

// ============ 鼠标处理 ============
function startDrawing(e) {
  isDrawing = true;
  const [x, y] = getMouseCoords(e);
  lastX = x;
  lastY = y;
  lastMidX = x;
  lastMidY = y;
  saveCanvasState(canvasHistory);
}

function draw(e) {
  if (!isDrawing) return;

  const [x, y] = getMouseCoords(e);
  const midX = (lastX + x) / 2;
  const midY = (lastY + y) / 2;

  ctx.beginPath();
  ctx.moveTo(lastMidX, lastMidY);
  ctx.quadraticCurveTo(lastX, lastY, midX, midY);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();

  lastX = x;
  lastY = y;
  lastMidX = midX;
  lastMidY = midY;
}

function stopDrawing() {
  isDrawing = false;
}

function getMouseCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}

// ============ 撤销功能 ============
function saveCanvasState(history) {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  history.push(imageData);
  if (history.length > MAX_HISTORY) {
    history.shift();
  }
}

function undo(history) {
  if (history.length === 0) return;
  const imageData = history.pop();
  ctx.putImageData(imageData, 0, 0);
}

// ============ 画布绘制 ============
function drawTianzige(ctx, width, height) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  const gridSize = Math.min(width / 3, height / 3);
  const startX = (width - gridSize * 3) / 2;
  const startY = (height - gridSize * 3) / 2;

  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 1.5;

  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const x = startX + i * gridSize;
      const y = startY + j * gridSize;

      ctx.strokeRect(x, y, gridSize, gridSize);

      ctx.beginPath();
      ctx.setLineDash([4, 4]);

      ctx.moveTo(x, y + gridSize / 2);
      ctx.lineTo(x + gridSize, y + gridSize / 2);

      ctx.moveTo(x + gridSize / 2, y);
      ctx.lineTo(x + gridSize / 2, y + gridSize);

      ctx.strokeStyle = '#ffcccc';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1.5;
    }
  }
}

function redrawCanvas(ctx, history, width, height) {
  if (history.length > 0) {
    const imageData = history[history.length - 1];
    ctx.putImageData(imageData, 0, 0);
  } else {
    drawTianzige(ctx, width, height);
  }
}

function clearCanvas(targetCanvas, targetCtx) {
  const w = parseFloat(targetCanvas.style.width);
  const h = parseFloat(targetCanvas.style.height);
  targetCtx.setTransform(1, 0, 0, 1, 0, 0);
  targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  targetCtx.scale(dpr, dpr);
  drawTianzige(targetCtx, w, h);
}

// 清除按钮
document.getElementById('clearBtn').addEventListener('click', () => {
  vibrate(20);
  canvasHistory = [];
  clearCanvas(canvas, ctx);
});

document.getElementById('practiceClearBtn').addEventListener('click', () => {
  vibrate(20);
  practiceCanvasHistory = [];
  const pc = document.getElementById('practiceCanvas');
  clearCanvas(pc, pc.getContext('2d'));
});

// 撤销按钮
document.getElementById('undoBtn').addEventListener('click', () => {
  vibrate(15);
  undo(canvasHistory);
});

document.getElementById('practiceUndoBtn').addEventListener('click', () => {
  vibrate(15);
  const pc = document.getElementById('practiceCanvas');
  const pcCtx = pc.getContext('2d');
  if (practiceCanvasHistory.length === 0) return;
  const imageData = practiceCanvasHistory.pop();
  pcCtx.putImageData(imageData, 0, 0);
});

// 提交按钮
document.getElementById('submitBtn').addEventListener('click', submitAnswer);
document.getElementById('practiceSubmitBtn').addEventListener('click', submitPracticeAnswer);

// 拼音转换
function toPinyin(word) {
  if (window.pinyinPro) {
    return window.pinyinPro.pinyin(word, { type: 'array' }).join(' ');
  }
  const pinyinMap = {
    '春': 'chūn', '天': 'tiān', '花': 'huā', '朵': 'duǒ',
    '蝴': 'hú', '蝶': 'dié', '燕': 'yàn', '子': 'zi',
    '柳': 'liǔ', '树': 'shù', '溪': 'xī', '流': 'liú',
    '草': 'cǎo', '地': 'dì', '阳': 'yáng', '光': 'guāng',
    '栽': 'zāi'
  };
  return word.split('').map(char => pinyinMap[char] || char).join(' ');
}

document.addEventListener('DOMContentLoaded', init);
