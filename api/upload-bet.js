import { IncomingForm } from 'formidable';
import fs from 'fs';
import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import OpenAI from 'openai';

const googleCredentials = JSON.parse(process.env.GOOGLE_CLOUD_VISION_KEY);
const visionClient = new ImageAnnotatorClient({
  credentials: {
    client_email: googleCredentials.client_email,
    private_key: googleCredentials.private_key,
  },
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = {
  api: {
    bodyParser: false,
  },
};

async function isHighlightedGreen(fileBuffer, poly) {
  // same as the snippet above
}

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
      // 1) Vision request with boundingPoly data
      const fileBuffer = fs.readFileSync(file.filepath);
      const [result] = await visionClient.annotateImage({
        image: { content: fileBuffer },
        features: [{ type: 'TEXT_DETECTION' }],
      });

      // If no text
      if (!result.fullTextAnnotation) {
        return res.status(200).json({ rawText: '', structuredBets: [] });
      }

      // 2) Extract the full text (for GPT) if needed
      const fullText = result.fullTextAnnotation.text || '';
      console.log('📝 Full text:\n', fullText);

      // 3) Build a map of “More”/“Less” to see if either is highlighted
      //    by analyzing bounding boxes:
      const moreOrLessSelections = []; // e.g. [{ word: 'More', boundingBox: {...}, isGreen: true }]

      // Loop over pages -> blocks -> paragraphs -> words
      for (const page of result.fullTextAnnotation.pages) {
        for (const block of page.blocks) {
          for (const paragraph of block.paragraphs) {
            for (const word of paragraph.words) {
              const wordText = word.symbols.map(s => s.text).join('');
              if (/(More|Less)/i.test(wordText)) {
                // Check bounding box color
                const boundingPoly = word.boundingBox;
                const selected = await isHighlightedGreen(fileBuffer, boundingPoly);
                moreOrLessSelections.push({
                  text: wordText,
                  boundingBox,
                  selected,
                });
              }
            }
          }
        }
      }

      console.log('🟩 More/Less bounding box analysis:', moreOrLessSelections);

      // 4) Now you know EXACTLY whether “More” or “Less” is truly highlighted for each instance.
      //    You can pass this knowledge to GPT or build a direct logic.

      // For simplicity, let's pass your entire top-half text + a note about which words are green:
      const lines = fullText.split('\n');
      const topHalf = lines.slice(0, Math.floor(lines.length / 2)).join('\n');

      let colorAnalysisNotes = '';
      for (const item of moreOrLessSelections) {
        if (item.selected) {
          colorAnalysisNotes += `The word "${item.text}" is highlighted in green.\n`;
        }
      }

      const userPrompt = `
Here is text from a sports betting slip:
---
${topHalf}
---
Additional color info:
${colorAnalysisNotes}

Your job:
- Extract player prop bets in the format:
  [ { "player": "...", "prop": "...", "line": 0, "type": "over" } ]
- If "More" is highlighted in green, that means the user selected "over".
- If "Less" is highlighted in green, that means "under".
- If both appear but only "More" is green, it's "over".
- Do not guess. If unclear, skip.
`;

      const gptResponse = await openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You parse sports bets from text, returning only valid JSON arrays. You also respect color info indicating which bet was actually selected.',
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

      console.log('📦 Final structured bets:', structuredBets);

      return res.status(200).json({
        rawText: fullText,
        structuredBets,
      });
    } catch (error) {
      console.error('🔥 Upload-bet handler failed:', error.message);
      return res.status(500).json({ message: 'Upload failed', error: error.message });
    }
  });
}
