import { IncomingForm } from 'formidable';
import fs from 'fs';
import OpenAI from 'openai';

export const config = {
  api: {
    bodyParser: false,
  },
};

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests allowed' });
  }

  const form = new IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('❌ Form parse error:', err);
      return res.status(500).json({ message: 'Error parsing image', error: err });
    }

    const file = files.file?.[0];
    if (!file) {
      return res.status(400).json({ message: 'No image uploaded' });
    }

    try {
      const imageBase64 = fs.readFileSync(file.filepath, { encoding: 'base64' });

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a sports betting analyst. Extract player prop bet lines from a real screenshot image.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Look at this betting slip screenshot and extract only the **actual player props you clearly see in the image**.

❌ Do NOT invent or guess any props.  
❌ Do NOT return example players like "Jayson Tatum" unless they are actually visible.  
✅ Only return player props you can verify from the image.

Respond ONLY with a JSON array like this:
[
  { "player": "Player Name", "prop": "points", "line": 27.5, "type": "over" }
]`,
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${imageBase64}`,
                },
              },
            ],
          },
        ],
        max_tokens: 1000,
      });

      const raw = response.choices[0].message.content;
      console.log("🧠 GPT Raw Response:\n", raw);

      const cleaned = raw.trim()
        .replace(/^```json\n?/, '')
        .replace(/^```\n?/, '')
        .replace(/```$/, '');

      let parsed;
      try {
        parsed = JSON.parse(cleaned);
      } catch (err) {
        console.error("❌ Failed to parse GPT output:", err);
        return res.status(500).json({
          message: "GPT response was not valid JSON",
          raw: raw,
        });
      }

      // 🔁 Normalize “more/less” → “over/under”
      const cleanedParsed = parsed.map(leg => ({
        ...leg,
        type: leg.type?.toLowerCase() === 'more' ? 'over'
             : leg.type?.toLowerCase() === 'less' ? 'under'
             : leg.type
      }));

      console.log("📦 Cleaned Bet Legs:", cleanedParsed);

      // 🔁 Forward to fetch-insights
      const insightsRes = await fetch(`${process.env.VERCEL_URL}/api/fetch-insights`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanedParsed),
      });

      const insights = await insightsRes.json();
      console.log("📊 Fetched Insights:", insights);

      return res.status(200).json({ insights });

    } catch (error) {
      console.error("🔥 Upload handler failed:", error.message);
      return res.status(500).json({ message: 'Upload failed', error: error.message });
    }
  });
}

