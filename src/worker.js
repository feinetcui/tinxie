import { Room } from './room-do';

export { Room };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API 路由 - OCR 和手写识别
    if (url.pathname === '/api/ocr') {
      return handleOCR(request, env);
    }
    if (url.pathname === '/api/check-handwriting') {
      return handleHandwritingCheck(request, env);
    }

    // WebSocket 连接 - 路由到 Durable Object
    if (url.pathname === '/ws') {
      const roomId = url.searchParams.get('room');
      const nickname = url.searchParams.get('nickname');
      const upgradeHeader = request.headers.get('Upgrade');

      console.log('WebSocket request received');
      console.log('roomId:', roomId, 'nickname:', nickname);
      console.log('Upgrade header:', upgradeHeader);

      // 控制端创建房间 - 生成 4 位房间号
      if (!roomId) {
        const newRoomId = Math.floor(1000 + Math.random() * 9000).toString();
        console.log('Creating new room:', newRoomId);
        const doId = env.ROOM.idFromName(newRoomId);
        const doStub = env.ROOM.get(doId);
        const newUrl = new URL(request.url);
        newUrl.pathname = '/websocket';
        newUrl.searchParams.set('role', 'host');
        newUrl.searchParams.set('roomId', newRoomId);
        console.log('Forwarding to DO with URL:', newUrl.toString());
        return doStub.fetch(new Request(newUrl.toString(), request));
      }

      // 选手端加入房间
      console.log('Player joining room:', roomId);
      const doId = env.ROOM.idFromName(roomId);
      const doStub = env.ROOM.get(doId);
      const newUrl = new URL(request.url);
      newUrl.pathname = '/websocket';
      newUrl.searchParams.set('roomId', roomId);
      if (nickname) {
        newUrl.searchParams.set('nickname', nickname);
      }
      console.log('Forwarding to DO with URL:', newUrl.toString());
      return doStub.fetch(new Request(newUrl.toString(), request));
    }

    // 静态资源 - Workers Sites
    return env.ASSETS.fetch(request);
  }
};

// OCR 识别
async function handleOCR(request, env) {
  try {
    const { image } = await request.json();
    console.log('OCR request received, image length:', image ? image.length : 0);

    const words = await recognizeText(image, env);
    return Response.json({ success: true, words });
  } catch (error) {
    console.error('OCR error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 手写识别
async function handleHandwritingCheck(request, env) {
  try {
    const { image, correctWord } = await request.json();
    const result = await checkHandwriting(image, correctWord, env);
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error('Handwriting check error:', error);
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}

// 调用 SenseNova AI
async function callSenseNovaAI(messages, env) {
  const apiKey = env.SENSENOVA_API_KEY;
  console.log('Calling SenseNova AI, API key exists:', !!apiKey);
  console.log('Messages count:', messages.length);

  const requestBody = {
    model: 'sensenova-6.7-flash-lite',
    messages: messages,
    temperature: 0.1,
    max_tokens: 2000
  };

  console.log('Request body size:', JSON.stringify(requestBody).length);

  const response = await fetch('https://token.sensenova.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  console.log('SenseNova AI response status:', response.status);

  const responseText = await response.text();
  console.log('SenseNova AI response:', responseText.substring(0, 500));

  if (!response.ok) {
    console.error('SenseNova AI error:', responseText);
    throw new Error(`SenseNova AI API error: ${responseText}`);
  }

  const data = JSON.parse(responseText);
  return data.choices[0].message.content;
}

// 上传图片到临时图床获取 URL
async function uploadImageToTempHost(imageBase64) {
  // 将 base64 转换为 Blob
  const binaryString = atob(imageBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: 'image/png' });

  // 使用 0x0.st 上传（免费，无需 API key）
  const formData = new FormData();
  formData.append('file', blob, 'image.png');

  const response = await fetch('https://0x0.st', {
    method: 'POST',
    body: formData
  });

  if (!response.ok) {
    throw new Error('Image upload failed');
  }

  const url = await response.text();
  return url.trim();
}

// 识别文字
async function recognizeText(imageBase64, env) {
  console.log('recognizeText called, imageBase64 length:', imageBase64 ? imageBase64.length : 0);

  // 清理 base64 数据
  let cleanBase64 = imageBase64;
  if (cleanBase64.startsWith('data:image')) {
    cleanBase64 = cleanBase64.replace(/^data:image\/\w+;base64,/, '');
  }

  // 上传图片获取 URL
  let imageUrl;
  try {
    imageUrl = await uploadImageToTempHost(cleanBase64);
    console.log('Image uploaded to:', imageUrl);
  } catch (uploadError) {
    console.error('Image upload error:', uploadError.message);
    throw new Error('图片上传失败，请重试');
  }

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: '请识别这张图片中的所有中文词语（2-4个字的词语），返回JSON数组格式，例如：["春天", "花朵", "蝴蝶"]。只返回JSON，不要其他内容。'
        },
        {
          type: 'image_url',
          image_url: {
            url: imageUrl
          }
        }
      ]
    }
  ];

  console.log('Calling SenseNova AI for OCR...');
  const result = await callSenseNovaAI(messages, env);
  console.log('OCR result:', result);

  try {
    const jsonMatch = result.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(result);
  } catch (e) {
    return result.split('\n').filter(line => line.trim().length > 0);
  }
}

// 判断手写
async function checkHandwriting(imageBase64, correctWord, env) {
  // 清理 base64 数据
  let cleanBase64 = imageBase64;
  if (cleanBase64.startsWith('data:image')) {
    cleanBase64 = cleanBase64.replace(/^data:image\/\w+;base64,/, '');
  }

  // 上传图片获取 URL
  let imageUrl;
  try {
    imageUrl = await uploadImageToTempHost(cleanBase64);
  } catch (uploadError) {
    throw new Error('图片上传失败，请重试');
  }

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `请判断这张图片中手写的字是否是"${correctWord}"。如果手写的字是正确的，返回{"correct": true, "recognized": "${correctWord}"}；如果不正确，返回{"correct": false, "recognized": "实际写的字"}。只返回JSON格式。`
        },
        {
          type: 'image_url',
          image_url: {
            url: imageUrl
          }
        }
      ]
    }
  ];

  const result = await callSenseNovaAI(messages, env);

  try {
    const jsonMatch = result.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(result);
  } catch (e) {
    return { correct: true, recognized: correctWord };
  }
}
