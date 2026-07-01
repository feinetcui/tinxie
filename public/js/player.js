// 选手端逻辑
let nickname = '';
let currentWords = [];
let currentWordIndex = 0;
let timeLimit = 10;
let timerInterval = null;
let canvas = null;
let ctx = null;
let isDrawing = false;
let lastX = 0;
let lastY = 0;

// 初始化
async function init() {
  // 检查 URL 参数
  roomId = getUrlParam('room');
  
  if (roomId) {
    // 从二维码跳转过来的，隐藏昵称输入
    showElement('waitingSection');
    hideElement('joinSection');
    
    // 显示昵称输入对话框
    showNicknameDialog();
  }

  // 初始化画布
  initCanvas();
}

function showNicknameDialog() {
  const dialog = document.createElement('div');
  dialog.className = 'nickname-dialog';
  dialog.innerHTML = `
    <div class="dialog-content">
      <h3>输入昵称</h3>
      <input type="text" id="dialogNickname" placeholder="请输入你的昵称" maxlength="10">
      <button class="btn btn-primary" id="dialogConfirmBtn">确认</button>
    </div>
  `;
  document.body.appendChild(dialog);
  
  document.getElementById('dialogConfirmBtn').addEventListener('click', async () => {
    const input = document.getElementById('dialogNickname');
    if (input.value.trim()) {
      nickname = input.value.trim();
      dialog.remove();
      await joinRoom();
    }
  });
  
  document.getElementById('dialogNickname').addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      const input = document.getElementById('dialogNickname');
      if (input.value.trim()) {
        nickname = input.value.trim();
        dialog.remove();
        await joinRoom();
      }
    }
  });
}

async function joinRoom() {
  try {
    await connectWebSocket();
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
  showElement('waitingSection');
  hideElement('joinSection');
});

onMessage('error', (message) => {
  alert(message.message);
});

onMessage('round_started', (message) => {
  currentWords = message.words;
  currentWordIndex = 0;
  timeLimit = message.timeLimit;
  
  hideElement('waitingSection');
  showElement('writingSection');
  
  showCurrentWord();
  startTimer();
});

onMessage('time_limit_updated', (message) => {
  timeLimit = message.timeLimit;
});

onMessage('answer_result', (message) => {
  clearInterval(timerInterval);
  
  showElement('resultFeedback');
  
  const resultIcon = document.getElementById('resultIcon');
  const resultText = document.getElementById('resultText');
  const correctAnswer = document.getElementById('correctAnswer');
  
  if (message.correct) {
    resultIcon.textContent = '✓';
    resultIcon.className = 'result-icon correct';
    resultText.textContent = '正确！';
    correctAnswer.textContent = '';
  } else {
    resultIcon.textContent = '✗';
    resultIcon.className = 'result-icon incorrect';
    resultText.textContent = '错误';
    correctAnswer.textContent = `正确答案：${message.word}`;
  }
  
  setTimeout(() => {
    hideElement('resultFeedback');
    currentWordIndex++;
    
    if (currentWordIndex < currentWords.length) {
      showCurrentWord();
      startTimer();
    } else {
      // 听写完成，等待成绩单
    }
  }, 2000);
});

onMessage('dictation_complete', (message) => {
  hideElement('writingSection');
  showElement('scoreSection');
  
  const scoreList = document.getElementById('scoreList');
  scoreList.innerHTML = '';
  
  let correctCount = 0;
  message.results.forEach(result => {
    const wordEl = document.createElement('span');
    wordEl.className = `score-word ${result.correct ? 'correct' : 'incorrect'}`;
    wordEl.textContent = `${result.correct ? '✓' : '✗'} ${result.word}`;
    scoreList.appendChild(wordEl);
    
    if (result.correct) correctCount++;
  });
  
  document.getElementById('scoreSummary').textContent = 
    `正确: ${correctCount}/${message.results.length}`;
});

onMessage('practice_started', (message) => {
  hideElement('scoreSection');
  showElement('practiceSection');
  
  currentWords = message.words;
  currentWordIndex = 0;
  
  showPracticeWord();
  startPracticeTimer();
});

