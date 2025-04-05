// /pages/api/upload-bet.js

// Minor change to force Vercel redeployment
import { IncomingForm } from 'formidable';
import fs from 'fs';
import fetch from 'node-fetch'; // or the built-in fetch if Node 18+
import FormData from 'form-data';
import OpenAI from 'openai';

export const config = {
  api: {
    bodyParser: false, // so formidable can parse form-data
  },
};

// Initialize GPT (we'll default to GPT-3.5 here)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests allowed' });
  }

  // 1) Parse incoming form-data (the user’s image upload)
  const form = new IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('❌ Form parse error:', err);
      return res.status(500).json({ message: 'Error parsing form data', error: err });
    }

    // Make sure file is present
    const file = files.file?.[0];
    if (!file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    try {
      // 2) Read the uploaded image from disk
      const fileBuffer = fs.readFileSync(file.filepath);

      // 3) Call OCR.Space with your OCR API key
      const formData = new FormData();
      formData.append('file', fileBuffer, file.originalFilename || 'bet_screenshot.jpg');
      formData.append('apikey', process.env.OCR_SPACE_API_KEY);
      formData.append('language', 'eng');
      // formData.append('OCREngine', '2'); // optional - you can try engine 2
      // Additional optional params if you want them

      const ocrRes = await fetch('https://api.ocr.space/parse/image', {
        method: 'POST',
        body: formData,
      });
      const ocrJson = await ocrRes.json();

      // OCR.Space typically returns an array under "ParsedResults"
      // each with a "ParsedText" field
      const parsedText = ocrJson?.ParsedResults?.[0]?.ParsedText?.trim() || '';

      if (!parsedText) {
        // If OCR found no text, we can return early or pass an empty array
        return res.status(200).json({ message: 'No text found in screenshot', rawText: '' });
      }

      console.log('📝 OCR Extracted Text:\n', parsedText);

      // 4) Use GPT-3.5 to parse that text into structured bets
      const userPrompt = `
Here is text from a sports betting slip:
---
${parsedText}
---

Extract valid player prop bets in a JSON array like this:
[
  { "player": "LeBron James", "prop": "points", "line": 26.5, "type": "over" }
]

- Do NOT invent bets. Only use what you see in the text.
- If you see multiple bets, return them all.
- If you see no bets, return an empty array.
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
        temperature: 0, // more deterministic
        max_tokens: 300,
      });

      const rawGpt = gptResponse.choices?.[0]?.message?.content?.trim() || '';
      let structuredBets = [];

      try {
        structuredBets = JSON.parse(rawGpt);
      } catch (err) {
        console.error('❌ GPT JSON parse error:', err, '\nRaw GPT output:', rawGpt);
        // fallback to empty array
        structuredBets = [];
      }

      // 🧼 Normalize "more"/"less" to "over"/"under," if needed
      const cleanedParsed = structuredBets.map(leg => {
        const lower = leg.type?.toLowerCase();
        return {
          ...leg,
          type: lower === 'more' ? 'over'
               : lower === 'less' ? 'under'
               : leg.type,
        };
      });

      console.log('📦 Final structured bets:', cleanedParsed);

      // 5) (Optional) If you want to fetch insights from these bets
      // just like your old code, do so here:
      /*
      const insightsRes = await fetch("https://YOUR-INSIGHTS-ENDPOINT", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanedParsed),
      });
      const insights = await insightsRes.json();
      return res.status(200).json({ insights });
      */

      // Or simply return them directly for now
      return res.status(200).json({
        rawText: parsedText,
        structuredBets: cleanedParsed,
      });

    } catch (error) {
      console.error('🔥 Upload-bet handler failed:', error.message);
      return res.status(500).json({ message: 'Upload failed', error: error.message });
    }
  });
}
