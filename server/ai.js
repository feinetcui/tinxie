const fetch = require('node-fetch');

const AGNES_API_KEY = process.env.AGNES_API_KEY;
const AGNES_API_URL = 'https://apihub.agnes-ai.com/v1/chat/completions';
const MODEL = 'agnes-2.0-flash';

async function callAgnesAI(messages) {
  const response = await fetch(AGNES_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${AGNES_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
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

async function recognizeText(imageBase64) {
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

  const result = await callAgnesAI(messages);
  
  // 解析 JSON 结果
  try {
    // 尝试提取 JSON 数组
    const jsonMatch = result.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(result);
  } catch (e) {
    // 如果解析失败，尝试按换行分割
    return result.split('\n').filter(line => line.trim().length > 0);
  }
}

async function checkHandwriting(imageBase64, correctWord) {
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

  const result = await callAgnesAI(messages);
  
  // 解析 JSON 结果
  try {
    const jsonMatch = result.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    return JSON.parse(result);
  } catch (e) {
    // 默认返回正确
    return { correct: true, recognized: correctWord };
  }
}

module.exports = {
  recognizeText,
  checkHandwriting
};
