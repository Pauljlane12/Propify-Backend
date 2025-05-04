/**
 * /api/upload-bet.js
 * Dynamic player‑prop extractor using Google Vision OCR and GPT-4o Vision.
 * Includes an implemented simple text parser for 'generic' bookmakers
 * that attempts to handle common patterns like Player Name, Prop, Line, Type.
 * Now attempts to recognize "DOUBLE DOUBLE" bets.
 */
import { IncomingForm } from "formidable";
import fs from "fs";
import sharp from "sharp";
import { ImageAnnotatorClient } from "@google-cloud/vision";
import OpenAI from "openai";

/* ───────── Google / OpenAI init ───────── */
// Ensure your GOOGLE_CLOUD_VISION_KEY is correctly formatted JSON string in your environment variables
// Added checks for process.env existence before parsing/initializing
let google = null;
if (process.env.GOOGLE_CLOUD_VISION_KEY) {
    try {
        google = JSON.parse(process.env.GOOGLE_CLOUD_VISION_KEY);
    } catch (e) {
        console.error("Failed to parse GOOGLE_CLOUD_VISION_KEY:", e);
        // In a real application, you might want to throw an error or exit here
    }
} else {
    console.warn("GOOGLE_CLOUD_VISION_KEY environment variable is not set.");
}


const visionClient = google ? new ImageAnnotatorClient({
    credentials: {
        client_email: google.client_email,
        // Replace escaped newline characters in the private key
        private_key: google.private_key ? google.private_key.replace(/\\n/g, '\n') : undefined,
    },
}) : null; // Initialize only if google credentials are valid


const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null; // Initialize only if API key is present
if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY environment variable is not set. GPT-4o Vision will not be available.");
}


export const config = { api: { bodyParser: false } };

/* ───────── Button‑theme catalogue ───────── */
const buttonThemes = [
    {
        bookmaker: "prizepicks",
        keywords: ["More", "Less"],
        selected: { r: [0, 110], g: [170, 255], b: [0, 120] }, // Green range for Prizepicks "More"
    },
    {
        bookmaker: "underdog",
        keywords: ["Higher", "Lower"],
        selected: { r: [0, 80], g: [180, 255], b: [200, 255] }, // Blue range for Underdog "Higher"
    },
];

