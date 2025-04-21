/**
 * /api/upload-bet.js
 * Universal player‑prop extractor with colour‑button detection
 */
import { IncomingForm } from 'formidable';
import fs from 'fs';
import sharp from 'sharp';
import { ImageAnnotatorClient } from '@google-cloud/vision';
import convert from 'color-convert';
import OpenAI from 'openai';

/* ── Google & OpenAI init ── */
const google = JSON.parse(process.env.GOOGLE_CLOUD_VISION_KEY);
const visionClient = new ImageAnnotatorClient({
  credentials: { client_email: google.client_email, private_key: google.private_key }
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = { api: { bodyParser: false } };

/* ── Button‑theme catalogue ── */
const buttonThemes = [
  { keywords:['More','Less'],   hue:[ 90,150], satMin:40 }, // neon green (PrizePicks)
  { keywords:['Higher','Lower'],hue:[170,210], satMin:35 }, // cyan (Underdog)
  { keywords:['Over','Under'],  hue:[350, 20], satMin:40 }  // red  (BetRivers etc.)
];

/* ── helpers ── */
const normalizeName = t =>
  t.normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^\w\s]/g,'').toLowerCase().trim();

const makeBox = v => {
  const xs=v.map(p=>p.x), ys=v.map(p=>p.y);
  const x=Math.min(...xs), y=Math.min(...ys);
  return { x, y, w:Math.max(...xs)-x, h:Math.max(...ys)-y };
};

const sampleHSV = async (buf, box) => {
  const {x,y,w,h}=box;
  const crop = await sharp(buf)
    .extract({ left:Math.floor(x+w*0.25), top:Math.floor(y+h*0.25),
               width:Math.max(4, w*0.5),  height:Math.max(4,h*0.5) })
    .resize(8,8).raw().toBuffer();

  const pixels=[];
  for (let i=0;i<crop.length;i+=3)
    pixels.push(convert.rgb.hsv.raw(crop[i],crop[i+1],crop[i+2]));
  return pixels;
};

const countSelectedPixels = (hsvPixels, { hue:[h1,h2], satMin }) =>
  hsvPixels.filter(([h,s]) =>
    (h1<h2 ? h>=h1&&h<=h2 : h>=h1||h<=h2) && s>=satMin).length;

/* Detect highlighted button per vertical row */
async function detectHighlighted(words, buf) {
  const colorMap = {};                         // approx Y → 'over' | 'under'

  for (const theme of buttonThemes) {
    const [topTxt, botTxt] = theme.keywords;   // top btn = “over”
    const tops = words.filter(w => new RegExp(`^${topTxt}$`, 'i').test(w.text));
    const bots = words.filter(w => new RegExp(`^${botTxt}$`, 'i').test(w.text));
    const pairs = Math.min(tops.length, bots.length);

    for (let i=0;i<pairs;i++) {
      const a = tops[i], b = bots[i];
      const hsvA = await sampleHSV(buf, a.box);
      const hsvB = await sampleHSV(buf, b.box);
      const selA = countSelectedPixels(hsvA, theme);
      const selB = countSelectedPixels(hsvB, theme);
      if (selA === selB) continue;             // ambiguous, skip
      const choice = selA > selB ? 'over' : 'under';
      colorMap[a.box.y] = choice;
      colorMap[b.box.y] = choice;
    }
  }
  return colorMap;
}

/* Nearest colour decision within ±50 px */
const nearestType = (y, colorMap) => {
  const keys = Object.keys(colorMap).map(n=>Number(n));
  const nearest = keys.sort((a,b)=>Math.abs(a-y)-Math.abs(b-y))[0];
  return Math.abs(nearest - y) <= 50 ? colorMap[nearest] : null;
};

/* ── main handler ── */
export default async function handler(req, res) {
  if (req.method !== 'POST')
    return res.status(405).json({ message:'Only POST allowed' });

  const form = new IncomingForm();
  form.parse(req, async (err, f, files) => {
    if (err) return res.status(500).json({ message:'Form error', err });

    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    if (!file) return res.status(400).json({ message:'No image uploaded' });

    try {
      const buf = fs.readFileSync(file.filepath);

      /* OCR */
      const [vis] = await visionClient.textDetection(buf);
      const anns  = vis.textAnnotations||[];
      const raw   = anns[0]?.description?.trim()||'';
      if (!raw) return res.status(200).json({ rawText:'', structuredBets:[] });

      const words = anns.slice(1).map(a=>({ text:a.description, box:makeBox(a.boundingPoly.vertices) }));
      const colorMap = await detectHighlighted(words, buf);

      /* Trim lines for GPT */
      const trimmed = raw.split('\n').slice(0,Math.ceil(raw.split('\n').length/2))
        .filter(l=>/\d+\.\d/.test(l)||/(points|rebounds|assists|3pt|pra)/i.test(l)
                ||/[A-Z][a-z]+\s[A-Z][a-z]+/.test(l))
        .join('\n')
        .replace(/3PTS/gi,'3PT made')
        .replace(/PTS/gi,'points')
        .replace(/REB/gi,'rebounds')
        .replace(/AST/gi,'assists')
        .replace(/PRA/gi,'points + rebounds + assists');

      /* GPT extraction */
      const gptPrompt = `
Extract player prop bets from this text:

---
${trimmed}
---

Return JSON only:
[{"player":"LeBron James","prop":"points","line":26.5,"type":"over"}]

Rules:
• More / Higher / Over  → "over"
• Less / Lower / Under → "under"
• Include a bet only if all four fields are clear.
• If none found, return [].
      `;
      const gpt = await openai.chat.completions.create({
        model:'gpt-4o', temperature:0, max_tokens:400,
        messages:[
          { role:'system', content:'Extract player props as pure JSON.' },
          { role:'user', content:gptPrompt }
        ]
      });
      let rawJson = gpt.choices[0].message.content.trim()
                     .replace(/^```json/i,'').replace(/```$/,'').trim();
      let bets; try { bets = JSON.parse(rawJson); } catch { bets = []; }

      /* Regex fallback */
      if (bets.length === 0) {
        const m = /([A-Z][a-z]+\s[A-Z][a-z]+).*?(\d+\.\d+)\s+(Points|Rebounds|Assists|3PT made|PRA)/is
                 .exec(trimmed);
        if (m) {
          const [, player, line, prop] = m;
          const wordLine = words.find(w => new RegExp(`${line}`.replace('.','\\.'),'i').test(w.text));
          const fallback = wordLine ? nearestType(wordLine.box.y, colorMap) || 'over' : 'over';
          bets = [{ player, prop, line: parseFloat(line), type: fallback }];
        }
      }

      /* Normalise + colour override */
      const final = bets.map(leg => {
        const base = leg.type.toLowerCase();
        let type = ['more','higher','over'].includes(base) ? 'over'
                 : ['less','lower','under'].includes(base) ? 'under' : base;

        const wordLine = words.find(w => new RegExp(`${leg.line}`.replace('.','\\.'),'i').test(w.text));
        if (wordLine) {
          const colType = nearestType(wordLine.box.y, colorMap);
          if (colType) type = colType;
        }

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
