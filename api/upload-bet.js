/**
 * /api/upload-bet.js
 * Tiered player-prop extractor using Google Vision OCR and GPT-4o Vision
 *
 * This script processes uploaded betting slip screenshots.
 * It first uses Google Vision OCR to get text and detect the bookmaker.
 * - For complex bookmakers (like Prizepicks, Underdog) where bet type is visual,
 * it sends the image to GPT-4o Vision for detailed visual parsing.
 * - For simpler bookmakers where bet type is explicit in text,
 * it uses custom text parsing logic based on Vision OCR output (no GPT call).
 */
import { IncomingForm } from "formidable";
import fs from "fs";
import sharp from "sharp"; // Used for potential image processing like base64 conversion
import { ImageAnnotatorClient } from "@google-cloud/vision";
import OpenAI from "openai";

/* ━━━━━━━━━ Google / OpenAI init ━━━━━━━━━ */
// Ensure your GOOGLE_CLOUD_VISION_KEY is correctly formatted JSON string in your environment variables
try {
    var google = JSON.parse(process.env.GOOGLE_CLOUD_VISION_KEY);
} catch (e) {
    console.error("Failed to parse GOOGLE_CLOUD_VISION_KEY:", e);
    // In a real application, you might want to throw an error or exit here
}

const visionClient = new ImageAnnotatorClient({
    credentials: {
        client_email: google.client_email,
        private_key: google.private_key.replace(/\\n/g, '\n'), // Handle potential newline character escaping
    },
});
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const config = { api: { bodyParser: false } };

/* ━━━━━━━━━ Bookmaker Detection Keywords ━━━━━━━━━ */
// Add keywords for other bookmakers here as you expand
const bookmakerKeywords = [
    { bookmaker: "prizepicks", keywords: ["More", "Less"] },
    { bookmaker: "underdog", keywords: ["Higher", "Lower"] },
    // Add keywords for other bookmakers like FanDuel, Hard Rock, Fliff
    // { bookmaker: "fanduel", keywords: ["FanDuel"] },
    // { bookmaker: "hardrock", keywords: ["Hard Rock Bet"] },
    // { bookmaker: "fliff", keywords: ["Fliff"] },
];

/* ━━━━━━━━━ Helpers ━━━━━━━━━ */
const normalizeName = (t) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // Remove accents
    .replace(/-/g, " ")           // ✅ Convert hyphens to space
    .replace(/[^\w\s]/g, "")         // Remove all other punctuation
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");           // Collapse multiple spaces


// Helper to normalize prop string (lowercase, remove spaces, fallback)
const normalizeProp = (prop) => {
    return prop?.toLowerCase().replace(/\s+/g, '') || 'unknown';
};

// Helper to extract opponent team from text patterns like "vs DAL", "@ PHI", etc.
const extractOpponentTeam = (text) => {
    console.log("🔍 Extracting opponent team from text:", text);
    
    // Common patterns for opponent teams in betting slips
    const patterns = [
        /(?:vs\.?\s+|@\s+|against\s+)([A-Z]{2,4})\b/gi,  // "vs DAL", "@ PHI", "against BOS"
        /\b([A-Z]{2,4})\s+(?:vs\.?|@)\s+[A-Z]{2,4}\b/gi, // "PHI vs DAL" format
        /\b[A-Z]{2,4}\s+(?:vs\.?|@)\s+([A-Z]{2,4})\b/gi, // "DAL @ PHI" format
    ];
    
    for (const pattern of patterns) {
        const matches = [...text.matchAll(pattern)];
        if (matches.length > 0) {
            const opponent = matches[0][1];
            console.log(`✅ Found opponent team: ${opponent}`);
            return opponent;
        }
    }
    
    console.log("❌ No opponent team found in text");
    return null;
};


