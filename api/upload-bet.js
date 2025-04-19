import { IncomingForm } from 'formidable';
import fs from 'fs';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import OpenAI from 'openai';

const googleCredentials = JSON.parse(process.env.GOOGLE_CLOUD_VISION_KEY);

const visionClient = new ImageAnnotatorClient({
  credentials: {
    client_email: googleCredentials.client_email,
    private_key: googleCredentials.private_key,
  },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const config = {
  api: {
    bodyParser: false,
  },
};

// 🧠 Unicode name normalizer
const normalizeName = (name) =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^\w\s]/gi, "")        // remove weird punctuation
    .toLowerCase()
    .trim();

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

      const cleanedTopHalf = topHalf
        .replace(/3PTS/gi, '3PT made')
        .replace(/PTS/gi, 'points')
        .replace(/REB/gi, 'rebounds')
        .replace(/AST/gi, 'assists')
        .replace(/PRA/gi, 'points + rebounds + assists');

      const userPrompt = `
You are extracting player prop bets from a sports betting screenshot.

Only focus on the top half of the betting slip:
---
${cleanedTopHalf}
---

Return all found player prop bets in **this exact JSON format**:
[
  { "player": "LeBron James", "prop": "points", "line": 26.5, "type": "over" }
]

Rules:
- DO NOT include anything about payout, entry, Power Plays, or balances.
- If the word "More" appears near a player's stat, set "type": "over".
- If the word "Less" appears near a player's stat, set "type": "under".
- Only include props with a valid number line (e.g., 23.5, not “N/A”).
- Common props include: points, rebounds, assists, 3PT made, PRA.
- NEVER guess — only include bets where player, prop, line, and type are all clearly present.
- If no props are found, return: []
- Always return pure JSON, nothing else.
      `;

      const gptResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You extract player prop bets from OCR text. Return clean JSON only.',
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        temperature: 0,
        max_tokens: 400,
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

      const cleanedParsed = structuredBets
        .filter(leg =>
          leg.player &&
          leg.prop &&
          leg.line !== undefined &&
          (leg.type === 'over' || leg.type === 'under' || leg.type === 'more' || leg.type === 'less')
        )
        .map(leg => {
          const lowerType = leg.type?.toLowerCase();
          return {
            ...leg,
            player: normalizeName(leg.player), // ✅ Normalize name here
            prop: leg.prop.toLowerCase().trim(),
            line: parseFloat(leg.line),
            type:
              lowerType === 'more' ? 'over' :
              lowerType === 'less' ? 'under' :
              lowerType,
          };
        });

      if (cleanedParsed.length === 0) {
        console.warn('⚠️ GPT returned no valid props. OCR may be poor or screenshot unclear.');
      }

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
