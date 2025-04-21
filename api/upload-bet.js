/**
 * /api/upload-bet.js
 * One‑stop player‑prop extractor for multiple sportsbooks – with color detection
 */
import { IncomingForm } from 'formidable';
import fs from 'fs';
import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import convert from 'color-convert';          // 🆕
import OpenAI from 'openai';

/* ───────── Google / OpenAI init ───────── */
const google = JSON.parse(process.env.GOOGLE_CLOUD_VISION_KEY);
const visionClient = new ImageAnnotatorClient({
  credentials: { client_email: google.client_email, private_key: google.private_key }
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = { api: { bodyParser: false } };

/* ───────── Button‑theme catalogue ───────── */
const buttonThemes = [
  { bookmaker:'prizepicks', keywords:['More','Less'],   hue:[ 90,150], satMin:40 }, // neon green
  { bookmaker:'underdog',   keywords:['Higher','Lower'],hue:[170,210], satMin:35 }, // cyan/teal
  { bookmaker:'betrivers',  keywords:['Over','Under'], hue:[350, 20], satMin:40 }, // red
];

/* ───────── Helpers ───────── */
const normalizeName = t =>
  t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\s]/g,'')
    .toLowerCase().trim();

const makeBox = v => {
  const xs = v.map(p=>p.x), ys = v.map(p=>p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs)-x, h: Math.max(...ys)-y };
};

/* sample a 6×6 pixel crop at centre of the button and score "selected" */
async function scoreSelected(buf, box, theme) {
  const { x, y, w, h } = box;
  const crop = await sharp(buf)
      .extract({ left: Math.floor(x+w*0.25), top: Math.floor(y+h*0.25),
                 width: Math.max(4, Math.floor(w*0.5)),
                 height: Math.max(4, Math.floor(h*0.5)) })
      .resize(6, 6).raw().toBuffer();

  let selectedPixels = 0;
  for (let i=0; i<crop.length; i+=3) {
    const [hue, sat] = convert.rgb.hsv.raw(crop[i], crop[i+1], crop[i+2]);
    const inRange = theme.hue[0] < theme.hue[1]
      ? hue >= theme.hue[0] && hue <= theme.hue[1]
      : (hue >= theme.hue[0] || hue <= theme.hue[1]);     // wrap‑around red
    if (inRange && sat >= theme.satMin) selectedPixels++;
  }
  return selectedPixels;       // higher = more likely selected
}

/* Detect which button (over/under) is highlighted per row */
async function detectHighlighted(words, buf) {
  const result = {};                         // Y‑coord → 'over' | 'under'
  for (const theme of buttonThemes) {
    const [wordA, wordB] = theme.keywords;
    const btnA = words.filter(w => new RegExp(`^${wordA}$`, 'i').test(w.text));
    const btnB = words.filter(w => new RegExp(`^${wordB}$`, 'i').test(w.text));
    const pairs = Math.min(btnA.length, btnB.length);
    for (let i = 0; i < pairs; i++) {
      const a = btnA[i], b = btnB[i];
      const scoreA = await scoreSelected(buf, a.box, theme);
      const scoreB = await scoreSelected(buf, b.box, theme);
      if (scoreA === scoreB) continue;       // ambiguous
      const choice = scoreA > scoreB ? 'over' : 'under'; // wordA always "over"
      result[a.box.y] = choice;
      result[b.box.y] = choice;
    }
  }
  return result;
}

/* ───────── Main handler ───────── */
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

      /* OCR */
      const [vis] = await visionClient.textDetection(buf);
      const anns  = vis.textAnnotations || [];
      const raw   = anns[0]?.description?.trim() || '';
      if (!raw) return res.status(200).json({ rawText:'', structuredBets: [] });

      const words = anns.slice(1).map(a=>({ text:a.description, box:makeBox(a.boundingPoly.vertices) }));
      const colorMap = await detectHighlighted(words, buf);

      /* Build trimmed GPT input */
      const top = raw.split('\n').slice(0, Math.ceil(raw.split('\n').length/2));
      const betLines = top.filter(l =>
        /\d+\.\d/.test(l) || /(points|rebounds|assists|3pt|pra)/i.test(l) ||
        /[A-Z][a-z]+\s[A-Z][a-z]+/.test(l)
      ).join('\n')
       .replace(/3PTS/gi,'3PT made')
       .replace(/PTS/gi,'points')
       .replace(/REB/gi,'rebounds')
       .replace(/AST/gi,'assists')
       .replace(/PRA/gi,'points + rebounds + assists');

      /* GPT extraction */
      const gptPrompt = `
Extract player prop bets from this text:

---
${betLines}
---

Return **pure JSON** like:
[{"player":"LeBron James","prop":"points","line":26.5,"type":"over"}]

Rules:
- More/Higher/Over  → "over"
- Less/Lower/Under → "under"
- Include a bet only if player, prop, line, and type are clear.
- If none, return [].
      `;
      const gpt = await openai.chat.completions.create({
        model:'gpt-4o', temperature:0, max_tokens:400,
        messages:[
          { role:'system', content:'Extract player props as pure JSON only.' },
          { role:'user',   content:gptPrompt }
        ]
      });

      let text = gpt.choices[0].message.content.trim()
                   .replace(/^```json/i,'').replace(/```$/,'').trim();
      let bets; try { bets = JSON.parse(text); } catch { bets = []; }

      /* Regex fallback if GPT returned [] */
      if (bets.length === 0) {
        const single = /([A-Z][a-z]+\s[A-Z][a-z]+).*?(\d+\.\d+)\s+(Points|Rebounds|Assists|3PT made|PRA)/is
                       .exec(betLines);
        if (single) {
          const [, player, line, prop] = single;
          const row = words.find(w => new RegExp(`${line}`.replace('.','\\.'),'i').test(w.text));
          const defaultType = row && colorMap[row.box.y] ? colorMap[row.box.y] : 'over';
          bets = [{ player, prop, line: parseFloat(line), type: defaultType }];
        }
      }

      /* Normalise & apply color override */
      const final = bets.map(leg => {
        const txt = leg.type?.toLowerCase();
        let type  = ['more','higher','over'].includes(txt) ? 'over'
                  : ['less','lower','under'].includes(txt) ? 'under' : txt;

        const row = words.find(w => new RegExp(`${leg.line}`.replace('.','\\.'),'i').test(w.text));
        if (row && colorMap[row.box.y]) type = colorMap[row.box.y];

        return {
          player: normalizeName(leg.player),
          prop  : leg.prop.toLowerCase().trim(),
          line  : parseFloat(leg.line),
          type
        };
      });

      console.log('📦 Final bets', final);
      return res.status(200).json({ rawText: raw, structuredBets: final });

    } catch (e) {
      console.error('upload‑bet error', e);
      return res.status(500).json({ message:'Server error', error:e.message });
    }
  });
}