const makeBox = (v) => {
    const xs = v.map((p) => p.x),
        ys = v.map((p) => p.y);
    const x = Math.min(...xs),
        y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/**
 * Detects the bookmaker based on keywords found in the OCR'd words.
 * @param {Array<Object>} words - Array of words with text and bounding boxes from Google Vision.
 * @returns {string} - The detected bookmaker name ('prizepicks', 'underdog', 'generic', etc.).
 */
function detectBookmaker(words) {
    const text = words.map(w => w.text).join(" "); // Join all words into a single string for easier searching
    const lowerText = text.toLowerCase();

    for (const bm of bookmakerKeywords) {
        // Check if any of the bookmaker's keywords are present in the text
        const hasKeyword = bm.keywords.some(keyword =>
            lowerText.includes(keyword.toLowerCase())
        );
        if (hasKeyword) {
            // You might want more sophisticated logic here, e.g., requiring multiple keywords or checking proximity
            console.log(`Detected bookmaker "${bm.bookmaker}" based on keyword(s).`);
            return bm.bookmaker;
        }
    }

    console.log("No specific bookmaker keywords detected. Using 'generic'.");
    return "generic"; // Default if no specific keywords are found
}

/**
 * Simple bookmaker parser – now with solid DOUBLE/TRIPLE DOUBLE fallback
 */
function parseSimpleBookmakerText(rawText, words) {
  console.log("Attempting simple text parsing for generic bookmaker…");

  const structuredBets = [];
  const lines = rawText.split("\n").filter((l) => l.trim() !== "");

  /* --------- A)  TRY NUMERIC–PROP LOGIC (unchanged) --------- */
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    console.log(`Parsing line ${i + 1}: "${line}"`);

    const playerMatch = line.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/);
    if (!playerMatch) continue;

    const player = playerMatch[0];
    const numMatch = line.match(/\d+\.?\d*/);
    if (!numMatch) continue;

    const lineValue = parseFloat(numMatch[0]);
    let type = "unknown";
    if (line.toLowerCase().includes("over")) type = "over";
    else if (line.toLowerCase().includes("under")) type = "under";

    // crude prop extraction between player name & number
    let prop = "unknown";
    try {
      const pIdx = line.indexOf(player);
      const nIdx = line.indexOf(numMatch[0], pIdx + player.length);
      if (pIdx !== -1 && nIdx !== -1 && nIdx > pIdx) {
        prop = line
          .substring(pIdx + player.length, nIdx)
          .trim()
          .replace(/3PTS?/gi, "3pt made")
          .replace(/PTS/gi, "points")
          .replace(/REB/gi, "rebs") // Use 'rebs' for consistency? Or match input? Sticking to 'rebounds' based on snippet comment
          .replace(/AST/gi, "assists")
          .replace(/PRA/gi, "pra"); // Use 'pra' for consistency? Sticking to 'points + rebounds + assists' based on snippet comment
      }
    } catch (_) {}

    structuredBets.push({
      player: normalizeName(player),
      prop: normalizeProp(prop),
      line: lineValue,
      type,
    });
  }

  /* ----------- B)  FALLBACK FOR DOUBLE / TRIPLE DOUBLE ----------- */
  if (structuredBets.length === 0) {
    const doubleIdx = lines.findIndex((l) =>
      l.toLowerCase().includes("double double")
    );
    const tripleIdx = lines.findIndex((l) =>
      l.toLowerCase().includes("triple double")
    );

    const idx = tripleIdx !== -1 ? tripleIdx : doubleIdx;
    if (idx !== -1) {
      const prop = tripleIdx !== -1 ? "triple_double" : "double_double";

      /* Look upward for nearest player name line */
      let player = "";
      for (let j = idx - 1; j >= 0; j--) {
        const line = lines[j].trim();

        // Allow either Pascal Case (e.g., LeBron James) or ALL CAPS (e.g., ALPEREN SENGUN)
        const isLikelyName =
          /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)+$/.test(line) || // Title case
          /^[A-Z]+(?:\s[A-Z]+)+$/.test(line);             // ALL CAPS

        if (isLikelyName && !/yes|no/i.test(line)) {
          player = normalizeName(line); // normalizeName handles all formatting
          break;
        }
      }

      if (player) {
        structuredBets.push({
          player,
          prop,
          line: 0,
          type: "yes",
        });
        console.log(`✅ Fallback parsed ${prop} for ${player}`);
      } else {
        console.warn("Found DOUBLE/TRIPLE DOUBLE but could not locate player.");
      }
    }
  }

  if (structuredBets.length === 0) {
    console.warn("Simple text parsing found no structured bets.");
  }

  return structuredBets;
}

