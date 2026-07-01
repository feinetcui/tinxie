// 控制端逻辑
let selectedWords = [];
let currentTime = 15; // 默认15秒，更适合小学生
let isPlaying = false;
let currentWordIndex = 0;
let playerResults = {}; // { nickname: { word: correct } }
let playerNames = [];
let allResults = []; // [{ word, correct }]

// 初始化
async function init() {
  try {
    // 控制端连接时不传 room 和 nickname
    await connectWebSocket();
    sendWsMessage({ type: 'create_room' });
  } catch (error) {
    console.error('Failed to connect:', error);
    alert('连接失败，请刷新页面重试');
  }
}

// 监听消息
onMessage('room_created', (message) => {
  roomId = message.roomId;
  document.getElementById('roomNumberDisplay').textContent = roomId;
});

onMessage('player_joined', (message) => {
  document.getElementById('playerCount').textContent = `${message.playerCount} 人在线`;
  playerNames.push(message.nickname);
  updatePlayerStatusList();
});

onMessage('player_left', (message) => {
  document.getElementById('playerCount').textContent = `${message.playerCount} 人在线`;
});

onMessage('answer_submitted', async (message) => {
  // 调用 AI 检查手写
  try {
    const response = await fetch('/api/check-handwriting', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: message.image,
        correctWord: message.word
      })
    });
    const result = await response.json();

    // 发送结果给选手
    sendWsMessage({
      type: 'answer_result',
      roomId,
      nickname: message.nickname,
      word: message.word,
      correct: result.correct,
      recognized: result.recognized
    });

    // 记录结果
    if (!playerResults[message.nickname]) {
      playerResults[message.nickname] = {};
    }
    playerResults[message.nickname][message.word] = result.correct;

    // 更新控制端状态
    updatePlayerStatus(message.nickname, 'submitted');

    // 检查是否所有玩家都已提交
    checkAllSubmitted();
  } catch (error) {
    console.error('Check handwriting error:', error);
  }
});

onMessage('practice_result', (message) => {
  updatePlayerStatus(message.nickname, 'practiced');
});

onMessage('practice_complete', (message) => {
  updatePlayerStatus(message.nickname, 'done');
});

// 拍照功能
document.getElementById('takePhotoBtn').addEventListener('click', () => {
  document.getElementById('photoInput').click();
});

document.getElementById('photoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    await processImage(file);
  }
});

// 手动输入功能
document.getElementById('manualInputBtn').addEventListener('click', () => {
  showElement('manualInput');
  hideElement('ocrPreview');
  hideElement('wordSelection');
});

document.getElementById('confirmManualBtn').addEventListener('click', () => {
  const text = document.getElementById('manualWords').value;
  const words = text.split('\n').filter(w => w.trim().length > 0);
  if (words.length > 0) {
    addWords(words);
  }
  hideElement('manualInput');
});

// 文件上传功能
document.getElementById('fileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) {
    await processImage(file);
  }
});

async function processImage(file) {
  showElement('ocrPreview');
  showElement('ocrLoading');

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    document.getElementById('previewImage').src = e.target.result;

    try {
      const response = await fetch('/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 })
      });
      const result = await response.json();

      hideElement('ocrLoading');

      if (result.success && result.words.length > 0) {
        showWordSelection(result.words);
      } else {
        alert('未能识别出词语，请尝试手动输入');
      }
    } catch (error) {
      hideElement('ocrLoading');
      console.error('OCR error:', error);
      alert('识别失败，请重试');
    }
  };
  reader.readAsDataURL(file);
}

function showWordSelection(words) {
  const wordList = document.getElementById('wordList');
  wordList.innerHTML = '';

  words.forEach(word => {
    const item = document.createElement('label');
    item.className = 'checkbox-item';
    item.innerHTML = `
      <input type="checkbox" value="${word}">
      <span>${word}</span>
    `;

    item.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) {
        item.classList.add('checked');
        addWord(word);
      } else {
        item.classList.remove('checked');
        removeWord(word);
      }
    });

    wordList.appendChild(item);
  });

  showElement('wordSelection');
}

function addWords(words) {
  words.forEach(word => {
    if (!selectedWords.includes(word)) {
      selectedWords.push(word);
    }
  });
  updateSelectedWords();
}

function addWord(word) {
  if (!selectedWords.includes(word)) {
    selectedWords.push(word);
    updateSelectedWords();
  }
}

function removeWord(word) {
  selectedWords = selectedWords.filter(w => w !== word);
  updateSelectedWords();
}

function updateSelectedWords() {
  const container = document.getElementById('selectedWords');
  container.innerHTML = '';

  selectedWords.forEach(word => {
    const tag = document.createElement('span');
    tag.className = 'selected-word';
    tag.textContent = word;
    tag.addEventListener('click', () => removeWord(word));
    container.appendChild(tag);
  });

  // 更新开始按钮状态
  document.getElementById('startBtn').disabled = selectedWords.length === 0;

  // 显示/隐藏已选词语区域
  if (selectedWords.length > 0) {
    showElement('selectedWordsSection');
  } else {
    hideElement('selectedWordsSection');
  }
}

// 计时设置
document.querySelectorAll('.timer-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTime = parseInt(btn.dataset.time);
    document.getElementById('currentTime').textContent = currentTime;
  });
});

document.getElementById('customTime').addEventListener('change', (e) => {
  const value = parseInt(e.target.value);
  if (value >= 3 && value <= 60) {
    document.querySelectorAll('.timer-btn').forEach(b => b.classList.remove('active'));
    currentTime = value;
    document.getElementById('currentTime').textContent = currentTime;
  }
});