onMessage('final_score', (message) => {
  hideElement('practiceSection');
  showElement('finalScoreSection');
  
  const myScore = message.scores.find(s => s.nickname === nickname);
  if (myScore) {
    const accuracy = Math.round((myScore.correct / myScore.total) * 100);
    document.getElementById('finalScoreNumber').textContent = `${accuracy}%`;
    document.getElementById('finalStats').innerHTML = `
      <div class="final-stat">
        <div class="final-stat-number">${myScore.correct}</div>
        <div class="final-stat-label">正确</div>
      </div>
      <div class="final-stat">
        <div class="final-stat-number">${myScore.total - myScore.correct}</div>
        <div class="final-stat-label">错误</div>
      </div>
      <div class="final-stat">
        <div class="final-stat-number">${myScore.practiceCorrect || 0}</div>
        <div class="final-stat-label">练习正确</div>
      </div>
    `;
  }
});

function showCurrentWord() {
  const word = currentWords[currentWordIndex];
  document.getElementById('pinyinDisplay').textContent = toPinyin(word);
  document.getElementById('wordProgress').textContent = 
    `${currentWordIndex + 1}/${currentWords.length}`;
  
  clearCanvas(canvas, ctx);
}

function showPracticeWord() {
  const word = currentWords[currentWordIndex];
  document.getElementById('practicePinyin').textContent = toPinyin(word);
  document.getElementById('practiceWord').textContent = word;
  document.getElementById('practiceProgress').textContent = 
    `${currentWordIndex + 1}/${currentWords.length}`;
  
  clearCanvas(document.getElementById('practiceCanvas'), 
              document.getElementById('practiceCanvas').getContext('2d'));
}

function startTimer() {
  let timeLeft = timeLimit;
  const timerEl = document.getElementById('timer');
  timerEl.textContent = timeLeft;
  timerEl.classList.remove('warning');
  
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft--;
    timerEl.textContent = timeLeft;
    
    if (timeLeft <= 3) {
      timerEl.classList.add('warning');
    }
    
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      autoSubmit();
    }
  }, 1000);
}

function startPracticeTimer() {
  let timeLeft = timeLimit;
  const timerEl = document.getElementById('practiceTimer');
  timerEl.textContent = timeLeft;
  timerEl.classList.remove('warning');
  
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timeLeft--;
    timerEl.textContent = timeLeft;
    
    if (timeLeft <= 3) {
      timerEl.classList.add('warning');
    }
    
    if (timeLeft <= 0) {
      clearInterval(timerInterval);
      autoSubmitPractice();
    }
  }, 1000);
}

function autoSubmit() {
  submitAnswer();
}

function autoSubmitPractice() {
  submitPracticeAnswer();
}

function submitAnswer() {
  clearInterval(timerInterval);
  
  const word = currentWords[currentWordIndex];
  const imageData = canvas.toDataURL('image/png').split(',')[1];
  
  sendWsMessage({
    type: 'submit_answer',
    roomId,
    nickname,
    word,
    image: imageData
  });
}

function submitPracticeAnswer() {
  clearInterval(timerInterval);
  
  const word = currentWords[currentWordIndex];
  const practiceCanvas = document.getElementById('practiceCanvas');
  const imageData = practiceCanvas.toDataURL('image/png').split(',')[1];
  
  // 检查手写
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
      round: currentWordIndex + 1,
      correct: result.correct
    });
    
    currentWordIndex++;
    if (currentWordIndex < currentWords.length) {
      showPracticeWord();
      startPracticeTimer();
    } else {
      // 练习完成
    }
  });
}

// 画布初始化
function initCanvas() {
  canvas = document.getElementById('writingCanvas');
  ctx = canvas.getContext('2d');
  
  // 设置画布大小
  function resizeCanvas() {
    const container = canvas.parentElement;
    canvas.width = container.clientWidth - 20;
    canvas.height = Math.min(300, window.innerHeight * 0.4);
    drawTianzige(ctx, canvas.width, canvas.height);
  }
  
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  // 绘制田字格
  drawTianzige(ctx, canvas.width, canvas.height);
  
  // 绑定事件
  canvas.addEventListener('mousedown', startDrawing);
  canvas.addEventListener('mousemove', draw);
  canvas.addEventListener('mouseup', stopDrawing);
  canvas.addEventListener('mouseout', stopDrawing);
  
  canvas.addEventListener('touchstart', handleTouch);
  canvas.addEventListener('touchmove', handleTouch);
  canvas.addEventListener('touchend', stopDrawing);
}