/* ━━━━━━━━━ Main handler ━━━━━━━━━ */
export default async function handler(req, res) {
    if (req.method !== "POST")
        return res.status(405).json({ message: "Only POST allowed" });

    // Configure formidable to handle file uploads
    const form = new IncomingForm({
        keepExtensions: true, // Keep file extensions
        maxFileSize: 10 * 1024 * 1024, // Limit file size to 10MB
    });

    form.parse(req, async (err, _fields, files) => {
        if (err) {
            console.error("Form parse error:", err);
            return res.status(500).json({ message: "Form error", err });
        }

        // Get the uploaded file object
        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        if (!file) {
            console.warn("No image file uploaded.");
            return res.status(400).json({ message: "No image uploaded" });
        }

        let uploadedFilePath = file.filepath; // Store filepath for cleanup
        let imageBase64 = null; // To store base64 if needed for GPT-4o Vision

        try {
            // Read the uploaded image file into a buffer
            const buf = fs.readFileSync(uploadedFilePath);
            console.log(`Received file: ${file.originalFilename}, size: ${buf.length} bytes`);

            // Convert buffer to base64 for GPT-4o Vision if needed later
            imageBase64 = buf.toString('base64');


            /* ━━ OCR (Google Vision) ━━ */
            // Perform text detection on the image buffer
            const [vis] = await visionClient.textDetection(buf);
            const anns = vis.textAnnotations || [];
            // The first annotation is the full text detected
            const raw = anns[0]?.description?.trim() || "";
            if (!raw) {
                console.warn("Google Vision found no text in the image.");
                return res.status(200).json({ rawText: "", structuredBets: [] });
            }
            console.log("Google Vision raw text extracted:\n---\n", raw, "\n---");

            // Extract individual words with their bounding boxes (skip the first full text annotation)
            const words = anns.slice(1).map((a) => ({
                text: a.description,
                box: makeBox(a.boundingPoly.vertices),
            }));
            // console.log("Google Vision words with boxes:", words); // Uncomment for detailed word/box data


            // Detect the bookmaker based on keywords present in Vision output
            let bookmaker = detectBookmaker(words); // Use let instead of const here as we might reassign

            const normalizedRawText = raw.toLowerCase();
            const forceGptForDoubleProps = normalizedRawText.includes("double double") || normalizedRawText.includes("triple double");
            if (forceGptForDoubleProps) {
                console.log("📸 Forcing GPT-4o Vision due to detected double/triple double keyword...");
                bookmaker = "forced_gpt_double"; // optional override
            }

            console.log(`📩 Detected bookmaker: ${bookmaker}`); // Log the potentially updated bookmaker

           let structuredBets = [];

            /* ━━ Conditional Processing based on Bookmaker ━━ */

            // If it's a complex bookmaker (visual type indicator) or forced for doubles/triples
            if (["prizepicks", "underdog", "forced_gpt_double"].includes(bookmaker.toLowerCase())) {
                console.log(`Processing with GPT-4o Vision for ${bookmaker}...`);

                // Prompt for GPT-4o Vision
                const visionPrompt = `
You are an AI assistant specialized in parsing sports betting slips from images. Your task is to extract player prop bets from the provided image.

Analyze the image and identify each distinct player prop bet. For each bet, create a JSON object with the following keys:
-   \`player\`: The full name of the player involved in the bet.
-   \`prop\`: The specific statistic or event the bet is on (e.g., "points", "rebs", "asts", "pra", "3pt made", "strikeouts", "passing yards").
-   \`line\`: The numerical threshold or total for the prop (e.g., 25.5, 8.0, 1.5). Extract this value accurately and ensure it is a number (float or integer).
-   \`type\`: The direction of the bet relative to the line. Determine this by looking at which button ("More"/"Less" or "Higher"/"Lower") is visually highlighted (often by color). Use "over" if the "More"/"Higher" button is highlighted, and "under" if the "Less"/"Lower" button is highlighted. If the type is unclear from the visual cues, use "unknown".
-   \`opponentTeam\`: Look for opponent team information in patterns like "vs DAL", "@ PHI", "against BOS". Extract the team abbreviation (e.g., "DAL", "PHI", "BOS"). If no opponent team is found, omit this field.

Return a JSON array containing one object for each distinct player prop bet found. If no valid player prop bets can be identified in the image, return an empty JSON array \`[]\`.

Ensure your output is strictly a JSON array and nothing else.

If a bet type includes "double double" or "triple double", extract it with:
- "prop": "double_double" or "triple_double"
- "type": "yes" or "no" depending on what's visually selected
- Do NOT include a "line" field for these props, since they don't have one
                `;

                try {
                    const gptVisionResponse = await openai.chat.completions.create({
                        model: "gpt-4o", // Use gpt-4o which supports Vision
                        temperature: 0,
                        max_tokens: 1000, // Adjust as needed
                        messages: [
                            {
                                role: "system",
                                content: "You are an AI assistant specialized in parsing sports betting slips from images. Your output must be a valid JSON array.",
                            },
                            {
                                role: "user",
                                content: [
                                    { type: "text", text: visionPrompt },
                                    {
                                        type: "image_url",
                                        image_url: { "url": `data:image/jpeg;base64,${imageBase64}` },
                                    },
                                ],
                            },
                        ],
                    });

                    let json = gptVisionResponse.choices?.[0]?.message?.content?.trim() || '';
                    // Remove markdown code block formatting if present
                    if (json.startsWith('```json')) {
                        json = json.substring(7);
                    }
                    if (json.endsWith('```')) {
                        json = json.slice(0, -3);
                    }
                    json = json.trim();

                    console.log("🧠 GPT-4o Vision raw output:\n---\n", json, "\n---");

                    try {
                        const parsedGptVision = JSON.parse(json);
                        // Ensure the parsed result is actually an array
                        if (Array.isArray(parsedGptVision)) {
                            structuredBets = parsedGptVision.filter(leg =>
                                leg.player && typeof leg.prop === 'string' && leg.prop.trim() !== '' &&
                                // Note: We no longer require 'line' for double/triple doubles based on prompt update
                                (leg.prop === 'double_double' || leg.prop === 'triple_double' || (leg.line !== undefined && !isNaN(parseFloat(leg.line)))) &&
                                ['over', 'under', 'yes', 'no', 'unknown'].includes(leg.type?.toLowerCase?.()) // Validate type if present, added 'yes', 'no'
                            ).map(leg => ({ // Normalize structure and values
                                player: normalizeName(leg.player),     // Use normalizeName as suggested
                                prop: normalizeProp(leg.prop),
                                // Only include line if it's a numeric prop
                                ...(leg.prop !== 'double_double' && leg.prop !== 'triple_double' && { line: parseFloat(leg.line) }),
                                type: leg.type?.toLowerCase?.() || 'unknown', // Default to unknown if type is missing
                                // Include opponent team if extracted
                                ...(leg.opponentTeam && { opponentTeam: leg.opponentTeam.toUpperCase() }),
                            }));
                            console.log("✅ GPT-4o Vision parse succeeded:", structuredBets);

                        } else {
                            console.warn("⚠️ GPT-4o Vision output was not a JSON array after parsing. Output:", parsedGptVision);
                        }


                    } catch (e) {
                        console.error("⚠️ GPT-4o Vision output is not valid JSON or parsing failed:", e);
                        console.warn("⚠️ GPT-4o Vision raw output was:", json);
                        // structuredBets remains []
                    }

                } catch (e) {
                    console.error("Error calling GPT-4o Vision API:", e);
                    console.warn("Falling back to simple text parsing due to GPT-4o Vision error.");
                    // structuredBets remains []
                }

            }

            // If GPT-4o Vision didn't produce results OR it wasn't triggered, try simple text parsing
            if (structuredBets.length === 0) {
                console.log(`Processing with simple text parsing for ${bookmaker}...`);
                // Note: parseSimpleBookmakerText now handles its own double/triple fallback if it fails
                const simpleParsedBets = parseSimpleBookmakerText(raw, words);
                
                // Extract opponent team from the raw text for simple parsing
                const opponentTeam = extractOpponentTeam(raw);
                
                // Add opponent team to each bet if found
                structuredBets = simpleParsedBets.map(bet => ({
                    ...bet,
                    ...(opponentTeam && { opponentTeam: opponentTeam.toUpperCase() }),
                }));
            }


            // GPT-3.5 fallback for simple Over/Under props if structuredBets is still empty
            if (structuredBets.length === 0 && (normalizedRawText.includes('over') || normalizedRawText.includes('under'))) {
                console.log("🧪 Triggering GPT-3.5 fallback to extract simple Over/Under player props...");

              const fallbackPrompt = `
Here is text from a sports betting slip:
---
${raw.split('\n').slice(0, 12).join('\n')}
---
Your job:
Extract only the player prop bets and return them in this format:
[
  { "player": "LeBron James", "prop": "points", "line": 26.5, "type": "over" }
]
Rules:
- If the word "Over" is near a player's stat, that means "over".
- If the word "Under" is near a player's stat, that means "under".
- The stat should be one of: points, rebounds, assists, pra, 3pt made, etc.
- Do NOT guess or invent anything.
- If no valid bet is found, return []
`;

              try {
                const fallbackGpt = await openai.chat.completions.create({
                  model: "gpt-3.5-turbo",
                  temperature: 0,
                  max_tokens: 500,
                  messages: [
                    { role: "system", content: "You are a betting slip parser. Respond ONLY with valid JSON." },
                    { role: "user", content: fallbackPrompt }
                  ]
                });

                let rawJson = fallbackGpt.choices?.[0]?.message?.content?.trim() || '';
                rawJson = rawJson.replace(/^```json\s*/i, '').replace(/```$/, '').trim();

                const fallbackParsed = JSON.parse(rawJson);
                if (Array.isArray(fallbackParsed)) {
                  // Apply the same normalization as the GPT-4o parsing path
                  const fallbackWithOpponent = fallbackParsed.filter(leg =>
                        leg.player && typeof leg.prop === 'string' && leg.prop.trim() !== '' &&
                        // GPT-3.5 fallback is specifically for numeric lines, so require 'line'
                        (leg.line !== undefined && !isNaN(parseFloat(leg.line))) &&
                        ['over', 'under', 'unknown'].includes(leg.type?.toLowerCase?.()) // Validate type
                    ).map(leg => ({ // Normalize structure and values
                        player: normalizeName(leg.player),
                        prop: normalizeProp(leg.prop),
                        line: parseFloat(leg.line),
                        type: leg.type?.toLowerCase?.() || 'unknown',
                    }));
                    
                  // Extract opponent team from the raw text
                  const opponentTeam = extractOpponentTeam(raw);
                  
                  // Add opponent team to each bet if found
                  structuredBets = fallbackWithOpponent.map(bet => ({
                      ...bet,
                      ...(opponentTeam && { opponentTeam: opponentTeam.toUpperCase() }),
                  }));
                  
                  console.log("✅ GPT-3.5 fallback succeeded:", structuredBets);
                } else {
                   console.warn("⚠️ GPT-3.5 fallback output was not a JSON array after parsing. Output:", fallbackParsed);
                }


              } catch (err) {
                console.warn("⚠️ GPT-3.5 fallback failed:", err);
                // structuredBets remains []
              }
            }


            console.log(`📦 Final processed bets from ${bookmaker} (${structuredBets.length} legs):`, structuredBets);
            // Send the raw OCR text and the structured bet legs back to the frontend
            return res.status(200).json({ rawText: raw, structuredBets: structuredBets });

        } catch (e) {
            // Catch any errors during the process and return a 500 response
            console.error("upload–bet processing error:", e);
            return res.status(500).json({ message: "Server error during processing", error: e.message });
        } finally {
            // Clean up the uploaded file from the server's temporary storage
            if (uploadedFilePath) {
                fs.unlink(uploadedFilePath, (err) => {
                    if (err) console.error("Error removing uploaded file:", err);
                    else console.log(`Cleaned up uploaded file: ${uploadedFilePath}`);
                });
            }
        }
    });
} 
