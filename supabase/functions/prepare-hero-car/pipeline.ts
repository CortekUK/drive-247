/**
 * prepare-hero-car — the work itself, kept apart from auth and storage so the
 * exact same code can be run against a test photo from a script.
 *
 * An operator's photo of their car becomes a showroom car for the booking
 * site's hero (Template 2, `home_hero.hero_cars`):
 *
 *   1. cut-out   OpenAI's image edit model lifts the car off its background,
 *                onto transparency, at 1536px. It REDRAWS the picture rather
 *                than masking it, which is also what makes a small or soft
 *                photo come back sharp — and why the result is always shown
 *                to the operator before it goes live (details such as plates
 *                or badges can come back changed).
 *   2. tidy      the transparent margins are cropped to the car, plus a little
 *                breathing room, so every car fills the stage the same way.
 *   3. read      a vision model names the car and its paint, picks the
 *                scene colour (the paint as a hex; the hero tones it down
 *                itself, so it never strays far from the template's own), and
 *                flags problems with the photo for the operator.
 */

import { decode, Image } from "https://deno.land/x/imagescript@1.3.0/mod.ts";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
const EDIT_MODEL = "gpt-image-1";
const VISION_MODEL = "gpt-4o-mini";

/** Breathing room kept around the car after the crop, as a share of its size. */
const PAD = 0.04;

/* The prompts are written up, with why each part is there, in
   docs/hero-car-ai-prompts.md. Keep the two word for word the same. */
const CUTOUT_PROMPT = `This is a photo of a rental car. Turn it into a clean studio cut-out of the same car for a car rental website.

Keep only the car. Remove everything else: the ground, grass, road, walls, buildings, trees, sky, people, other vehicles, signs, poles, cones, chargers, price tags and any text or watermark on the photo. Make the background fully transparent.

Remove anything that covers part of the car and rebuild what was hidden so the car is whole: grass or leaves over the tyres, a person or pole in front of a door, a car cut off at the edge of the photo.

The windows must not show the scene behind the car. Replace anything seen through or reflected in the glass with plain dark tinted glass.

Keep the car exactly as it is. The same make and model, body shape, paint colour and finish, wheels, brake calipers, lights, badges, trim and camera angle. Do not restyle, modify, tune or "improve" the car, and do not change its colour.

Blank the number plate: keep the plate but leave it with no characters.

Light it like a studio product shot: soft, even, neutral white light with natural highlights on the paint. Remove dirt, dust and water spots. No coloured light, no lens flare, no ground, no shadow under the car, no reflection of the old surroundings.

Show the whole car, centred, filling most of the width of the image, with nothing cropped off. High resolution, sharp edges, photographic, not a drawing or a 3D render.`;

const READ_PROMPT = `You look at a photo of a rental car for a booking website.

name: the make and model, such as "Ford Explorer ST". Only when you are confident; otherwise an empty string. Never guess a trim level you cannot see.

paint: the body paint in plain words, such as "Gloss black" or "Pearl white".

color: the body paint as a #rrggbb hex. Read the painted panels only, not the glass, tyres, wheels, lights, chrome, reflections, sky or background. For black, white, grey or silver paint give that neutral as it really is; do not invent a hue. The website tones this colour down itself, so give the true paint, not a lighter or prettier one.

issues: problems the operator should know about before using this photo, chosen from: "no_car", "several_cars", "car_cut_off", "car_hidden", "too_small", "blurry", "too_dark", "inside_showroom_glare". An empty list when the photo is fine.`;

export const PHOTO_ISSUES = [
  "no_car",
  "several_cars",
  "car_cut_off",
  "car_hidden",
  "too_small",
  "blurry",
  "too_dark",
  "inside_showroom_glare",
] as const;
export type PhotoIssue = (typeof PHOTO_ISSUES)[number];

export type HeroCarReading = {
  /** "Ford Explorer ST", or "" when the model cannot tell. */
  name: string;
  /** "Gloss black". */
  paint: string;
  /** The paint as "#rrggbb": the hero's scene colour. */
  color: string;
  /** What the operator should check before using the photo; empty when fine. */
  issues: PhotoIssue[];
};

export type PreparedHeroCar = HeroCarReading & {
  /** The cut-out, cropped to the car: a PNG with transparency. */
  png: Uint8Array;
  width: number;
  height: number;
};

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
};