/* ───────── Helpers ───────── */
// ✅ IMPROVED: Normalize name to handle hyphens and apostrophes
const normalizeName = (t) => {
    if (typeof t !== 'string') return ''; // Handle non-string input gracefully
    return t
        .normalize("NFD") // Normalize to NFD form (e.g., é -> e´)
        .replace(/[\u0300-\u036f]/g, "") // Remove diacritical marks (accents)
        // Keep letters, numbers, spaces, hyphens, and apostrophes
        .replace(/[^\w\s'-]/g, "") // <<-- CHANGED: Added '-' and "'" to allowed characters
        .toLowerCase()
        .trim()
        .replace(/\s+/g, " "); // Collapse multiple spaces into a single space
};


// Helper to normalize prop string (lowercase, remove spaces, fallback)
const normalizeProp = (prop) => {
    if (typeof prop !== 'string') return 'unknown'; // Handle non-string input
    // Standardize common prop names after normalization
    const normalized = prop.toLowerCase().replace(/\s+/g, '');
    switch(normalized) {
        case 'doubledouble': return 'double_double';
        case 'tripledouble': return 'triple_double';
        case 'pts': case 'points': return 'points';
        case 'reb': case 'rebounds': return 'rebounds';
        case 'ast': case 'assists': return 'assists';
        case 'stl': case 'steals': return 'steals';
        case 'blk': case 'blocks': return 'blocks';
        case 'to': case 'turnovers': return 'turnovers';
        case '3pt': case '3ptmade': case 'threesmade': return 'fg3m';
        case 'fgm': case 'fieldgoalsmade': return 'fgm';
        case 'fga': case 'fieldgoalsattempted': return 'fga';
        case 'fg3a': case '3ptattempted': case 'threesattempted': return 'fg3a';
        case 'ftm': case 'freethrowsmade': return 'ftm';
        case 'fta': case 'freethrowsattempted': return 'fta';
        case 'oreb': case 'offensiverebounds': return 'oreb';
        case 'dreb': case 'defensiverebounds': return 'dreb';
        case 'pra': case 'pointsreboundsassists': return 'pra';
        case 'pr': case 'pointsrebounds': return 'pr';
        case 'pa': case 'pointsassists': return 'pa';
        case 'ra': case 'reboundsassists': return 'ra';
        default: return normalized || 'unknown'; // Return normalized string if not a common one
    }
};


const makeBox = (v) => {
    // Ensure v is an array and has valid points
    if (!Array.isArray(v) || v.length === 0) {
        console.warn("⚠️ Invalid input for makeBox:", v);
        return { x: 0, y: 0, w: 0, h: 0 }; // Return a zero-size box for invalid input
    }
    const xs = v.map((p) => p?.x).filter(x => typeof x === 'number' && !isNaN(x)); // Filter out invalid coordinates
    const ys = v.map((p) => p?.y).filter(y => typeof y === 'number' && !isNaN(y)); // Filter out invalid coordinates

    if (xs.length === 0 || ys.length === 0) {
         console.warn("⚠️ No valid coordinates in makeBox input:", v);
         return { x: 0, y: 0, w: 0, h: 0 };
    }

    const x = Math.min(...xs);
    const y = Math.min(...ys);
    // Ensure width and height are non-negative
    const w = Math.max(...xs) - x;
    const h = Math.max(...ys) - y;

    return { x, y, w: Math.max(0, w), h: Math.max(0, h) }; // Ensure non-negative width/height
};

const rgbInRange = (rgb, rng) =>
    rgb && rgb.length === 3 &&
    rgb[0] >= rng.r[0] &&
    rgb[0] <= rng.r[1] &&
    rgb[1] >= rng.g[0] &&
    rgb[1] <= rng.g[1] &&
    rgb[2] >= rng.b[0] &&
    rgb[2] <= rng.b[1];

const sampleRGB = async (buf, box) => {
    if (!buf || !box || box.w <= 0 || box.h <= 0) {
         console.warn("⚠️ Invalid buffer or box for sampleRGB:", { buf: !!buf, box });
         return null; // Cannot sample invalid box or buffer
    }

    const { x, y, w, h } = box;
    // Sample a 6x6 area near the center of the box
    const sampleSize = 6;
    const sampleX = Math.max(0, Math.floor(x + w * 0.4));
    const sampleY = Math.max(0, Math.floor(y + h * 0.4));

    try {
        const imgMetadata = await sharp(buf).metadata();
         // Ensure sample area is within image bounds
        const safeX = Math.max(0, Math.min(sampleX, (imgMetadata.width || 0) - sampleSize));
        const safeY = Math.max(0, Math.min(sampleY, (imgMetadata.height || 0) - sampleSize));
        const safeWidth = Math.min(sampleSize, (imgMetadata.width || 0) - safeX);
        const safeHeight = Math.min(sampleSize, (imgMetadata.height || 0) - safeY);

         if (safeWidth <= 0 || safeHeight <= 0) {
             console.warn(`⚠️ Calculated safe sample area is zero or negative: ${safeX},${safeY},${safeWidth}x${safeHeight}. Original box: ${JSON.stringify(box)}. Using fallback 1x1 sample.`);
             // Fallback to a 1x1 sample at the box center if the 6x6 area is invalid
             const fallbackX = Math.max(0, Math.min(Math.floor(x + w/2), (imgMetadata.width || 0) - 1));
             const fallbackY = Math.max(0, Math.min(Math.floor(y+h/2), (imgMetadata.height || 0) - 1));
             if (fallbackX < 0 || fallbackY < 0) {
                 console.error("Fallback sampleRGB failed: Invalid fallback coordinates.");
                 return null;
             }
             return await sharp(buf)
                 .extract({ left: fallbackX, top: fallbackY, width: 1, height: 1 })
                 .raw()
                 .toBuffer()
                 .then(pix => (pix && pix.length >= 3 ? [pix[0], pix[1], pix[2]] : null)) // Ensure pix has enough data
                 .catch(e => { console.error("Fallback sampleRGB failed", e); return null; }); // Return null on fallback error
         }


        const pix = await sharp(buf)
            .extract({
                left: safeX,
                top: safeY,
                width: safeWidth, // Use safe dimensions
                height: safeHeight, // Use safe dimensions
            })
            .resize(1, 1) // Average the area into 1 pixel
            .raw()
            .toBuffer();
        return (pix && pix.length >= 3 ? [pix[0], pix[1], pix[2]] : null); // Ensure pix has enough data
    } catch (e) {
        console.error("Error in sampleRGB:", e);
        return null; // Return null on error
    }
};


// REVISED detectHighlighted function for better row association
async function detectHighlighted(words, imgBuf) {
    console.log("🎨 Starting color detection...");
    const rowChoices = {}; // Map: line_y -> 'over' | 'under'
    const yTolerance = 8; // Vertical tolerance in pixels to consider words on the same line

    // Group words into potential rows based on vertical proximity
    const rows = [];
    const sortedWords = [...words].sort((a, b) => a.box.y - b.box.y); // Sort words vertically
    for (const word of sortedWords) {
        let addedToRow = false;
        // Attempt to add the word to an existing row
        for (const row of rows) {
            // Calculate the average Y of words currently in this row
            const rowAvgY = row.reduce((sum, w) => sum + w.box.y, 0) / row.length;
            // If the word's Y is within tolerance of the row's average Y, add it
            if (Math.abs(word.box.y - rowAvgY) <= yTolerance) {
                row.push(word);
                addedToRow = true;
                break;
            }
        }
        // If the word wasn't added to any existing row, start a new row with it
        if (!addedToRow) {
            rows.push([word]);
        }
    }

    console.log(`🎨 Grouped ${words.length} words into ${rows.length} potential rows.`);

    // Process each identified row
    for (const rowWords of rows) {
        let detectedChoice = null;
        let lineNumberY = null; // This will store the Y coordinate of the line number in this row

        // First, try to find the line number within this row. We need its Y for the map key.
        // Look for a word that looks like a number, potentially with a decimal.
         const lineWord = rowWords.find(w => {
             const num = parseFloat(w.text);
             // Check if it's a valid number within a reasonable range for betting lines (e.g., > 0 and < 1000)
             // Also, ensure the text is primarily numeric characters and possibly one decimal point.
             return !isNaN(num) && num > 0 && num < 1000 && /^\d*\.?\d+$/.test(w.text);
         });


        if (lineWord) {
            lineNumberY = lineWord.box.y;
            // console.log(`🎨 Found potential line number '${lineWord.text}' at Y=${lineNumberY} in a row.`);

            // Now, look for button keywords and highlighted colors within this same row
            for (const theme of buttonThemes) {
                const [keyA, keyB] = theme.keywords; // keyA is "More"/"Higher", keyB is "Less"/"Lower"

                // Find button words that are specifically within this row
                const btnA = rowWords.find((w) => new RegExp(`^${keyA}$`, "i").test(w.text));
                const btnB = rowWords.find((w) => new RegExp(`^${keyB}$`, "i").test(w.text));

                if (btnA && btnB) { // Found both buttons in this row
                    console.log(`🎨 Checking buttons (${btnA.text}, ${btnB.text}) near line Y=${lineNumberY}`);
                    const rgbA = await sampleRGB(imgBuf, btnA.box);
                    const rgbB = await sampleRGB(imgBuf, btnB.box);

                     if (!rgbA || !rgbB) {
                         console.warn(`⚠️ Failed to sample RGB for buttons in row with line Y=${lineNumberY}. Skipping color check for this row.`);
                         continue; // Skip color check if sampling failed
                     }

                    const selA = rgbInRange(rgbA, theme.selected);
                    const selB = rgbInRange(rgbB, theme.selected);

                    console.log(`🎨 ${btnA.text} RGB: [${rgbA}], InRange: ${selA} | ${btnB.text} RGB: [${rgbB}], InRange: ${selB}`);

                    // Determine the choice based on which button is highlighted (only one should be)
                    if (selA && !selB) { // Button A (More/Higher) is highlighted
                        detectedChoice = "over";
                        console.log(`🎨 Detected OVER by color for row with line Y=${lineNumberY}`);
                        break; // Found the choice for this row by color
                    } else if (selB && !selA) { // Button B (Less/Lower) is highlighted
                        detectedChoice = "under";
                        console.log(`🎨 Detected UNDER by color for row with line Y=${lineNumberY}`);
                        break; // Found the choice for this row by color
                    } else if (selA && selB) {
                        console.warn(`⚠️ Both buttons highlighted in row with line Y=${lineNumberY}. Cannot determine choice by color.`);
                        // If both are highlighted, we can't reliably use color for this row.
                    } else {
                        console.log(`🎨 Neither button highlighted in row with line Y=${lineNumberY}.`);
                    }
                }
            }
        } else {
             // If no clear line number was found in this row, we cannot reliably map a color choice to a line.
             // console.log("🎨 No line number found in this row. Skipping color detection mapping for this row.");
        }

        // If a choice was confidently detected by color for this row, map it using the line number's Y coordinate
        if (detectedChoice && lineNumberY !== null) {
            // Store the detected choice, keyed by the line number's Y coordinate.
            rowChoices[lineNumberY] = detectedChoice;
        }
    }
    console.log("🎨 Color detection complete. Mapped choices (line_y -> type):", rowChoices);
    return rowChoices; // colorMap now maps line_y to choice
}

// fuzzyColorMapMatch function remains similar
function fuzzyColorMapMatch(colorMap, y) {
    // Find the closest key (Y coordinate of a detected line number) in the colorMap to the given Y
    let closestKey = null;
    let minDiff = Infinity;
    const tolerance = 10; // Tolerance in pixels for matching the line Y to a key in the colorMap

    for (const keyStr in colorMap) {
        const keyY = parseInt(keyStr, 10); // Ensure key is parsed as an integer
        const diff = Math.abs(keyY - y);
        // Check if the difference is within tolerance AND it's the closest key found so far
        if (diff <= tolerance && diff < minDiff) {
            minDiff = diff;
            closestKey = keyStr;
        }
    }

    if (closestKey !== null) {
         console.log(`🎨 Found fuzzy color map match for GPT line Y=${y} at OCR line Y=${closestKey}. Diff: ${minDiff}`);
        return colorMap[closestKey];
    }
     console.log(`🎨 No fuzzy color map match found for GPT line Y=${y} within tolerance ${tolerance}.`);
    return null;
}

/**
 * Implemented simple text parsing logic for 'generic' bookmakers using OCR words and raw text.
 * Attempts to identify player, prop, line, and type based on text patterns and word positions.
 * This is a heuristic-based parser and may not be 100% accurate for all layouts.
 * @param {string} rawText - The full raw text from Google Vision.
 * @param {Array<Object>} words - Array of words with text and bounding boxes from Google Vision.
 * @returns {Array<Object>} - Array of structured bet legs [{ player, prop, line, type }].
 */
function parseSimpleBookmakerText(rawText, words) {
    console.log("Attempting simple text parsing for generic bookmaker...");
    const structuredBets = [];
    const lines = rawText.split('\n').filter(line => line.trim() !== ''); // Split into lines

    // --- Heuristics for identifying bet components ---
    // This is a simplified example; real-world parsing might need more advanced techniques
    // like analyzing word clusters based on bounding boxes.

    let currentPlayer = null;
    let currentProp = null;
    let currentLine = null;
    let currentType = null;

    // Keywords to look for specific prop types
    const propKeywords = [
        { key: 'double double', prop: 'double_double' },
        { key: 'triple double', prop: 'triple_double' },
        { key: 'points', prop: 'points' },
        { key: 'rebounds', prop: 'rebounds' },
        { key: 'assists', prop: 'assists' },
        { key: 'steals', prop: 'steals' },
        { key: 'blocks', prop: 'blocks' },
        { key: 'turnovers', prop: 'turnovers' },
        // Add other common prop keywords here
    ];

    // Keywords for bet direction/type
    const typeKeywords = ['yes', 'no', 'over', 'under', 'more', 'less', 'higher', 'lower'];


    // Iterate through lines to find patterns
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const lowerLine = line.toLowerCase();
        console.log(`Parsing line ${i + 1}: "${line}"`);

        // 1. Look for Player Name (Heuristic: Line with capitalized words, often near the top)
        // This is a very basic heuristic; could be improved by checking word positions
        const playerMatch = line.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+/);
        if (playerMatch && i <= 5) { // Assume player name is in the first few lines
             // Check if this line is likely a player name by looking for nearby prop keywords in subsequent lines
             let isLikelyPlayer = false;
             for(let j = i + 1; j < Math.min(i + 4, lines.length); j++) { // Look in next few lines
                 const nextLowerLine = lines[j].toLowerCase();
                 if (propKeywords.some(pk => nextLowerLine.includes(pk.key))) {
                     isLikelyPlayer = true;
                     break;
                 }
             }
             if (isLikelyPlayer) {
                 currentPlayer = playerMatch[0];
                 console.log(`   Found potential player: "${currentPlayer}"`);
                 // Reset other variables when a new player is found
                 currentProp = null;
                 currentLine = null;
                 currentType = null;
                 continue; // Move to the next line
             }
        }

        // 2. Look for Prop Type (Heuristic: Line containing specific prop keywords)
        const foundProp = propKeywords.find(pk => lowerLine.includes(pk.key));
        if (foundProp && currentPlayer) { // Only look for prop if a player has been identified
            currentProp = foundProp.key; // Use the keyword as the prop string
            console.log(`   Found potential prop: "${currentProp}"`);

            // For "DOUBLE DOUBLE" or "TRIPLE DOUBLE", the line is typically 1
            if (currentProp === 'double double' || currentProp === 'triple double') {
                 currentLine = 1;
                 console.log(`   Inferred line: ${currentLine} for ${currentProp}`);
            }

            // Look for Type keyword in the same line or the next line
            const typeMatch = typeKeywords.find(tk => lowerLine.includes(tk));
            if (typeMatch) {
                 currentType = typeMatch;
                 console.log(`   Found potential type: "${currentType}"`);
            } else if (i + 1 < lines.length) { // Check the next line
                 const nextLowerLine = lines[i+1].toLowerCase();
                 const nextTypeMatch = typeKeywords.find(tk => nextLowerLine.includes(tk));
                 if (nextTypeMatch) {
                     currentType = nextTypeMatch;
                     console.log(`   Found potential type in next line: "${currentType}"`);
                 }
            }

             // If we have a player and a prop, try to extract line and type if not found yet
             if (currentPlayer && currentProp) {
                 // Look for a number in the line that could be the line value (if prop isn't DD/TD)
                 if (currentProp !== 'double double' && currentProp !== 'triple double') {
                     const lineMatch = line.match(/\d+\.?\d*/);
                     if (lineMatch) {
                         currentLine = parseFloat(lineMatch[0]);
                         console.log(`   Found potential line: ${currentLine}`);
                     }
                 }

                 // Look for type keywords again in the same line if not found
                 if (!currentType) {
                      const typeMatch = typeKeywords.find(tk => lowerLine.includes(tk));
                      if (typeMatch) {
                          currentType = typeMatch;
                          console.log(`   Found potential type: "${currentType}"`);
                      }
                 }
             }

            // If we have identified Player, Prop, Line, and Type, structure the bet
            // For Double Double/Triple Double, line is 1, type is often "Yes"
            // For other props, line and type need to be extracted from text
            if (currentPlayer && currentProp && currentLine !== null && currentType !== null) {
                structuredBets.push({
                    player: normalizeName(currentPlayer), // Normalize the extracted name
                    prop: normalizeProp(currentProp), // Normalize the extracted prop
                    line: parseFloat(currentLine), // Ensure line is a number
                    type: currentType.toLowerCase(), // Use the found type
                });
                console.log("   ✅ Structured bet:", structuredBets[structuredBets.length - 1]);

                // Reset for the next bet leg
                currentPlayer = null;
                currentProp = null;
                currentLine = null;
                currentType = null;
                continue; // Move to the next line
            }
        }

        // 3. Look for Line and Type if Prop was found earlier but not Line/Type in the same line
        // This part is complex and highly dependent on layout.
        // A more robust approach would involve analyzing word positions (using the 'words' array)
        // to find numbers and keywords near the identified player/prop words.
        // For this basic implementation, we primarily rely on finding all components on the same line as the prop,
        // or inferring line for DD/TD.

        // If we have a player and prop but haven't structured the bet yet,
        // look for line/type in the current line if it wasn't found on the prop line.
        if (currentPlayer && currentProp && (currentLine === null || currentType === null)) {
             const lineMatch = line.match(/\d+\.?\d*/);
             if (lineMatch && currentLine === null) {
                 currentLine = parseFloat(lineMatch[0]);
                 console.log(`   Found potential line in a different line: ${currentLine}`);
             }
             const typeMatch = typeKeywords.find(tk => lowerLine.includes(tk));
             if (typeMatch && currentType === null) {
                  currentType = typeMatch;
                  console.log(`   Found potential type in a different line: "${currentType}"`);
             }

             // If we now have all components, structure the bet
             if (currentPlayer && currentProp && currentLine !== null && currentType !== null) {
                 structuredBets.push({
                     player: normalizeName(currentPlayer),
                     prop: normalizeProp(currentProp),
                     line: parseFloat(currentLine),
                     type: currentType.toLowerCase(),
                 });
                 console.log("   ✅ Structured bet (components found across lines):", structuredBets[structuredBets.length - 1]);

                 // Reset for the next bet leg
                 currentPlayer = null;
                 currentProp = null;
                 currentLine = null;
                 currentType = null;
                 continue; // Move to the next line
             }
        }

        // Add more heuristics here for other common patterns...

    } // End of line iteration

    // --- Post-processing and Validation ---
    // Filter out any incomplete or invalid bets that might have been partially identified
    const finalStructuredBets = structuredBets.filter(bet =>
        bet.player && bet.prop !== 'unknown' && bet.line !== undefined && bet.line !== null && bet.type !== 'unknown'
    );

    if (finalStructuredBets.length === 0) {
        console.warn("Simple text parsing found no complete structured bets.");
    } else {
         console.log("Simple text parsing results:", finalStructuredBets);
    }


    return finalStructuredBets;
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
            // Only convert if OpenAI is initialized (meaning API key is available)
            if (openai) {
                imageBase64 = buf.toString('base64');
            }


            /* ── OCR (Google Vision) ── */
            // Perform text detection on the image buffer
            // Only run Vision if the client was initialized
            if (!visionClient) {
                 console.error("Google Vision client not initialized. Cannot perform OCR.");
                 return res.status(500).json({ message: "Server configuration error: Google Vision not available." });
            }
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


            // Detect the bookmaker based on keywords present
            const bookmaker = detectBookmaker(words);
            console.log(`📩 Detected bookmaker: ${bookmaker}`);

            // Perform color detection to identify highlighted buttons IF it's a supported bookmaker
            // This generates a map where keys are the Y-coordinates of line numbers and values are 'over' or 'under'.
            const colorMap =
                ["prizepicks", "underdog"].includes(bookmaker.toLowerCase()) // Ensure case-insensitivity
                    ? await detectHighlighted(words, buf)
                    : {};


            /* ── Conditional Processing based on Bookmaker (GPT-4o Vision vs Simple Parse) ── */
            let structuredBets = [];

            // If it's a complex bookmaker (visual type indicator) AND OpenAI is available AND image data is available
            if (["prizepicks", "underdog"].includes(bookmaker.toLowerCase()) && openai && imageBase64) {
                console.log(`Processing with GPT-4o Vision for ${bookmaker}...`);

                // Prompt for GPT-4o Vision
                const visionPrompt = `
You are an AI assistant specialized in parsing sports betting slips from images. Your task is to extract player prop bets from the provided image.

Analyze the image and identify each distinct player prop bet. For each bet, create a JSON object with the following keys:
-   \`player\`: The full name of the player involved in the bet.
-   \`prop\`: The specific statistic or event the bet is on (e.g., "points", "rebounds", "assists", "points + rebounds + assists", "3PT made", "strikeouts", "passing yards", "double double", "triple double").
-   \`line\`: The numerical threshold or total for the prop (e.g., 25.5, 8.0, 1.5). Extract this value accurately and ensure it is a number (float or integer). For Double Double or Triple Double, the line is typically 1.
-   \`type\`: The direction of the bet relative to the line. Determine this by looking at which button ("More"/"Less" or "Higher"/"Lower") is visually highlighted (often by color). Use "over" if the "More"/"Higher" button is highlighted, and "under" if the "Less"/"Lower" button is highlighted. For Yes/No bets like Double Double, use "yes" or "no". If the type is unclear from the visual cues, use "unknown".

Return a JSON array containing one object for each distinct player prop bet found. If no valid player prop bets can be identified in the image, return an empty JSON array \`[]\`.

Ensure your output is strictly a JSON array and nothing else.
                `;

                try {
                    const gptVisionResponse = await openai.chat.completions.create({
                        model: "gpt-4o", // Using gpt-4o, capable of understanding the text context well.
                        temperature: 0, // Keep temperature low for consistent output
                        max_tokens: 1000, // Increased max_tokens to allow for multiple bets
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
                        // Parse the cleaned JSON string into a JavaScript array
                        let parsedJson = JSON.parse(json);
                         // Ensure the parsed result is actually an array
                         if (!Array.isArray(parsedJson)) {
                             console.warn("⚠️ GPT-4o Vision output was not a JSON array after parsing, defaulting to []. Output:", parsedJson);
                             parsedJson = [];
                         }

                         // Apply normalization and validation after parsing
                         structuredBets = parsedJson.map(leg => {
                             // Apply the IMPROVED normalizeName to the player name from GPT
                             // We keep the full name from GPT for better matching in downstream APIs
                             const playerNameFromGPT = leg.player ? leg.player.trim() : '';

                             // Apply normalization to prop for consistency
                             const normalizedProp = normalizeProp(leg.prop); // Use the helper

                             // Determine type, prioritizing color override if available
                             const txtType = leg.type?.toLowerCase?.() || "";
                             let finalType = null;
                             if (["more", "higher", "over"].includes(txtType)) {
                                 finalType = "over";
                             } else if (["less", "lower", "under"].includes(txtType)) {
                                 finalType = "under";
                             } else if (["yes"].includes(txtType)) { // Handle Yes/No types from GPT
                                 finalType = "yes";
                             } else if (["no"].includes(txtType)) {
                                 finalType = "no";
                             }


                             /* try color override */
                             // Find the word in the original OCR output (`words`) that corresponds to the line value identified by GPT (`leg.line`).
                             const lineValueString = `${leg.line}`;
                             const lineRegex = new RegExp(`^${lineValueString.replace(".", "\\.")}`, "i");
                             const matchingLineWords = words.filter(w => lineRegex.test(w.text));
                             let bestLineWord = null;
                             if (matchingLineWords.length === 1) {
                                 bestLineWord = matchingLineWords[0];
                             } else if (matchingLineWords.length > 1) {
                                 // Simple heuristic fallback: take the first match
                                 bestLineWord = matchingLineWords[0];
                                 console.warn(`Multiple OCR words (${matchingLineWords.length}) match line value "${leg.line}". Using the first match for color lookup.`);
                             }

                             if (bestLineWord) {
                                 const override = fuzzyColorMapMatch(colorMap, bestLineWord.box.y);
                                 if (override) {
                                     console.log(`🎨 Color override applied for leg "${playerNameFromGPT} ${normalizedProp} ${leg.line}": ${override}`);
                                     finalType = override; // Color detection result takes precedence
                                 }
                             } else {
                                 console.warn(`⚠️ Could not find OCR word for line value ${leg.line}. Cannot apply color override for leg "${playerNameFromGPT} ${normalizedProp}".`);
                             }

                             // Validate and return the structured leg
                             // Check for required fields. Line is optional for Yes/No bets like DD/TD.
                             if (!playerNameFromGPT || normalizedProp === '' || finalType === 'unknown') {
                                 console.warn("⚠️ Skipping malformed leg after GPT parse (missing player, prop, or type):", leg);
                                 return null; // Skip this leg if it's missing critical information
                             }

                             // For Yes/No bets, the line is typically 1 if not explicitly provided by GPT
                             let finalLine = parseFloat(leg.line);
                             if (isNaN(finalLine) && (normalizedProp === 'double_double' || normalizedProp === 'triple_double')) {
                                 finalLine = 1;
                                 console.log(`   Inferred line: ${finalLine} for ${normalizedProp}`);
                             } else if (isNaN(finalLine)) {
                                  console.warn(`⚠️ Line is missing or invalid for prop "${normalizedProp}":`, leg.line);
                                  return null; // Line is required for non-DD/TD bets if not provided
                             }


                             return {
                                 player: playerNameFromGPT, // Use the player name string directly from GPT
                                 prop: normalizedProp, // Use the normalized prop
                                 line: finalLine,
                                 type: finalType, // Use the determined type ('over', 'under', 'yes', 'no', 'unknown')
                             };
                         }).filter(leg => leg !== null); // Filter out any null entries (malformed legs)


                    } catch (e) {
                        console.error("⚠️ GPT-4o Vision output is not valid JSON or parsing failed:", e);
                        console.warn("⚠️ Defaulting structuredBets to []. GPT-4o Vision output:", json);
                        structuredBets = [];
                    }

                } catch (e) {
                    console.error("Error calling GPT-4o Vision API:", e);
                    // Fallback to simple text parsing if GPT-4o Vision fails
                    console.warn("Falling back to simple text parsing due to GPT-4o Vision error.");
                    // Note: Fallback calls parseSimpleBookmakerText which also applies normalization
                    structuredBets = parseSimpleBookmakerText(raw, words); // Fallback
                }

            } else {
                // If it's a simple bookmaker (type explicit in text) or generic,
                // or if OpenAI is not available.
                console.log(`Processing with simple text parsing for ${bookmaker} (or OpenAI not available)...`);
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