// 开始听写
document.getElementById('startBtn').addEventListener('click', () => {
  if (selectedWords.length === 0) return;

  console.log('Starting dictation. Words:', selectedWords, 'Time:', currentTime);
  console.log('Players:', playerNames);

  isPlaying = true;
  currentWordIndex = 0;
  playerResults = {};
  allResults = [];

  sendWsMessage({
    type: 'start_round',
    roomId,
    words: selectedWords,
    timeLimit: currentTime
  });

  // 显示状态区域
  showElement('statusSection');
  hideElement('ocrSection');
  hideElement('timerSection');
  hideElement('selectedWordsSection');
  document.getElementById('startBtn').disabled = true;

  updatePlayStatus(0);
});

function updatePlayStatus(index) {
  if (index < selectedWords.length) {
    const word = selectedWords[index];
    document.getElementById('currentWord').innerHTML = `
      ${word} <span style="font-size: 1rem; color: #666;">(${toPinyin(word)})</span>
    `;
    document.getElementById('progress').textContent = `进度: ${index + 1}/${selectedWords.length}`;
    updatePlayerStatusList();
  }
}

function updatePlayerStatus(nickname, status) {
  const statusEl = document.getElementById('playerStatus');
  const items = statusEl.querySelectorAll('.player-item');
  items.forEach(item => {
    if (item.dataset.nickname === nickname) {
      const badge = item.querySelector('.status-badge');
      if (status === 'submitted') {
        badge.textContent = '✅ 已提交';
        badge.className = 'status-badge success';
      } else if (status === 'practiced') {
        badge.textContent = '🔄 练习中';
        badge.className = 'status-badge warning';
      } else if (status === 'done') {
        badge.textContent = '✅ 已完成';
        badge.className = 'status-badge success';
      } else {
        badge.textContent = '⏳ 书写中...';
        badge.className = 'status-badge warning';
      }
    }
  });
}

function updatePlayerStatusList() {
  const statusEl = document.getElementById('playerStatus');
  statusEl.innerHTML = '';

  playerNames.forEach(name => {
    const item = document.createElement('div');
    item.className = 'player-item';
    item.dataset.nickname = name;
    item.innerHTML = `
      <span class="player-name">${name}</span>
      <span class="status-badge warning">⏳ 等待中</span>
    `;
    statusEl.appendChild(item);
  });
}

// 检查当前词语是否所有玩家都已提交
function checkAllSubmitted() {
  const word = selectedWords[currentWordIndex];
  const allSubmitted = playerNames.every(name =>
    playerResults[name] && playerResults[name][word] !== undefined
  );

  if (allSubmitted) {
    // 记录当前词的结果
    let wordCorrect = true;
    playerNames.forEach(name => {
      if (playerResults[name] && playerResults[name][word] === false) {
        wordCorrect = false;
      }
    });
    allResults.push({ word, correct: wordCorrect });

    currentWordIndex++;

    if (currentWordIndex < selectedWords.length) {
      // 进入下一个词语
      setTimeout(() => {
        updatePlayStatus(currentWordIndex);
        // 重置所有玩家状态
        updatePlayerStatusList();
      }, 1000);
    } else {
      // 听写完成
      finishDictation();
    }
  }
}

// 完成听写
function finishDictation() {
  isPlaying = false;

  // 显示成绩单
  showElement('resultSection');
  hideElement('statusSection');

  const resultList = document.getElementById('resultList');
  resultList.innerHTML = '';

  let correctCount = 0;
  allResults.forEach(result => {
    const wordEl = document.createElement('span');
    wordEl.className = `result-word ${result.correct ? 'correct' : 'incorrect'}`;
    wordEl.textContent = `${result.correct ? '✅' : '❌'} ${result.word}`;
    resultList.appendChild(wordEl);
    if (result.correct) correctCount++;
  });

  document.getElementById('resultSummary').textContent =
    `正确: ${correctCount}/${allResults.length}    错误: ${allResults.length - correctCount}`;

  // 发送成绩单给选手
  const playerFinalResults = playerNames.map(name => {
    let correct = 0;
    let total = selectedWords.length;
    selectedWords.forEach(word => {
      if (playerResults[name] && playerResults[name][word]) {
        correct++;
      }
    });
    return { player: name, nickname: name, correct, total };
  });

  sendWsMessage({
    type: 'dictation_complete',
    roomId,
    results: allResults
  });

  // 检查是否有错题
  const wrongWords = allResults.filter(r => !r.correct).map(r => r.word);
  if (wrongWords.length > 0) {
    showElement('startPracticeBtn');
  } else {
    hideElement('startPracticeBtn');
  }
}

// 开始错题练习
document.getElementById('startPracticeBtn').addEventListener('click', () => {
  const wrongWords = allResults.filter(r => !r.correct).map(r => r.word);
  if (wrongWords.length === 0) return;

  hideElement('resultSection');
  showElement('statusSection');

  sendWsMessage({
    type: 'start_practice',
    roomId,
    words: wrongWords,
    round: 1,
    totalRounds: 3
  });

  document.getElementById('currentWord').innerHTML =
    `错题练习 <span style="font-size: 1rem; color: #666;">(每个词练习3次)</span>`;
  document.getElementById('progress').textContent = `词语: ${wrongWords.join('、')}`;
  updatePlayerStatusList();
});

// 结束
document.getElementById('endBtn').addEventListener('click', () => {
  if (confirm('确定要结束听写吗？')) {
    // 重置状态
    isPlaying = false;
    selectedWords = [];
    currentWordIndex = 0;
    playerResults = {};
    allResults = [];

    hideElement('resultSection');
    hideElement('statusSection');
    hideElement('selectedWordsSection');
    document.getElementById('startBtn').disabled = true;
    document.getElementById('wordList').innerHTML = '';

    showElement('ocrSection');
    showElement('timerSection');
  }
});

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

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);
