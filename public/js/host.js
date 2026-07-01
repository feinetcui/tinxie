// 控制端逻辑
let selectedWords = [];
let currentTime = 10;
let isPlaying = false;

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
  document.getElementById('roomId').textContent = `房间号: ${roomId}`;
  document.getElementById('roomUrl').textContent = message.url;
  
  // 生成二维码
  QRCode.toCanvas(document.getElementById('qrCode'), message.url, {
    width: 200,
    margin: 2
  });
});

onMessage('player_joined', (message) => {
  document.getElementById('playerCount').textContent = `${message.playerCount} 人在线`;
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
  } catch (error) {
    console.error('Check handwriting error:', error);
  }
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
  
  isPlaying = true;
  sendWsMessage({
    type: 'start_round',
    roomId,
    words: selectedWords,
    timeLimit: currentTime
  });
  
  // 显示状态区域
  showElement('statusSection');
  hideElement('startBtn');
  updatePlayStatus(0);
});

function updatePlayStatus(index) {
  if (index < selectedWords.length) {
    const word = selectedWords[index];
    document.getElementById('currentWord').innerHTML = `
      ${word} <span style="font-size: 1rem; color: #666;">(${toPinyin(word)})</span>
    `;
    document.getElementById('progress').textContent = `进度: ${index + 1}/${selectedWords.length}`;
  }
}

// 拼音转换（简化版，实际使用 pinyin-pro）
function toPinyin(word) {
  // 这里使用简单的映射，实际应该使用 pinyin-pro
  const pinyinMap = {
    '春': 'chūn', '天': 'tiān', '花': 'huā', '朵': 'duǒ',
    '蝴': 'hú', '蝶': 'dié', '燕': 'yàn', '子': 'zi',
    '柳': 'liǔ', '树': 'shù', '溪': 'xī', '流': 'liú',
    '草': 'cǎo', '地': 'dì', '阳': 'yáng', '光': 'guāng',
    '栽': 'zāi'
  };
  return word.split('').map(char => pinyinMap[char] || char).join(' ');
}