function drawTianzige(ctx, width, height) {
  ctx.clearRect(0, 0, width, height);
  
  // 背景
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  
  // 计算格子大小
  const gridSize = Math.min(width / 3, height / 3);
  const startX = (width - gridSize * 3) / 2;
  const startY = (height - gridSize * 3) / 2;
  
  // 绘制格子边框
  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 2;
  
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const x = startX + i * gridSize;
      const y = startY + j * gridSize;
      
      // 外框
      ctx.strokeRect(x, y, gridSize, gridSize);
      
      // 十字虚线
      ctx.beginPath();
      ctx.setLineDash([5, 5]);
      
      // 横线
      ctx.moveTo(x, y + gridSize / 2);
      ctx.lineTo(x + gridSize, y + gridSize / 2);
      
      // 竖线
      ctx.moveTo(x + gridSize / 2, y);
      ctx.lineTo(x + gridSize / 2, y + gridSize);
      
      ctx.strokeStyle = '#ffcccc';
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function startDrawing(e) {
  isDrawing = true;
  [lastX, lastY] = getCoords(e);
}

function draw(e) {
  if (!isDrawing) return;
  
  const [x, y] = getCoords(e);
  
  ctx.beginPath();
  ctx.moveTo(lastX, lastY);
  ctx.lineTo(x, y);
  ctx.strokeStyle = '#333';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  
  [lastX, lastY] = [x, y];
}

function stopDrawing() {
  isDrawing = false;
}

function handleTouch(e) {
  e.preventDefault();
  const touch = e.touches[0];
  const mouseEvent = new MouseEvent(
    e.type === 'touchstart' ? 'mousedown' : 'mousemove',
    {
      clientX: touch.clientX,
      clientY: touch.clientY
    }
  );
  canvas.dispatchEvent(mouseEvent);
}

function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    e.clientX - rect.left,
    e.clientY - rect.top
  ];
}

function clearCanvas(canvas, ctx) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawTianzige(ctx, canvas.width, canvas.height);
}

// 清除按钮
document.getElementById('clearBtn').addEventListener('click', () => {
  clearCanvas(canvas, ctx);
});

document.getElementById('practiceClearBtn').addEventListener('click', () => {
  const practiceCanvas = document.getElementById('practiceCanvas');
  clearCanvas(practiceCanvas, practiceCanvas.getContext('2d'));
});

// 提交按钮
document.getElementById('submitBtn').addEventListener('click', submitAnswer);
document.getElementById('practiceSubmitBtn').addEventListener('click', submitPracticeAnswer);

// 拼音转换
function toPinyin(word) {
  const pinyinMap = {
    '春': 'chūn', '天': 'tiān', '花': 'huā', '朵': 'duǒ',
    '蝴': 'hú', '蝶': 'dié', '燕': 'yàn', '子': 'zi',
    '柳': 'liǔ', '树': 'shù', '溪': 'xī', '流': 'liú',
    '草': 'cǎo', '地': 'dì', '阳': 'yáng', '光': 'guāng',
    '栽': 'zāi'
  };
  return word.split('').map(char => pinyinMap[char] || char).join(' ');
}

// 添加样式
const style = document.createElement('style');
style.textContent = `
  .nickname-dialog {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }
  .dialog-content {
    background: white;
    padding: 30px;
    border-radius: 12px;
    text-align: center;
    width: 90%;
    max-width: 300px;
  }
  .dialog-content h3 {
    margin-bottom: 20px;
    color: #333;
  }
  .dialog-content input {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 8px;
    font-size: 1rem;
    margin-bottom: 15px;
  }
  .dialog-content .btn {
    width: 100%;
  }
`;
document.head.appendChild(style);

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
