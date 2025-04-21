/**
 * /api/upload-bet.js
 * Dynamic player-prop extractor using GPT-4o (PrizePicks/Underdog) or Google Vision (others)
 */
import { IncomingForm } from 'formidable';
import fs from 'fs';
import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import OpenAI from 'openai';

/* ───────── Google / OpenAI init ───────── */
const google = JSON.parse(process.env.GOOGLE_CLOUD_VISION_KEY);
const visionClient = new ImageAnnotatorClient({
  credentials: {
    client_email: google.client_email,
    private_key:  google.private_key,
  },
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = { api: { bodyParser: false } };

/* ───────── Button‑theme catalogue ───────── */
const buttonThemes = [
  {
    bookmaker: 'prizepicks',
    keywords: ['More', 'Less'],
    selected: { r:[  0,110], g:[170,255], b:[  0,120] },
  },
  {
    bookmaker: 'underdog',
    keywords: ['Higher', 'Lower'],
    selected: { r:[  0, 80], g:[180,255], b:[200,255] },
  },
  // ➕ You can expand with more books if needed
];

const normalizeName = (t) =>
  t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s]/g, '')
    .toLowerCase().trim();

const makeBox = (v) => {
  const xs = v.map(p => p.x), ys = v.map(p => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};
const rgbInRange = (rgb, rng) =>
  rgb[0] >= rng.r[0] && rgb[0] <= rng.r[1] &&
  rgb[1] >= rng.g[0] && rgb[1] <= rng.g[1] &&
  rgb[2] >= rng.b[0] && rgb[2] <= rng.b[1];

const sampleRGB = async (buf, box) => {
  const { x, y, w, h } = box;
  const pix = await sharp(buf).extract({
      left: Math.max(0, Math.floor(x + w * 0.4)),
      top : Math.max(0, Math.floor(y + h * 0.4)),
      width: 6, height: 6,
    })
    .resize(1,1).raw().toBuffer();
  return [pix[0], pix[1], pix[2]];
};

async function detectHighlighted(words, imgBuf) {
  const result = {};
  for (const theme of buttonThemes) {
    const [keyA, keyB] = theme.keywords;
    const btnA = words.filter(w => new RegExp(`^${keyA}$`, 'i').test(w.text));
    const btnB = words.filter(w => new RegExp(`^${keyB}$`, 'i').test(w.text));
    const len = Math.min(btnA.length, btnB.length);
    for (let i = 0; i < len; i++) {
      const a = btnA[i], b = btnB[i];
      const rgbA = await sampleRGB(imgBuf, a.box);
      const rgbB = await sampleRGB(imgBuf, b.box);
      const selA = rgbInRange(rgbA, theme.selected);
      const selB = rgbInRange(rgbB, theme.selected);
      if (selA || selB) {
        const choice = selA ? 'over' : 'under';
        result[a.box.y] = choice;
        result[b.box.y] = choice;
      }
    }
  }
  return result;
}

function detectBookmaker(words) {
  for (const theme of buttonThemes) {
    const hasKeywords = theme.keywords.every(keyword =>
      words.some(w => new RegExp(`^${keyword}$`, 'i').test(w.text))
    );
    if (hasKeywords) return theme.bookmaker;
  }
  return 'generic';
}

export default async function handler(req, res) {
  if (req.method !== 'POST')
    return res.status(405).json({ message: 'Only POST allowed' });

  const form = new IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ message: 'Form error', err });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ message: 'No image uploaded' });

    try {
      const buf = fs.readFileSync(file.filepath);

      // ── OCR: Google Vision for everything
      const [vis] = await visionClient.textDetection(buf);
      const anns = vis.textAnnotations || [];
      const raw = anns[0]?.description?.trim() || '';
      if (!raw) return res.status(200).json({ rawText:'', structuredBets: [] });

      const words = anns.slice(1).map(a => ({ text:a.description, box:makeBox(a.boundingPoly.vertices) }));
      const bookmaker = detectBookmaker(words);
      const colorMap = ['prizepicks','underdog'].includes(bookmaker)
        ? await detectHighlighted(words, buf)
        : {};

      // ── Clean up top half of slip for GPT
      const top = raw.split('\n').slice(0, Math.ceil(raw.split('\n').length/2)).join('\n')
        .replace(/3PTS/gi,'3PT made').replace(/PTS/gi,'points')
        .replace(/REB/gi,'rebounds').replace(/AST/gi,'assists')
        .replace(/PRA/gi,'points + rebounds + assists');

      // ── GPT extraction
      const gptPrompt = `
Extract player prop bets from this text (top half of slip):

---
${top}
---

Return pure JSON: [{"player":"LeBron James","prop":"points","line":26.5,"type":"over"}]
Rules:
- "More/Higher/Over" → over, "Less/Lower/Under" → under.
- Include props only if all fields clear.
- If none, return [].
      `;
      const gpt = await openai.chat.completions.create({
        model:'gpt-4o', temperature:0, max_tokens:400,
        messages:[
          {role:'system',content:'Extract player props as JSON only.'},
          {role:'user',  content:gptPrompt}
        ]
      });
      let json = gpt.choices[0].message.content.trim()
        .replace(/^```json/i,'').replace(/```$/,'').trim();
      let bets; try { bets = JSON.parse(json); } catch { bets=[]; }

      const final = bets.map(leg => {
        const txtType = leg.type?.toLowerCase();
        let type = ['more','higher','over'].includes(txtType) ? 'over'
                 : ['less','lower','under'].includes(txtType) ? 'under'
                 : txtType;
        const lineRegex = new RegExp(`${leg.line}`.replace('.','\\.'),'i');
        const row = words.find(w => lineRegex.test(w.text));
        if (row && colorMap[row.box.y]) type = colorMap[row.box.y];

        return {
          player: normalizeName(leg.player),
          prop: leg.prop.toLowerCase().trim(),
          line: parseFloat(leg.line),
          type,
        };
      });

      console.log(`📦 Final bets from ${bookmaker}`, final);
      return res.status(200).json({ rawText: raw, structuredBets: final });

    } catch (e) {
      console.error('upload‑bet error', e);
      return res.status(500).json({ message:'Server error', error: e.message });
    }
  });
}
