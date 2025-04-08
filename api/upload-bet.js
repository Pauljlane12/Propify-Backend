// /pages/api/upload-bet.js

import { IncomingForm } from 'formidable';
import fs from 'fs';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import OpenAI from 'openai';

// If you stored your entire JSON in one environment variable (GOOGLE_CLOUD_VISION_KEY):
const googleCredentials = JSON.parse(process.env.GOOGLE_CLOUD_VISION_KEY);

// Create the Vision client
const visionClient = new ImageAnnotatorClient({
  credentials: {
    client_email: googleCredentials.client_email,
    private_key: googleCredentials.private_key,
  },
});

// Initialize GPT
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests allowed' });
  }

  const form = new IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Form parse error:', err);
      return res.status(500).json({ message: 'Error parsing form data', error: err });
    }

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    try {
      const fileBuffer = fs.readFileSync(file.filepath);
      const [result] = await visionClient.textDetection(fileBuffer);
      const detections = result?.textAnnotations;
      const fullText = detections?.[0]?.description?.trim() || '';

      if (!fullText) {
        console.log('No text found via Google Vision');
        return res.status(200).json({ message: 'No text found in screenshot', rawText: '' });
      }

      console.log('📝 Vision Extracted Text:\n', fullText);

      // Trim to top half only
      const lines = fullText.split('\n');
      const topHalf = lines.slice(0, Math.floor(lines.length / 2)).join('\n');

      const userPrompt = `
Here is text from a sports betting slip:
---
${topHalf}
---

Your job:
Extract only the player prop bets and return them in this format:
[
  { "player": "LeBron James", "prop": "points", "line": 26.5, "type": "over" }
]

Rules:
- ONLY use the top section of the text — ignore anything about Power Play, Entry Fee, payout, balances, etc.
- If the word "More" is near a player's stat, that means "over".
- If the word "Less" is near a player's stat, that means "under".
- Do NOT guess or invent anything.
- If no bets are found, return an empty array: []
      `;

      const gptResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are an assistant that extracts bet details from text and returns JSON only.',
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0,
        max_tokens: 300,
      });

      let rawGpt = gptResponse.choices?.[0]?.message?.content?.trim() || '';
      rawGpt = rawGpt.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

      let structuredBets = [];

      try {
        structuredBets = JSON.parse(rawGpt);
      } catch (jsonErr) {
        console.error('❌ GPT JSON parse error:', jsonErr, '\nRaw GPT output:', rawGpt);
        structuredBets = [];
      }

      const cleanedParsed = structuredBets.map(leg => {
        const lower = leg.type?.toLowerCase();
        return {
          ...leg,
          type:
            lower === 'more' ? 'over' :
            lower === 'less' ? 'under' :
            leg.type,
        };
      });

      console.log('📦 Final structured bets:', cleanedParsed);

      return res.status(200).json({
        rawText: fullText,
        structuredBets: cleanedParsed,
      });

    } catch (error) {
      console.error('🔥 Upload-bet handler failed:', error.message);
      return res.status(500).json({ message: 'Upload failed', error: error.message });
    }
  });
}
