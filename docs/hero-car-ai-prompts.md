# Hero car AI prompts

The prompts the portal uses to turn an operator's photo of their car into a showroom car for the booking site's hero (Template 2). An operator uploads any photo: a car park, a driveway, a phone snap. The AI hands back the same car, cut out, cleaned up and sharp, ready to stand on the hero's glass. It also returns the car's name and the colour the hero's background should take from it.

The code that sends these prompts is `supabase/functions/prepare-hero-car/pipeline.ts`. **If you change a prompt here, change it there too**: the two must stay word for word the same.

## How it runs

| Step | Who does it | What happens |
|---|---|---|
| 1. Clean-up | OpenAI image edit (Prompt 1) | Removes the background and every extra item, and redraws the car sharp on a transparent background |
| 2. Read | OpenAI vision (Prompt 2) | Names the car, gives the paint colour for the hero background, flags problems with the photo |
| 3. Resize | Our code, not the AI | Crops to the car and keeps a 4% margin, so every car fills the hero the same way |
| 4. Approve | The operator | Sees the result next to their original and chooses to use it. Nothing goes live on its own |

Steps 1 and 2 run at the same time. Both read the **original** photo.

---

## Prompt 1: clean up the photo (image edit)

**Settings** (`POST /v1/images/edits`):

| Setting | Value | Why |
|---|---|---|
| `model` | `gpt-image-1` | OpenAI's image edit model |
| `background` | `transparent` | The hero needs the car on nothing |
| `output_format` | `png` | Keeps the transparency |
| `quality` | `high` | This is what makes it HD |
| `input_fidelity` | `high` | Stays closer to the real car |
| `size` | `1536x1024` | Landscape, which suits a car side-on or three-quarter |

**Prompt:**

```text
This is a photo of a rental car. Turn it into a clean studio cut-out of the same car for a car rental website.

Keep only the car. Remove everything else: the ground, grass, road, walls, buildings, trees, sky, people, other vehicles, signs, poles, cones, chargers, price tags and any text or watermark on the photo. Make the background fully transparent.

Remove anything that covers part of the car and rebuild what was hidden so the car is whole: grass or leaves over the tyres, a person or pole in front of a door, a car cut off at the edge of the photo.

The windows must not show the scene behind the car. Replace anything seen through or reflected in the glass with plain dark tinted glass.

Keep the car exactly as it is. The same make and model, body shape, paint colour and finish, wheels, brake calipers, lights, badges, trim and camera angle. Do not restyle, modify, tune or "improve" the car, and do not change its colour.

Blank the number plate: keep the plate but leave it with no characters.

Light it like a studio product shot: soft, even, neutral white light with natural highlights on the paint. Remove dirt, dust and water spots. No coloured light, no lens flare, no ground, no shadow under the car, no reflection of the old surroundings.

Show the whole car, centred, filling most of the width of the image, with nothing cropped off. High resolution, sharp edges, photographic, not a drawing or a 3D render.
```

### Why each part is there

- **"Keep only the car…"** lists the items that actually turn up in rental photos: chargers, cones, price tags, other cars on the forecourt.
- **"Rebuild what was hidden"** is for tyres sunk in grass and bumpers cut off by the frame. A plain cutout tool leaves those wavy or missing.
- **Windows:** a cutout tool keeps the scenery seen through or reflected in the glass, here trees in the windows. On the hero that looks like a hole in the car.
- **"Keep the car exactly as it is"** matters because the image model redraws the picture, so without this it drifts: different wheels, a cleaner bodykit, a brighter paint. The customer has to get the car they saw.
- **Number plate:** blanked for the operator's privacy and because a real plate on a marketing image ages badly. If an operator wants theirs kept, delete that sentence.
- **No ground and no shadow:** the hero draws its own floor shadow and spotlight, and a second shadow from the photo would double up.
- **"Not a drawing or a 3D render"** stops the glossy CGI look the model drifts towards on `quality: high`.

---

## Prompt 2: name the car and pick the hero colour (vision)

**Settings** (`POST /v1/chat/completions`): model `gpt-4o-mini`, `temperature: 0`, image `detail: low`, with a JSON schema as the response format so the answer is always valid.

**System prompt:**

```text
You look at a photo of a rental car for a booking website.

name: the make and model, such as "Ford Explorer ST". Only when you are confident; otherwise an empty string. Never guess a trim level you cannot see.

paint: the body paint in plain words, such as "Gloss black" or "Pearl white".

color: the body paint as a #rrggbb hex. Read the painted panels only, not the glass, tyres, wheels, lights, chrome, reflections, sky or background. For black, white, grey or silver paint give that neutral as it really is; do not invent a hue. The website tones this colour down itself, so give the true paint, not a lighter or prettier one.

issues: problems the operator should know about before using this photo, chosen from: "no_car", "several_cars", "car_cut_off", "car_hidden", "too_small", "blurry", "too_dark", "inside_showroom_glare". An empty list when the photo is fine.
```

**Response schema:**

```json
{
  "name": "string",
  "paint": "string",
  "color": "#rrggbb",
  "issues": ["no_car" | "several_cars" | "car_cut_off" | "car_hidden" | "too_small" | "blurry" | "too_dark" | "inside_showroom_glare"]
}
```

### How the answer is used

- `color` becomes the hero's background colour for that car (`color` in `home_hero.hero_cars`). The hero blends only a hint of it into our own backdrop, so the page never strays far from the template's colours. The operator can change it.
- `name` fills the large name behind the car. The operator can edit or clear it.
- `issues` appear as warnings next to the preview, such as "Part of the car is out of the photo. The AI rebuilt it, so check the result." With `no_car` the cutout is not offered at all.

---

## What the operator checks before using it

The image model redraws the photo; it doesn't just cut it out. That's how it removes clutter and makes a small photo sharp, but small details can come back different. The portal shows the original and the result side by side, and asks the operator to check:

- It's the same car: same model, wheels and colour.
- Nothing is missing or added: mirrors, spoiler, badges.
- The tyres and the bottom of the car look natural.
- The name and the background colour are right.

If the result is wrong, the operator can try again, which gives a new attempt, or upload a better photo. A clear photo of the whole car, side-on or three-quarter, in daylight, gives the best result.
