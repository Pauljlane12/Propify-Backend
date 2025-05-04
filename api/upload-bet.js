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

/* ───────── Google / OpenAI init ───────── */
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

/* ───────── Bookmaker Detection Keywords ───────── */
// Add keywords for other bookmakers here as you expand
const bookmakerKeywords = [
    { bookmaker: "prizepicks", keywords: ["More", "Less"] },
    { bookmaker: "underdog", keywords: ["Higher", "Lower"] },
    // Add keywords for other bookmakers like FanDuel, Hard Rock, Fliff
    // { bookmaker: "fanduel", keywords: ["FanDuel"] },
    // { bookmaker: "hardrock", keywords: ["Hard Rock Bet"] },
    // { bookmaker: "fliff", keywords: ["Fliff"] },
];

/* ───────── Helpers ───────── */
const normalizeName = (t) =>
  t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")  // Remove accents
    .replace(/-/g, " ")          // ✅ Convert hyphens to space
    .replace(/[^\w\s]/g, "")          // Remove all other punctuation
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");           // Collapse multiple spaces


// Helper to normalize prop string (lowercase, remove spaces, fallback)
const normalizeProp = (prop) => {
    return prop?.toLowerCase().replace(/\s+/g, '') || 'unknown';
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
 * Basic text parsing logic for "simple" bookmakers (no GPT call).
 * This is a placeholder and needs significant refinement based on actual data.
 * @param {string} rawText - The full raw text from Google Vision.
 * @param {Array<Object>} words - Array of words with text and bounding boxes from Google Vision.
 * @returns {Array<Object>} - Array of structured bet legs [{ player, prop, line, type }].
 */
function parseSimpleBookmakerText(rawText, words) {
    console.log("Attempting simple text parsing for generic bookmaker...");
    const structuredBets = [];
    const lines = rawText.split('\n').filter(line => line.trim() !== ''); // Split into lines

    // Special parsing for Yes/No props like "DOUBLE DOUBLE", "TRIPLE DOUBLE"
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim().toLowerCase();

      if (line.includes("double double") || line.includes("triple double")) {
        const prop = line.includes("triple") ? "triple_double" : "double_double";

        // Search upwards for a valid player name (e.g., capitalized two-part name)
        for (let j = i - 1; j >= 0; j--) {
          const playerMatch = lines[j].match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/);
          if (playerMatch) {
            structuredBets.push({
              player: normalizeName(playerMatch[0]),
              prop,
              line: 0,             // No numeric line for binary props
              type: "yes_or_no",   // You can adjust this to "yes" or "over" if needed
            });
            break; // Stop after finding one match
          }
        }
      }
    }

    // This is a very basic example. Real parsing needs pattern matching,
    // potentially using word bounding boxes to group related words (player, prop, line, type).
    // You would need to analyze typical text structures from FanDuel, Hard Rock, Fliff, etc.

    // Example basic line-by-line parsing heuristic (highly unreliable for complex layouts):
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        console.log(`Parsing line ${i + 1}: "${line}"`);

        // Look for potential player name patterns (e.g., two capitalized words)
        const playerMatch = line.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/);
        if (playerMatch) {
            const player = playerMatch[0];

            // Look for potential line numbers (e.g., number with or without decimal)
            const lineMatch = line.match(/\d+\.?\d*/);
            if (lineMatch) {
                const lineValue = parseFloat(lineMatch[0]);

                // Look for "Over" or "Under" keywords near the line number
                let type = "unknown";
                if (line.toLowerCase().includes("over")) {
                    type = "over";
                } else if (line.toLowerCase().includes("under")) {
                    type = "under";
                }

                // Attempt to extract prop (this is very hard with simple regex)
                // You might need to look for common prop terms or use word proximity from the `words` array
                let prop = "unknown";
                // Basic heuristic: grab text between player and line/type (very fragile)
                  try {
                      const playerIndex = line.indexOf(player);
                      const lineIndex = line.indexOf(lineMatch[0], playerIndex + player.length); // Find line after player
                      if (playerIndex !== -1 && lineIndex !== -1 && lineIndex > playerIndex) {
                          prop = line.substring(playerIndex + player.length, lineIndex).trim();
                          // Clean up common prop abbreviations if necessary (still happens before full normalization)
                          prop = prop.replace(/3PTS/gi, "3PT made")
                                     .replace(/PTS/gi, "points")
                                     .replace(/REB/gi, "rebs") // Use 'rebs' for consistency? Or match input? Sticking to 'rebounds' based on snippet comment
                                     .replace(/AST/gi, "assists")
                                     .replace(/PRA/gi, "pra"); // Use 'pra' for consistency? Sticking to 'points + rebounds + assists' based on snippet comment
                      }
                  } catch (e) {
                      console.warn("Basic prop extraction failed:", e);
                      prop = "unknown";
                  }


                if (player && lineValue !== undefined) {
                    structuredBets.push({
                        player: normalizeName(player),
                        // --- Apply full prop normalization here ---
                        prop: normalizeProp(prop),
                        line: lineValue,
                        type: type,
                    });
                    console.log("Parsed simple bet:", structuredBets[structuredBets.length - 1]);
                }
            }
        }
    }

      if (structuredBets.length === 0) {
          console.warn("Simple text parsing found no structured bets.");
      }

    return structuredBets;
}


