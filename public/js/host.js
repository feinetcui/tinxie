// 控制端逻辑
let selectedWords = [];
let isPlaying = false;
let currentWordIndex = 0;
let playerResults = {}; // { nickname: { word: correct } }
let playerNames = [];
let allResults = []; // [{ word, correct }]

// 排名追踪
let playerStats = {}; // { nickname: { correct: 0, incorrect: 0, totalTime: 0 } }
let roundStartTime = null;
let lastSubmitTime = {}; // { nickname: timestamp } — 上一次提交时间

// 初始化
async function init() {
  try {
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
  if (!playerNames.includes(message.nickname)) {
    playerNames.push(message.nickname);
  }
  updatePlayerList();
  updatePlayerStatusList();
});

onMessage('player_left', (message) => {
  document.getElementById('playerCount').textContent = `${message.playerCount} 人在线`;
  playerNames = playerNames.filter(n => n !== message.nickname);
  updatePlayerList();
  updatePlayerStatusList();
});

onMessage('answer_submitted', async (message) => {
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

    // 更新排名统计
    if (!playerStats[message.nickname]) {
      playerStats[message.nickname] = { correct: 0, incorrect: 0, totalTime: 0 };
    }
    if (result.correct) {
      playerStats[message.nickname].correct++;
    } else {
      playerStats[message.nickname].incorrect++;
    }

    // 计算本轮用时
    if (roundStartTime && message.submittedAt) {
      const wordTime = (message.submittedAt - roundStartTime) / 1000;
      playerStats[message.nickname].totalTime += wordTime;
    }

    updatePlayerStatus(message.nickname, 'submitted');
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

      if (result.success && result.words && result.words.length > 0) {
        showWordSelection(result.words);
      } else {
        const errorMsg = result.error || '未能识别出词语';
        console.error('OCR failed:', errorMsg);
        alert(`识别失败：${errorMsg}\n请尝试手动输入词语`);
      }
    } catch (error) {
      hideElement('ocrLoading');
      console.error('OCR error:', error);
      alert(`网络错误：${error.message}\n请检查网络连接后重试`);
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

  document.getElementById('startBtn').disabled = selectedWords.length === 0;

  if (selectedWords.length > 0) {
    showElement('selectedWordsSection');
  } else {
    hideElement('selectedWordsSection');
  }
}

// 开始听写
document.getElementById('startBtn').addEventListener('click', () => {
  if (selectedWords.length === 0) return;

  isPlaying = true;
  currentWordIndex = 0;
  playerResults = {};
  allResults = [];
  playerStats = {};
  lastSubmitTime = {};

  // 初始化每个选手的统计
  playerNames.forEach(name => {
    playerStats[name] = { correct: 0, incorrect: 0, totalTime: 0 };
  });

  roundStartTime = Date.now();

  sendWsMessage({
    type: 'start_round',
    roomId,
    words: selectedWords
  });

  showElement('statusSection');
  hideElement('ocrSection');
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

function updatePlayerList() {
  const section = document.getElementById('playerListSection');
  const list = document.getElementById('playerList');

  if (playerNames.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  list.innerHTML = '';

  playerNames.forEach(name => {
    const tag = document.createElement('span');
    tag.className = 'player-tag';
    tag.textContent = name;
    list.appendChild(tag);
  });
}

// 检查当前词语是否所有玩家都已提交
function checkAllSubmitted() {
  const word = selectedWords[currentWordIndex];
  const allSubmitted = playerNames.every(name =>
    playerResults[name] && playerResults[name][word] !== undefined
  );

  if (allSubmitted) {
    let wordCorrect = true;
    playerNames.forEach(name => {
      if (playerResults[name] && playerResults[name][word] === false) {
        wordCorrect = false;
      }
    });
    allResults.push({ word, correct: wordCorrect });

    currentWordIndex++;

    if (currentWordIndex < selectedWords.length) {
      // 重置本轮开始时间（为下一词计时）
      roundStartTime = Date.now();
      setTimeout(() => {
        updatePlayStatus(currentWordIndex);
        updatePlayerStatusList();
      }, 1000);
    } else {
      finishDictation();
    }
  }
}

// 完成听写
function finishDictation() {
  isPlaying = false;

  hideElement('statusSection');

  // 发送成绩单给选手
  sendWsMessage({
    type: 'dictation_complete',
    roomId,
    results: allResults
  });

  // 计算排名并发送
  const rankings = calculateRanking();
  sendWsMessage({
    type: 'leaderboard',
    roomId,
    rankings
  });

  // 检查是否有错题
  const wrongWords = allResults.filter(r => !r.correct).map(r => r.word);
  if (wrongWords.length > 0) {
    document.getElementById('startPracticeBtn').style.display = '';
  } else {
    document.getElementById('startPracticeBtn').style.display = 'none';
  }
}

// 计算排名
function calculateRanking() {
  const rankings = playerNames.map(name => {
    const stats = playerStats[name] || { correct: 0, incorrect: 0, totalTime: 0 };
    const total = stats.correct + stats.incorrect;
    const accuracy = total > 0 ? Math.round((stats.correct / total) * 100) : 0;
    return {
      nickname: name,
      correct: stats.correct,
      incorrect: stats.incorrect,
      accuracy,
      totalTime: Math.round(stats.totalTime * 10) / 10
    };
  });

  // 排序：正确率降序，用时升序
  rankings.sort((a, b) => {
    if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
    return a.totalTime - b.totalTime;
  });

  // 添加排名
  rankings.forEach((r, i) => {
    r.rank = i + 1;
  });

  return rankings;
}

// 开始错题练习
document.getElementById('startPracticeBtn').addEventListener('click', () => {
  const wrongWords = allResults.filter(r => !r.correct).map(r => r.word);
  if (wrongWords.length === 0) return;

  hideElement('leaderboardOverlay');
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
    isPlaying = false;
    selectedWords = [];
    currentWordIndex = 0;
    playerResults = {};
    allResults = [];
    playerStats = {};
    lastSubmitTime = {};

    hideElement('leaderboardOverlay');
    hideElement('statusSection');
    hideElement('selectedWordsSection');
    document.getElementById('startBtn').disabled = true;
    document.getElementById('wordList').innerHTML = '';

    showElement('ocrSection');
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

document.addEventListener('DOMContentLoaded', init);
