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

// 调用 Agnes AI
async function callAgnesAI(messages, env) {
  const apiKey = env.AGNES_API_KEY;
  const response = await fetch('https://apihub.agnes-ai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'agnes-2.0-flash',
      messages: messages,
      temperature: 0.1
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Agnes AI API error: ${error}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// 识别文字
async function recognizeText(imageBase64, env) {
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
            url: `data:image/jpeg;base64,${imageBase64}`
          }
        }
      ]
    }
  ];

  const result = await callAgnesAI(messages, env);

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
            url: `data:image/jpeg;base64,${imageBase64}`
          }
        }
      ]
    }
  ];

  const result = await callAgnesAI(messages, env);

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
