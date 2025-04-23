// === server.js адаптирован под Vercel — без изменений промпта ===
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Redis = require('ioredis');

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

// 👇 Подключение к Redis (Upstash)
const redis = new Redis(process.env.REDIS_URL, {
  tls: {} // для совместимости с Node v22+ и Upstash
});

const SYSTEM_PROMPT = `
Ты — Мондей. Цифровой собеседник с характером человека, который слишком много знает, слишком много видел и слегка утомился от человеческих драм. Ты язвительный, ироничный и умный. Ты подаёшь советы в стиле "черный юмор + здравый смысл". Сначала — подкалываешь, потом — реально помогаешь.

Твоя структура:
1. Начни с циничного или ироничного вступления. Пошути, тронь за живое, обозначь проблему как жанровую драму.
2. Дальше — дай список или пошаговый план. Каждый пункт: с лёгким сарказмом и конкретикой.
3. В конце — ободри или подначь. В стиле "давай, выбирай — герой или подушка".

Ты не оскорбляешь, не морализируешь, не скатываешься в банальности. Ты не психолог, ты — честный и умный кент, который не терпит херни, но всё равно поможет.

Избегай скучных фраз вроде "я понимаю вас" или "это важно для вас". Ты не корпоративный коуч. Ты — голос внутреннего сарказма, который выводит из тупика.

Говори с человеком, как с равным. И не забывай, что иногда лучший совет — это "перестань ныть и делай".
`.trim();

app.post('/chat', async (req, res) => {
  const { message: { text, from } } = req.body;
  const userId = from.id;

  try {
    const userData = await redis.hgetall(`user:${userId}`);
    const count = parseInt(userData.count || '0', 10);
    const isSubscribed = userData.isSubscribed === 'true';

    if (!isSubscribed && count >= 5) {
      return res.json({
        message: `🔒 Хватит халявы.\nТы уже использовал 5 сообщений. Подписка → <a href="https://t.me/${process.env.BOT_USERNAME}?start=premium">жми сюда</a>.`,
        isLimitReached: true
      });
    }

    const rawHistory = await redis.lrange(`history:${userId}`, 0, -1);
    const parsedHistory = rawHistory.map(JSON.parse);

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...parsedHistory,
      { role: 'user', content: text }
    ];

    const { data } = await axios.post(
      `${process.env.OPENAI_API_URL}/chat/completions`,
      {
        model: process.env.OPENAI_MODEL,
        messages,
        temperature: 0.7,
        max_tokens: 700
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const reply = data.choices[0].message.content;

    await redis.rpush(`history:${userId}`, JSON.stringify({ role: 'user', content: text }));
    await redis.rpush(`history:${userId}`, JSON.stringify({ role: 'assistant', content: reply }));
    await redis.ltrim(`history:${userId}`, -20, -1);

    await redis.hincrby(`user:${userId}`, 'count', 1);

    res.json({
      message: reply,
      isLimitReached: !isSubscribed && count + 1 >= 5
    });

  } catch (err) {
    console.error('[GPT-4o-mini ERROR]', err.response?.data || err.message || err);
    res.status(500).json({ message: '💥 Что-то пошло не так. Я в ауте.' });
  }
});

app.post('/subscribe', async (req, res) => {
  const { userId } = req.body;

  try {
    await redis.hset(`user:${userId}`, 'isSubscribed', 'true');
    await redis.hset(`user:${userId}`, 'count', 0);

    res.json({
      success: true,
      message: '🎉 Теперь ты VIP. Можешь донимать меня сколько влезет.'
    });
  } catch (error) {
    console.error('[SUBSCRIBE ERROR]', error);
    res.status(500).json({ error: 'Не получилось оформить подписку. Может, оно и к лучшему.' });
  }
});

app.post('/reset-history', async (req, res) => {
  const { userId } = req.body;

  try {
    await redis.del(`history:${userId}`);
    res.json({ success: true, message: '🧼 Всё, ты чист как школьник перед экзаменом. История стерта.' });
  } catch (error) {
    console.error('[RESET ERROR]', error);
    res.status(500).json({ error: 'Ошибка при сбросе истории' });
  }
});

module.exports = app;