const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

async function openAiError(response: Response, step: string): Promise<Error> {
  const body = await response.text().catch(() => "");
  let message = body.slice(0, 300);
  try {
    message = JSON.parse(body)?.error?.message ?? message;
  } catch { /* not JSON */ }
  return new Error(`${step} failed (${response.status}): ${message}`);
}

/** 1. The car on a transparent background, redrawn sharp. */
export async function cutOut(photo: Uint8Array, mimeType: string, apiKey: string): Promise<Uint8Array> {
  const form = new FormData();
  form.append("model", EDIT_MODEL);
  form.append("image", new Blob([photo], { type: mimeType }), `car.${mimeType.split("/")[1] ?? "png"}`);
  form.append("prompt", CUTOUT_PROMPT);
  form.append("background", "transparent");
  form.append("output_format", "png");
  form.append("quality", "high");
  form.append("input_fidelity", "high");
  form.append("size", "1536x1024");

  const response = await fetch(`${OPENAI_BASE_URL}/images/edits`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!response.ok) throw await openAiError(response, "Background removal");
  const json = await response.json();
  const b64 = json?.data?.[0]?.b64_json;
  if (!b64) throw new Error("Background removal returned no image");
  return fromBase64(b64);
}

/** 2. Crop to the car (anything at least faintly opaque), plus a little room. */
export async function cropToCar(png: Uint8Array): Promise<{ png: Uint8Array; width: number; height: number }> {
  const image = await decode(png);
  if (!(image instanceof Image)) throw new Error("The cut-out is not a still image");

  let [left, top, right, bottom] = [image.width, image.height, -1, -1];
  for (let y = 1; y <= image.height; y += 1) {
    for (let x = 1; x <= image.width; x += 1) {
      if ((image.getPixelAt(x, y) & 0xff) < 24) continue; // RGBA: alpha is the low byte
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < 0) throw new Error("No car was found in the photo");

  const padX = Math.round((right - left) * PAD);
  const padY = Math.round((bottom - top) * PAD);
  const x = Math.max(1, left - padX);
  const y = Math.max(1, top - padY);
  const width = Math.min(image.width, right + padX) - x + 1;
  const height = Math.min(image.height, bottom + padY) - y + 1;

  const cropped = image.crop(x - 1, y - 1, width, height);
  return { png: await cropped.encode(1), width, height };
}

/** 3. What the car is, and the colour the hero's scene should take from it. */
export async function readCar(photo: Uint8Array, mimeType: string, apiKey: string): Promise<HeroCarReading> {
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VISION_MODEL,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "hero_car",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["name", "paint", "color", "issues"],
            properties: {
              name: { type: "string" },
              paint: { type: "string" },
              color: { type: "string" },
              issues: { type: "array", items: { type: "string", enum: [...PHOTO_ISSUES] } },
            },
          },
        },
      },
      messages: [
        { role: "system", content: READ_PROMPT },
        {
          role: "user",
          content: [{ type: "image_url", image_url: { url: `data:${mimeType};base64,${toBase64(photo)}`, detail: "low" } }],
        },
      ],
    }),
  });
  if (!response.ok) throw await openAiError(response, "Reading the car");
  const json = await response.json();
  const reading = JSON.parse(json?.choices?.[0]?.message?.content ?? "{}") as Partial<HeroCarReading>;
  const color = /^#[0-9a-f]{6}$/i.test(reading.color ?? "") ? reading.color!.toLowerCase() : "#c4cdda";
  const issues = (reading.issues ?? []).filter((issue): issue is PhotoIssue => PHOTO_ISSUES.includes(issue as PhotoIssue));
  return { name: (reading.name ?? "").trim(), paint: (reading.paint ?? "").trim(), color, issues };
}

/** The whole thing: photo in, showroom car out. The two OpenAI calls run side by side. */
export async function prepareHeroCar(photo: Uint8Array, mimeType: string, apiKey: string): Promise<PreparedHeroCar> {
  const [cutout, reading] = await Promise.all([cutOut(photo, mimeType, apiKey), readCar(photo, mimeType, apiKey)]);
  const tidy = await cropToCar(cutout);
  return { ...reading, ...tidy };
}
