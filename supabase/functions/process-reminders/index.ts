import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)

    console.log('Starting reminder processing at:', new Date().toISOString())

    // Get settings
    const { data: settings } = await supabase
      .from('reminder_settings')
      .select('setting_key, setting_value')
    
    const settingsMap = settings?.reduce((acc, s) => {
      acc[s.setting_key] = s.setting_value
      return acc
    }, {} as Record<string, any>) || {}

    const respectCreditCoverage = settingsMap.respect_credit_coverage === true
    const upcomingEnabled = settingsMap.upcoming_enabled === true
    const dueEnabled = settingsMap.due_enabled === true
    const overdueEnabled = settingsMap.overdue_enabled === true
    const maxOverdueReminders = settingsMap.max_overdue_reminders || 4

    // Get pending charges
    const { data: charges } = await supabase.rpc('get_pending_charges_for_reminders')
    
    if (!charges) {
      console.log('No charges found')
      return new Response(JSON.stringify({ processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    let processed = 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (const charge of charges) {
      const dueDate = new Date(charge.due_date)
      dueDate.setHours(0, 0, 0, 0)
      
      const daysDiff = Math.floor((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      
      // Apply credit coverage logic
      if (respectCreditCoverage && charge.customer_balance >= charge.remaining_amount) {
        console.log(`Skipping charge ${charge.charge_id} - covered by credit`)
        continue
      }

      let reminderType: string | null = null
      let messagePreview = ''

      // Determine reminder type based on days difference
      if (daysDiff === 2 && upcomingEnabled) {
        reminderType = 'Upcoming'
        messagePreview = `£${charge.remaining_amount} due on ${charge.due_date} for ${charge.vehicle_reg} – will notify customer on due date once channels are connected.`
      } else if (daysDiff === 0 && dueEnabled) {
        reminderType = 'Due'
        messagePreview = `£${charge.remaining_amount} due today for ${charge.vehicle_reg}.`
      } else if (daysDiff < 0 && overdueEnabled) {
        const overdueDays = Math.abs(daysDiff)
        if (overdueDays === 1) {
          reminderType = 'Overdue1'
        } else if (overdueDays === 7) {
          reminderType = 'Overdue2'
        } else if (overdueDays === 14) {
          reminderType = 'Overdue3'
        } else if (overdueDays === 21) {
          reminderType = 'Overdue4'
        } else if (overdueDays === 28) {
          reminderType = 'Overdue5'
        }
        
        if (reminderType) {
          messagePreview = `£${charge.remaining_amount} overdue for ${charge.vehicle_reg} (since ${charge.due_date}).`
        }
      }

      // Create reminder event if type determined and within max overdue limit
      if (reminderType) {
        const overdueNumber = reminderType.startsWith('Overdue') ? 
          parseInt(reminderType.replace('Overdue', '')) : 0
        
        if (overdueNumber === 0 || overdueNumber <= maxOverdueReminders) {
          try {
            const { error } = await supabase
              .from('reminder_events')
              .insert({
                charge_id: charge.charge_id,
                customer_id: charge.customer_id,
                rental_id: charge.rental_id,
                vehicle_id: charge.vehicle_id,
                reminder_type: reminderType,
                status: 'Delivered',
                message_preview: messagePreview,
                delivered_at: new Date().toISOString()
              })

            if (!error) {
              processed++
              console.log(`Created ${reminderType} reminder for charge ${charge.charge_id}`)
            } else if (!error.message.includes('duplicate key')) {
              console.error('Error creating reminder:', error)
            }
          } catch (err) {
            // Ignore duplicate key errors (idempotency)
            if (!err.message?.includes('duplicate key')) {
              console.error('Error inserting reminder:', err)
            }
          }
        }
      }
    }

    console.log(`Processed ${processed} reminders`)

    return new Response(JSON.stringify({ 
      processed,
      timestamp: new Date().toISOString()
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error) {
    console.error('Error in process-reminders:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})