/* ───────── Main handler ───────── */
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


            /* ── OCR (Google Vision) ── */
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
            const bookmaker = detectBookmaker(words);
            console.log(`📩 Detected bookmaker: ${bookmaker}`);

            let structuredBets = [];

            /* ── Conditional Processing based on Bookmaker ── */

            // If it's a complex bookmaker (visual type indicator)
            if (["prizepicks", "underdog"].includes(bookmaker.toLowerCase())) {
                console.log(`Processing with GPT-4o Vision for ${bookmaker}...`);

                // Prompt for GPT-4o Vision
                const visionPrompt = `
You are an AI assistant specialized in parsing sports betting slips from images. Your task is to extract player prop bets from the provided image.

Analyze the image and identify each distinct player prop bet. For each bet, create a JSON object with the following keys:
-   \`player\`: The full name of the player involved in the bet.
-   \`prop\`: The specific statistic or event the bet is on (e.g., "points", "rebs", "asts", "pra", "3pt made", "strikeouts", "passing yards").
-   \`line\`: The numerical threshold or total for the prop (e.g., 25.5, 8.0, 1.5). Extract this value accurately and ensure it is a number (float or integer).
-   \`type\`: The direction of the bet relative to the line. Determine this by looking at which button ("More"/"Less" or "Higher"/"Lower") is visually highlighted (often by color). Use "over" if the "More"/"Higher" button is highlighted, and "under" if the "Less"/"Lower" button is highlighted. If the type is unclear from the visual cues, use "unknown".

Return a JSON array containing one object for each distinct player prop bet found. If no valid player prop bets can be identified in the image, return an empty JSON array \`[]\`.

Ensure your output is strictly a JSON array and nothing else.
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

                    let json = gptVisionResponse.choices[0].message.content.trim();
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
                        structuredBets = JSON.parse(json);
                        // Ensure the parsed result is actually an array
                        if (!Array.isArray(structuredBets)) {
                            console.warn("⚠️ GPT-4o Vision output was not a JSON array after parsing, defaulting to []. Output:", structuredBets);
                            structuredBets = [];
                        }
                        // Basic validation for each parsed leg AND apply prop normalization
                          structuredBets = structuredBets.filter(leg =>
                              leg.player && typeof leg.prop === 'string' && leg.prop.trim() !== '' &&
                              leg.line !== undefined && !isNaN(parseFloat(leg.line)) &&
                              ['over', 'under', 'unknown'].includes(leg.type?.toLowerCase?.()) // Validate type if present
                          ).map(leg => ({ // Normalize structure and values
                              player: leg.player.trim(),         // ✅ Keep full name intact (e.g., "Karl-Anthony Towns")
                              prop: normalizeProp(leg.prop),
                              line: parseFloat(leg.line),
                              type: leg.type?.toLowerCase?.() || 'unknown', // Default to unknown if type is missing
                          }));
                          if (structuredBets.length === 0 && Array.isArray(JSON.parse(json)) && JSON.parse(json).length > 0) {
                              console.warn("⚠️ Filtered out all legs from GPT-4o Vision output due to validation issues.");
                          }


                    } catch (e) {
                        console.error("⚠️ GPT-4o Vision output is not valid JSON or parsing failed:", e);
                        console.warn("⚠️ Defaulting structuredBets to []. GPT-4o Vision output:", json);
                        structuredBets = [];
                    }

                } catch (e) {
                    console.error("Error calling GPT-4o Vision API:", e);
                    // Fallback? Maybe try simple parsing or return an error?
                    console.warn("Falling back to simple text parsing due to GPT-4o Vision error.");
                    // Note: parseSimpleBookmakerText already applies normalization internally now
                    structuredBets = parseSimpleBookmakerText(raw, words); // Fallback
                }

            } else {
                // If it's a simple bookmaker (type explicit in text) or generic
                console.log(`Processing with simple text parsing for ${bookmaker}...`);
                // Use custom text parsing logic based on Vision OCR output
                  // Note: parseSimpleBookmakerText already applies normalization internally now
                structuredBets = parseSimpleBookmakerText(raw, words);
            }


            console.log(`📦 Final processed bets from ${bookmaker} (${structuredBets.length} legs):`, structuredBets);
            // Send the raw OCR text and the structured bet legs back to the frontend
            return res.status(200).json({ rawText: raw, structuredBets: structuredBets });

        } catch (e) {
            // Catch any errors during the process and return a 500 response
            console.error("upload‑bet processing error:", e);
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
