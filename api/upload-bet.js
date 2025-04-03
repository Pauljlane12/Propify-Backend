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
            content: 'You are a sports betting analyst. Extract bet lines from a screenshot image.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Extract all player props from this screenshot. Return them as a JSON array like:
[
  { "player": "Jayson Tatum", "prop": "points", "line": 27.5, "type": "over" }
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

      return res.status(200).send(raw);
    } catch (error) {
      console.error("GPT Vision error:", error.message);
      return res.status(500).json({ message: 'GPT-4o Vision failed', error: error.message });
    }
  });
}
