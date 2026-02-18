import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { chatCompletion } from '../_shared/openai.ts'

/**
 * Bonzah Vehicle Eligibility Check
 *
 * Uses OpenAI gpt-4o-mini to fuzzy-match vehicle make/model against
 * Bonzah's excluded vehicles list. Fail-open: if AI fails, vehicle is eligible.
 */

// Full brand exclusions — any vehicle of these makes is ineligible
const EXCLUDED_BRANDS = [
  'Alfa Romeo', 'Aston Martin', 'Auburn', 'Avanti', 'Bentley', 'Bertone',
  'BMC/Leyland', 'BMW', 'Bradley', 'Bricklin', 'Bugatti', 'Clenet',
  'Cosworth', 'De Lorean', 'Excalibre', 'Ferrari', 'Iso', 'Jaguar',
  'Jensen Healy', 'Koenigsegg', 'Lamborghini', 'Lancia', 'Lotus',
  'Maserati', 'Maybach', 'McLaren', 'MG', 'Morgan', 'Pagani', 'Pantera',
  'Panther', 'Pininfarina', 'Porsche', 'Rolls Royce', 'Rover', 'Stutz',
  'Sterling', 'Triumph', 'TVR',
]

// Specific model exclusions — only these models, not the entire brand
const EXCLUDED_MODELS = [
  { make: 'Mercedes', models: ['G-Wagon', 'G-Class', 'S-Class', 'AMG (any AMG variant)'] },
  { make: 'Chevrolet', models: ['Corvette'] },
  { make: 'Tesla', models: ['Cybertruck'] },
]

const SYSTEM_PROMPT = `You are a vehicle insurance eligibility checker. Your job is to determine whether a given vehicle is eligible for Bonzah rental insurance coverage.

A vehicle is NOT eligible if it matches any of the following exclusion rules:

## Full Brand Exclusions (ANY vehicle of these makes is ineligible):
${EXCLUDED_BRANDS.join(', ')}

## Specific Model Exclusions (only these specific models are ineligible, other models from the same brand ARE eligible):
${EXCLUDED_MODELS.map(e => `- ${e.make}: ${e.models.join(', ')}`).join('\n')}

## Important matching rules:
- Use fuzzy matching: "Merc", "MB", "Mercedes-Benz", "Mercedes Benz" all match "Mercedes"
- "Rolls-Royce", "Rolls Royce", "RR" all match "Rolls Royce"
- "DeLorean", "De Lorean", "DMC" all match "De Lorean"
- "Chevy" matches "Chevrolet"
- For Mercedes AMG: ANY model with "AMG" in it is excluded (e.g. "C63 AMG", "AMG GT", "GLE 63 AMG")
- For Mercedes G-Class: "G-Wagon", "G-Class", "G500", "G550", "G63", "G65" etc. are all excluded
- For Mercedes S-Class: "S-Class", "S500", "S550", "S600", "S63", "S65" etc. are all excluded
- A regular Mercedes C-Class, E-Class, GLC, etc. WITHOUT AMG designation IS eligible

Respond with ONLY valid JSON in this exact format:
{"eligible": true} or {"eligible": false, "reason": "brief explanation"}

Do NOT include any text outside the JSON object.`

interface EligibilityRequest {
  vehicle_make: string
  vehicle_model: string
}

serve(async (req) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const body: EligibilityRequest = await req.json()

    if (!body.vehicle_make || !body.vehicle_model) {
      return errorResponse('Missing required fields: vehicle_make, vehicle_model')
    }

    console.log('[Bonzah Eligibility] Checking:', body.vehicle_make, body.vehicle_model)

    try {
      const response = await chatCompletion(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Vehicle Make: ${body.vehicle_make}\nVehicle Model: ${body.vehicle_model}` },
        ],
        { temperature: 0, max_tokens: 150 }
      )

      const content = response.choices?.[0]?.message?.content?.trim()
      console.log('[Bonzah Eligibility] AI response:', content)

      if (!content) {
        console.warn('[Bonzah Eligibility] Empty AI response, failing open')
        return jsonResponse({ eligible: true })
      }

      const parsed = JSON.parse(content)

      if (typeof parsed.eligible !== 'boolean') {
        console.warn('[Bonzah Eligibility] Invalid response format, failing open')
        return jsonResponse({ eligible: true })
      }

      return jsonResponse({
        eligible: parsed.eligible,
        ...(parsed.reason && { reason: parsed.reason }),
      })
    } catch (aiError) {
      // Fail-open: never block insurance due to AI/parsing failure
      console.error('[Bonzah Eligibility] AI error, failing open:', aiError)
      return jsonResponse({ eligible: true })
    }
  } catch (error) {
    console.error('[Bonzah Eligibility] Request error:', error)
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to check vehicle eligibility',
      500
    )
  }
})
