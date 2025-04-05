// /pages/api/upload-bet.js

import { IncomingForm } from 'formidable';
import fs from 'fs';
import { ImageAnnotatorClient } from '@google-cloud/vision';  // <-- Installs @google-cloud/vision
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
    bodyParser: false, // so formidable can parse form-data
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

    // Make sure file is present
    const file = files.file?.[0];
    if (!file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    try {
      // 1) Read the uploaded image into a Buffer
      const fileBuffer = fs.readFileSync(file.filepath);

      // 2) Use Google Vision to detect text
      const [result] = await visionClient.textDetection(fileBuffer);
      const detections = result?.textAnnotations;
      // textAnnotations[0].description usually contains the full recognized text
      const parsedText = detections?.[0]?.description?.trim() || '';

      if (!parsedText) {
        console.log('No text found via Google Vision');
        return res.status(200).json({ message: 'No text found in screenshot', rawText: '' });
      }

      console.log('📝 Vision Extracted Text:\n', parsedText);

      // 3) Use GPT-3.5 to parse that recognized text into structured bets
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
        temperature: 0,
        max_tokens: 300,
      });

      // GPT sometimes wraps JSON in triple-backticks, which breaks JSON.parse
      let rawGpt = gptResponse.choices?.[0]?.message?.content?.trim() || '';

      // Remove ```json fences if they exist
      rawGpt = rawGpt
        .replace(/^```json\s*/i, '')  // remove starting ```json
        .replace(/```$/, '')         // remove trailing ```
        .trim();

      let structuredBets = [];

      try {
        structuredBets = JSON.parse(rawGpt);
      } catch (jsonErr) {
        console.error('❌ GPT JSON parse error:', jsonErr, '\nRaw GPT output:', rawGpt);
        structuredBets = [];
      }

      // (Optional) Normalize "more"/"less" => "over"/"under"
      const cleanedParsed = structuredBets.map(leg => {
        const lower = leg.type?.toLowerCase();
        return {
          ...leg,
          type: lower === 'more'
            ? 'over'
            : lower === 'less'
            ? 'under'
            : leg.type
        };
      });

      console.log('📦 Final structured bets:', cleanedParsed);

      // Return to front end
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
