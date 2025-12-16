export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      app_users: {
        Row: {
          auth_user_id: string
          created_at: string
          email: string
          id: string
          is_active: boolean
          must_change_password: boolean
          name: string | null
          role: string
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          must_change_password?: boolean
          name?: string | null
          role: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          must_change_password?: boolean
          name?: string | null
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          id: string
          target_user_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_user_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          target_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      authority_payments: {
        Row: {
          amount: number
          created_at: string | null
          fine_id: string
          id: string
          notes: string | null
          payment_date: string
          payment_method: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          fine_id: string
          id?: string
          notes?: string | null
          payment_date: string
          payment_method?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          fine_id?: string
          id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "authority_payments_fine_id_fkey"
            columns: ["fine_id"]
            isOneToOne: false
            referencedRelation: "fines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authority_payments_fine_id_fkey"
            columns: ["fine_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["fine_id"]
          },
        ]
      }
      blocked_dates: {
        Row: {
          created_at: string | null
          created_by: string | null
          end_date: string
          id: string
          reason: string | null
          start_date: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          end_date: string
          id?: string
          reason?: string | null
          start_date: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          end_date?: string
          id?: string
          reason?: string | null
          start_date?: string
          vehicle_id?: string | null
        }
        Relationships: []
      }
      customer_documents: {
        Row: {
          created_at: string | null
          customer_id: string
          document_name: string
          document_type: string
          end_date: string | null
          file_name: string | null
          file_size: number | null
          file_url: string | null
          id: string
          insurance_provider: string | null
          mime_type: string | null
          notes: string | null
          policy_end_date: string | null
          policy_number: string | null
          policy_start_date: string | null
          start_date: string | null
          status: string | null
          updated_at: string
          uploaded_at: string | null
          vehicle_id: string | null
          verified: boolean
        }
        Insert: {
          created_at?: string | null
          customer_id: string
          document_name: string
          document_type: string
          end_date?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          insurance_provider?: string | null
          mime_type?: string | null
          notes?: string | null
          policy_end_date?: string | null
          policy_number?: string | null
          policy_start_date?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string
          uploaded_at?: string | null
          vehicle_id?: string | null
          verified?: boolean
        }
        Update: {
          created_at?: string | null
          customer_id?: string
          document_name?: string
          document_type?: string
          end_date?: string | null
          file_name?: string | null
          file_size?: number | null
          file_url?: string | null
          id?: string
          insurance_provider?: string | null
          mime_type?: string | null
          notes?: string | null
          policy_end_date?: string | null
          policy_number?: string | null
          policy_start_date?: string | null
          start_date?: string | null
          status?: string | null
          updated_at?: string
          uploaded_at?: string | null
          vehicle_id?: string | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "customer_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "customer_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_documents_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string | null
          customer_type: string | null
          email: string | null
          high_switcher: boolean | null
          id: string
          identity_verification_status: string | null
          name: string
          nok_address: string | null
          nok_email: string | null
          nok_full_name: string | null
          nok_phone: string | null
          nok_relationship: string | null
          phone: string | null
          status: string | null
          type: string
          updated_at: string
          whatsapp_opt_in: boolean | null
        }
        Insert: {
          created_at?: string | null
          customer_type?: string | null
          email?: string | null
          high_switcher?: boolean | null
          id?: string
          identity_verification_status?: string | null
          name: string
          nok_address?: string | null
          nok_email?: string | null
          nok_full_name?: string | null
          nok_phone?: string | null
          nok_relationship?: string | null
          phone?: string | null
          status?: string | null
          type: string
          updated_at?: string
          whatsapp_opt_in?: boolean | null
        }
        Update: {
          created_at?: string | null
          customer_type?: string | null
          email?: string | null
          high_switcher?: boolean | null
          id?: string
          identity_verification_status?: string | null
          name?: string
          nok_address?: string | null
          nok_email?: string | null
          nok_full_name?: string | null
          nok_phone?: string | null
          nok_relationship?: string | null
          phone?: string | null
          status?: string | null
          type?: string
          updated_at?: string
          whatsapp_opt_in?: boolean | null
        }
        Relationships: []
      }
      fine_files: {
        Row: {
          file_name: string | null
          file_url: string
          fine_id: string | null
          id: string
          uploaded_at: string | null
        }
        Insert: {
          file_name?: string | null
          file_url: string
          fine_id?: string | null
          id?: string
          uploaded_at?: string | null
        }
        Update: {
          file_name?: string | null
          file_url?: string
          fine_id?: string | null
          id?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fine_files_fine_id_fkey"
            columns: ["fine_id"]
            isOneToOne: false
            referencedRelation: "fines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fine_files_fine_id_fkey"
            columns: ["fine_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["fine_id"]
          },
        ]
      }
      fines: {
        Row: {
          amount: number
          appealed_at: string | null
          charged_at: string | null
          created_at: string | null
          customer_id: string | null
          due_date: string
          id: string
          issue_date: string
          liability: string | null
          notes: string | null
          reference_no: string | null
          resolved_at: string | null
          status: string | null
          type: string
          vehicle_id: string
          waived_at: string | null
        }
        Insert: {
          amount: number
          appealed_at?: string | null
          charged_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          due_date: string
          id?: string
          issue_date: string
          liability?: string | null
          notes?: string | null
          reference_no?: string | null
          resolved_at?: string | null
          status?: string | null
          type: string
          vehicle_id: string
          waived_at?: string | null
        }
        Update: {
          amount?: number
          appealed_at?: string | null
          charged_at?: string | null
          created_at?: string | null
          customer_id?: string | null
          due_date?: string
          id?: string
          issue_date?: string
          liability?: string | null
          notes?: string | null
          reference_no?: string | null
          resolved_at?: string | null
          status?: string | null
          type?: string
          vehicle_id?: string
          waived_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fines_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fines_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "fines_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "fines_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "fines_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fines_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      identity_verifications: {
        Row: {
          address: string | null
          client_comment: string | null
          created_at: string | null
          customer_id: string | null
          date_of_birth: string | null
          document_country: string | null
          document_expiry_date: string | null
          document_issuing_date: string | null
          document_number: string | null
          document_type: string | null
          external_user_id: string | null
          first_name: string | null
          id: string
          last_name: string | null
          moderator_comment: string | null
          provider: string
          rejection_labels: string[] | null
          rejection_reason: string | null
          review_result: string | null
          review_status: string | null
          session_id: string | null
          status: string
          updated_at: string | null
          verification_completed_at: string | null
          verification_token: string | null
          verification_url: string | null
          verified_by: string | null
        }
        Insert: {
          address?: string | null
          client_comment?: string | null
          created_at?: string | null
          customer_id?: string | null
          date_of_birth?: string | null
          document_country?: string | null
          document_expiry_date?: string | null
          document_issuing_date?: string | null
          document_number?: string | null
          document_type?: string | null
          external_user_id?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          moderator_comment?: string | null
          provider?: string
          rejection_labels?: string[] | null
          rejection_reason?: string | null
          review_result?: string | null
          review_status?: string | null
          session_id?: string | null
          status?: string
          updated_at?: string | null
          verification_completed_at?: string | null
          verification_token?: string | null
          verification_url?: string | null
          verified_by?: string | null
        }
        Update: {
          address?: string | null
          client_comment?: string | null
          created_at?: string | null
          customer_id?: string | null
          date_of_birth?: string | null
          document_country?: string | null
          document_expiry_date?: string | null
          document_issuing_date?: string | null
          document_number?: string | null
          document_type?: string | null
          external_user_id?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          moderator_comment?: string | null
          provider?: string
          rejection_labels?: string[] | null
          rejection_reason?: string | null
          review_result?: string | null
          review_status?: string | null
          session_id?: string | null
          status?: string
          updated_at?: string | null
          verification_completed_at?: string | null
          verification_token?: string | null
          verification_url?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "identity_verifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_verifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "identity_verifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      insurance_documents: {
        Row: {
          doc_type: string
          file_name: string | null
          file_url: string
          id: string
          policy_id: string
          uploaded_at: string | null
        }
        Insert: {
          doc_type: string
          file_name?: string | null
          file_url: string
          id?: string
          policy_id: string
          uploaded_at?: string | null
        }
        Update: {
          doc_type?: string
          file_name?: string | null
          file_url?: string
          id?: string
          policy_id?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_documents_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "insurance_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      insurance_policies: {
        Row: {
          created_at: string | null
          customer_id: string
          docs_count: number | null
          expiry_date: string
          id: string
          notes: string | null
          policy_number: string
          provider: string | null
          start_date: string
          status: string
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id: string
          docs_count?: number | null
          expiry_date: string
          id?: string
          notes?: string | null
          policy_number: string
          provider?: string | null
          start_date: string
          status?: string
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string
          docs_count?: number | null
          expiry_date?: string
          id?: string
          notes?: string | null
          policy_number?: string
          provider?: string | null
          start_date?: string
          status?: string
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "insurance_policies_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_policies_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "insurance_policies_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "insurance_policies_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "insurance_policies_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "insurance_policies_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string | null
          customer_id: string | null
          due_date: string | null
          id: string
          invoice_date: string
          invoice_number: string
          notes: string | null
          protection_fee: number | null
          rental_fee: number | null
          rental_id: string
          status: string | null
          subtotal: number
          tax_amount: number | null
          total_amount: number
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_date: string
          invoice_number: string
          notes?: string | null
          protection_fee?: number | null
          rental_fee?: number | null
          rental_id: string
          status?: string | null
          subtotal: number
          tax_amount?: number | null
          total_amount: number
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          due_date?: string | null
          id?: string
          invoice_date?: string
          invoice_number?: string
          notes?: string | null
          protection_fee?: number | null
          rental_fee?: number | null
          rental_id?: string
          status?: string | null
          subtotal?: number
          tax_amount?: number | null
          total_amount?: number
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "invoices_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "invoices_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "invoices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "invoices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      leads: {
        Row: {
          assigned_to: string | null
          company: string | null
          converted_at: string | null
          converted_to_customer_id: string | null
          created_at: string
          email: string | null
          expected_value: number | null
          follow_up_date: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          company?: string | null
          converted_at?: string | null
          converted_to_customer_id?: string | null
          created_at?: string
          email?: string | null
          expected_value?: number | null
          follow_up_date?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          company?: string | null
          converted_at?: string | null
          converted_to_customer_id?: string | null
          created_at?: string
          email?: string | null
          expected_value?: number | null
          follow_up_date?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_converted_to_customer_id_fkey"
            columns: ["converted_to_customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_converted_to_customer_id_fkey"
            columns: ["converted_to_customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "leads_converted_to_customer_id_fkey"
            columns: ["converted_to_customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
        ]
      }
      ledger_entries: {
        Row: {
          amount: number
          category: string
          created_at: string
          customer_id: string | null
          due_date: string | null
          entry_date: string
          id: string
          payment_id: string | null
          reference: string | null
          remaining_amount: number
          rental_id: string | null
          type: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          entry_date: string
          id?: string
          payment_id?: string | null
          reference?: string | null
          remaining_amount?: number
          rental_id?: string | null
          type: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          customer_id?: string | null
          due_date?: string | null
          entry_date?: string
          id?: string
          payment_id?: string | null
          reference?: string | null
          remaining_amount?: number
          rental_id?: string | null
          type?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fk_ledger_entries_payment_id"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_ledger_entries_payment_id"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payment_remaining"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "fk_ledger_entries_payment_id"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "view_payments_export"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ledger_entries_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "ledger_entries_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "ledger_entries_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "ledger_entries_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      login_attempts: {
        Row: {
          attempted_at: string | null
          id: string
          ip_address: string | null
          success: boolean
          username: string
        }
        Insert: {
          attempted_at?: string | null
          id?: string
          ip_address?: string | null
          success?: boolean
          username: string
        }
        Update: {
          attempted_at?: string | null
          id?: string
          ip_address?: string | null
          success?: boolean
          username?: string
        }
        Relationships: []
      }
      maintenance_runs: {
        Row: {
          completed_at: string | null
          customers_affected: number | null
          duration_seconds: number | null
          error_message: string | null
          id: string
          operation_type: string
          payments_processed: number | null
          revenue_recalculated: number | null
          started_at: string
          started_by: string | null
          status: string
        }
        Insert: {
          completed_at?: string | null
          customers_affected?: number | null
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          operation_type: string
          payments_processed?: number | null
          revenue_recalculated?: number | null
          started_at?: string
          started_by?: string | null
          status?: string
        }
        Update: {
          completed_at?: string | null
          customers_affected?: number | null
          duration_seconds?: number | null
          error_message?: string | null
          id?: string
          operation_type?: string
          payments_processed?: number | null
          revenue_recalculated?: number | null
          started_at?: string
          started_by?: string | null
          status?: string
        }
        Relationships: []
      }
      org_settings: {
        Row: {
          company_name: string
          created_at: string
          currency_code: string
          date_format: string
          id: string
          logo_url: string | null
          org_id: string
          reminder_due_soon_2d: boolean
          reminder_due_today: boolean
          reminder_overdue_1d: boolean
          reminder_overdue_multi: boolean
          tests_last_result_dashboard: Json | null
          tests_last_result_finance: Json | null
          tests_last_result_rental: Json | null
          tests_last_run_dashboard: string | null
          tests_last_run_finance: string | null
          tests_last_run_rental: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          company_name?: string
          created_at?: string
          currency_code?: string
          date_format?: string
          id?: string
          logo_url?: string | null
          org_id?: string
          reminder_due_soon_2d?: boolean
          reminder_due_today?: boolean
          reminder_overdue_1d?: boolean
          reminder_overdue_multi?: boolean
          tests_last_result_dashboard?: Json | null
          tests_last_result_finance?: Json | null
          tests_last_result_rental?: Json | null
          tests_last_run_dashboard?: string | null
          tests_last_run_finance?: string | null
          tests_last_run_rental?: string | null
          timezone?: string
          updated_at?: string
        }
        Update: {
          company_name?: string
          created_at?: string
          currency_code?: string
          date_format?: string
          id?: string
          logo_url?: string | null
          org_id?: string
          reminder_due_soon_2d?: boolean
          reminder_due_today?: boolean
          reminder_overdue_1d?: boolean
          reminder_overdue_multi?: boolean
          tests_last_result_dashboard?: Json | null
          tests_last_result_finance?: Json | null
          tests_last_result_rental?: Json | null
          tests_last_run_dashboard?: string | null
          tests_last_run_finance?: string | null
          tests_last_run_rental?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_applications: {
        Row: {
          amount_applied: number
          charge_entry_id: string | null
          id: string
          payment_id: string | null
        }
        Insert: {
          amount_applied: number
          charge_entry_id?: string | null
          id?: string
          payment_id?: string | null
        }
        Update: {
          amount_applied?: number
          charge_entry_id?: string | null
          id?: string
          payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_applications_charge_entry_id_fkey"
            columns: ["charge_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_applications_charge_entry_id_fkey"
            columns: ["charge_entry_id"]
            isOneToOne: false
            referencedRelation: "view_customer_statements"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "payment_applications_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_applications_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payment_remaining"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "payment_applications_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "view_payments_export"
            referencedColumns: ["payment_id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          apply_from_date: string | null
          created_at: string
          customer_id: string
          id: string
          is_early: boolean
          method: string | null
          payment_date: string
          payment_type: string
          remaining_amount: number | null
          rental_id: string | null
          status: string | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          amount: number
          apply_from_date?: string | null
          created_at?: string
          customer_id: string
          id?: string
          is_early?: boolean
          method?: string | null
          payment_date?: string
          payment_type?: string
          remaining_amount?: number | null
          rental_id?: string | null
          status?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          amount?: number
          apply_from_date?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          is_early?: boolean
          method?: string | null
          payment_date?: string
          payment_type?: string
          remaining_amount?: number | null
          rental_id?: string | null
          status?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "payments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "payments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      plates: {
        Row: {
          assigned_vehicle_id: string | null
          cost: number | null
          created_at: string | null
          document_name: string | null
          document_url: string | null
          id: string
          notes: string | null
          order_date: string | null
          plate_number: string
          retention_doc_reference: string | null
          status: string | null
          supplier: string | null
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          assigned_vehicle_id?: string | null
          cost?: number | null
          created_at?: string | null
          document_name?: string | null
          document_url?: string | null
          id?: string
          notes?: string | null
          order_date?: string | null
          plate_number: string
          retention_doc_reference?: string | null
          status?: string | null
          supplier?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          assigned_vehicle_id?: string | null
          cost?: number | null
          created_at?: string | null
          document_name?: string | null
          document_url?: string | null
          id?: string
          notes?: string | null
          order_date?: string | null
          plate_number?: string
          retention_doc_reference?: string | null
          status?: string | null
          supplier?: string | null
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plates_assigned_vehicle_id_fkey"
            columns: ["assigned_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "plates_assigned_vehicle_id_fkey"
            columns: ["assigned_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plates_assigned_vehicle_id_fkey"
            columns: ["assigned_vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "plates_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "plates_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plates_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      pnl_entries: {
        Row: {
          amount: number
          category: string | null
          customer_id: string | null
          entry_date: string
          id: string
          payment_id: string | null
          reference: string | null
          rental_id: string | null
          side: string
          source_ref: string | null
          vehicle_id: string | null
        }
        Insert: {
          amount: number
          category?: string | null
          customer_id?: string | null
          entry_date: string
          id?: string
          payment_id?: string | null
          reference?: string | null
          rental_id?: string | null
          side: string
          source_ref?: string | null
          vehicle_id?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          customer_id?: string | null
          entry_date?: string
          id?: string
          payment_id?: string | null
          reference?: string | null
          rental_id?: string | null
          side?: string
          source_ref?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pnl_entries_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "pnl_entries_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pnl_entries_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      protection_plans: {
        Row: {
          color_theme: string | null
          coverage_details: Json | null
          created_at: string | null
          deductible_amount: number | null
          description: string | null
          display_name: string
          display_order: number | null
          exclusions: Json | null
          features: Json | null
          icon_name: string | null
          id: string
          is_active: boolean | null
          max_coverage_amount: number | null
          name: string
          price_per_day: number
          price_per_month: number | null
          price_per_week: number | null
          tier: string | null
          updated_at: string | null
        }
        Insert: {
          color_theme?: string | null
          coverage_details?: Json | null
          created_at?: string | null
          deductible_amount?: number | null
          description?: string | null
          display_name: string
          display_order?: number | null
          exclusions?: Json | null
          features?: Json | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          max_coverage_amount?: number | null
          name: string
          price_per_day: number
          price_per_month?: number | null
          price_per_week?: number | null
          tier?: string | null
          updated_at?: string | null
        }
        Update: {
          color_theme?: string | null
          coverage_details?: Json | null
          created_at?: string | null
          deductible_amount?: number | null
          description?: string | null
          display_name?: string
          display_order?: number | null
          exclusions?: Json | null
          features?: Json | null
          icon_name?: string | null
          id?: string
          is_active?: boolean | null
          max_coverage_amount?: number | null
          name?: string
          price_per_day?: number
          price_per_month?: number | null
          price_per_week?: number | null
          tier?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      reminder_actions: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          note: string | null
          reminder_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          reminder_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          reminder_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_actions_reminder_id_fkey"
            columns: ["reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_config: {
        Row: {
          config_key: string
          config_value: Json
          id: string
          updated_at: string
        }
        Insert: {
          config_key: string
          config_value: Json
          id?: string
          updated_at?: string
        }
        Update: {
          config_key?: string
          config_value?: Json
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      reminder_emails: {
        Row: {
          body_html: string | null
          body_text: string | null
          id: string
          meta: Json | null
          sent_at: string
          subject: string
          to_address: string
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          id?: string
          meta?: Json | null
          sent_at?: string
          subject: string
          to_address: string
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          id?: string
          meta?: Json | null
          sent_at?: string
          subject?: string
          to_address?: string
        }
        Relationships: []
      }
      reminder_events: {
        Row: {
          charge_id: string
          created_at: string
          customer_id: string
          delivered_at: string | null
          delivered_to: string
          id: string
          message_preview: string
          reminder_type: string
          rental_id: string
          snoozed_until: string | null
          status: string
          unique_key: string | null
          vehicle_id: string
        }
        Insert: {
          charge_id: string
          created_at?: string
          customer_id: string
          delivered_at?: string | null
          delivered_to?: string
          id?: string
          message_preview: string
          reminder_type: string
          rental_id: string
          snoozed_until?: string | null
          status?: string
          unique_key?: string | null
          vehicle_id: string
        }
        Update: {
          charge_id?: string
          created_at?: string
          customer_id?: string
          delivered_at?: string | null
          delivered_to?: string
          id?: string
          message_preview?: string
          reminder_type?: string
          rental_id?: string
          snoozed_until?: string | null
          status?: string
          unique_key?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_events_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_events_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: false
            referencedRelation: "view_customer_statements"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "reminder_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reminder_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "reminder_events_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_events_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "reminder_events_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "reminder_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "reminder_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      reminder_logs: {
        Row: {
          amount: number
          channel: string
          charge_id: string
          created_at: string
          customer_id: string
          due_date: string
          id: string
          reminder_type: string
          rental_id: string
          sent_at: string
        }
        Insert: {
          amount: number
          channel: string
          charge_id: string
          created_at?: string
          customer_id: string
          due_date: string
          id?: string
          reminder_type: string
          rental_id: string
          sent_at?: string
        }
        Update: {
          amount?: number
          channel?: string
          charge_id?: string
          created_at?: string
          customer_id?: string
          due_date?: string
          id?: string
          reminder_type?: string
          rental_id?: string
          sent_at?: string
        }
        Relationships: []
      }
      reminder_rules: {
        Row: {
          category: string
          created_at: string
          description: string | null
          id: string
          interval_type: string | null
          is_enabled: boolean
          is_recurring: boolean | null
          lead_days: number
          rule_code: string
          rule_type: string
          severity: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          description?: string | null
          id?: string
          interval_type?: string | null
          is_enabled?: boolean
          is_recurring?: boolean | null
          lead_days: number
          rule_code: string
          rule_type: string
          severity?: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          interval_type?: string | null
          is_enabled?: boolean
          is_recurring?: boolean | null
          lead_days?: number
          rule_code?: string
          rule_type?: string
          severity?: string
          updated_at?: string
        }
        Relationships: []
      }
      reminder_settings: {
        Row: {
          id: string
          setting_key: string
          setting_value: Json
          updated_at: string
        }
        Insert: {
          id?: string
          setting_key: string
          setting_value: Json
          updated_at?: string
        }
        Update: {
          id?: string
          setting_key?: string
          setting_value?: Json
          updated_at?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          context: Json
          created_at: string
          due_on: string
          id: string
          last_sent_at: string | null
          message: string
          object_id: string
          object_type: string
          remind_on: string
          rule_code: string
          severity: string
          snooze_until: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          context?: Json
          created_at?: string
          due_on: string
          id?: string
          last_sent_at?: string | null
          message: string
          object_id: string
          object_type: string
          remind_on: string
          rule_code: string
          severity?: string
          snooze_until?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          context?: Json
          created_at?: string
          due_on?: string
          id?: string
          last_sent_at?: string | null
          message?: string
          object_id?: string
          object_type?: string
          remind_on?: string
          rule_code?: string
          severity?: string
          snooze_until?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      rental_protection_selections: {
        Row: {
          created_at: string | null
          daily_rate: number
          id: string
          protection_plan_id: string | null
          rental_id: string | null
          total_cost: number
          total_days: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          daily_rate: number
          id?: string
          protection_plan_id?: string | null
          rental_id?: string | null
          total_cost: number
          total_days: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          daily_rate?: number
          id?: string
          protection_plan_id?: string | null
          rental_id?: string | null
          total_cost?: number
          total_days?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_protection_selections_protection_plan_id_fkey"
            columns: ["protection_plan_id"]
            isOneToOne: false
            referencedRelation: "protection_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_protection_selections_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: true
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_protection_selections_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: true
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "rental_protection_selections_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: true
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
        ]
      }
      rentals: {
        Row: {
          created_at: string | null
          customer_id: string | null
          document_status: string | null
          docusign_envelope_id: string | null
          end_date: string | null
          envelope_completed_at: string | null
          envelope_created_at: string | null
          envelope_sent_at: string | null
          id: string
          monthly_amount: number
          rental_number: string | null
          rental_period_type: string | null
          schedule: string | null
          signed_document_id: string | null
          start_date: string
          status: string | null
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          document_status?: string | null
          docusign_envelope_id?: string | null
          end_date?: string | null
          envelope_completed_at?: string | null
          envelope_created_at?: string | null
          envelope_sent_at?: string | null
          id?: string
          monthly_amount: number
          rental_number?: string | null
          rental_period_type?: string | null
          schedule?: string | null
          signed_document_id?: string | null
          start_date: string
          status?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          document_status?: string | null
          docusign_envelope_id?: string | null
          end_date?: string | null
          envelope_completed_at?: string | null
          envelope_created_at?: string | null
          envelope_sent_at?: string | null
          id?: string
          monthly_amount?: number
          rental_number?: string | null
          rental_period_type?: string | null
          schedule?: string | null
          signed_document_id?: string | null
          start_date?: string
          status?: string | null
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rentals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "rentals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "rentals_signed_document_id_fkey"
            columns: ["signed_document_id"]
            isOneToOne: false
            referencedRelation: "customer_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "rentals_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      service_records: {
        Row: {
          cost: number
          created_at: string | null
          description: string | null
          id: string
          mileage: number | null
          service_date: string
          vehicle_id: string
        }
        Insert: {
          cost?: number
          created_at?: string | null
          description?: string | null
          id?: string
          mileage?: number | null
          service_date: string
          vehicle_id: string
        }
        Update: {
          cost?: number
          created_at?: string | null
          description?: string | null
          id?: string
          mileage?: number | null
          service_date?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_records_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "service_records_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "service_records_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      settings_audit: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_fields: string[] | null
          id: string
          new_values: Json | null
          old_values: Json | null
          operation: string
          table_name: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[] | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          operation: string
          table_name: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_fields?: string[] | null
          id?: string
          new_values?: Json | null
          old_values?: Json | null
          operation?: string
          table_name?: string
        }
        Relationships: []
      }
      testimonials: {
        Row: {
          author: string
          company_name: string
          created_at: string | null
          created_by: string | null
          id: string
          review: string
          stars: number
          updated_at: string | null
        }
        Insert: {
          author: string
          company_name: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          review: string
          stars: number
          updated_at?: string | null
        }
        Update: {
          author?: string
          company_name?: string
          created_at?: string | null
          created_by?: string | null
          id?: string
          review?: string
          stars?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      users: {
        Row: {
          auth_user_id: string | null
          created_at: string | null
          id: string
          last_login: string | null
          password_hash: string
          require_password_change: boolean
          role: string
          status: string
          username: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string | null
          id?: string
          last_login?: string | null
          password_hash: string
          require_password_change?: boolean
          role?: string
          status?: string
          username: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string | null
          id?: string
          last_login?: string | null
          password_hash?: string
          require_password_change?: boolean
          role?: string
          status?: string
          username?: string
        }
        Relationships: []
      }
      vehicle_events: {
        Row: {
          created_at: string | null
          event_date: string
          event_type: Database["public"]["Enums"]["vehicle_event_type"]
          id: string
          reference_id: string | null
          reference_table: string | null
          summary: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string | null
          event_date?: string
          event_type: Database["public"]["Enums"]["vehicle_event_type"]
          id?: string
          reference_id?: string | null
          reference_table?: string | null
          summary: string
          vehicle_id: string
        }
        Update: {
          created_at?: string | null
          event_date?: string
          event_type?: Database["public"]["Enums"]["vehicle_event_type"]
          id?: string
          reference_id?: string | null
          reference_table?: string | null
          summary?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "vehicle_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_events_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      vehicle_expenses: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["expense_category"]
          created_at: string | null
          created_by: string | null
          expense_date: string
          id: string
          notes: string | null
          reference: string | null
          updated_at: string | null
          vehicle_id: string
        }
        Insert: {
          amount: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string | null
          created_by?: string | null
          expense_date?: string
          id?: string
          notes?: string | null
          reference?: string | null
          updated_at?: string | null
          vehicle_id: string
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["expense_category"]
          created_at?: string | null
          created_by?: string | null
          expense_date?: string
          id?: string
          notes?: string | null
          reference?: string | null
          updated_at?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_expenses_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "vehicle_expenses_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_expenses_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      vehicle_files: {
        Row: {
          content_type: string | null
          created_at: string | null
          file_name: string
          id: string
          size_bytes: number | null
          storage_path: string
          uploaded_at: string | null
          uploaded_by: string | null
          vehicle_id: string
        }
        Insert: {
          content_type?: string | null
          created_at?: string | null
          file_name: string
          id?: string
          size_bytes?: number | null
          storage_path: string
          uploaded_at?: string | null
          uploaded_by?: string | null
          vehicle_id: string
        }
        Update: {
          content_type?: string | null
          created_at?: string | null
          file_name?: string
          id?: string
          size_bytes?: number | null
          storage_path?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_files_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "vehicle_files_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_files_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      vehicle_photos: {
        Row: {
          created_at: string
          display_order: number | null
          id: string
          photo_url: string
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          photo_url: string
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          photo_url?: string
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_photos_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "vehicle_photos_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vehicle_photos_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      vehicles: {
        Row: {
          acquisition_date: string | null
          acquisition_type: string | null
          balloon: number | null
          color: string | null
          colour: string | null
          created_at: string | null
          daily_rent: number | null
          description: string | null
          disposal_buyer: string | null
          disposal_date: string | null
          disposal_notes: string | null
          finance_start_date: string | null
          has_logbook: boolean
          has_remote_immobiliser: boolean | null
          has_service_plan: boolean | null
          has_spare_key: boolean | null
          has_tracker: boolean | null
          id: string
          initial_payment: number | null
          is_disposed: boolean | null
          last_service_date: string | null
          last_service_mileage: number | null
          make: string | null
          model: string | null
          monthly_payment: number | null
          monthly_rent: number | null
          mot_due_date: string | null
          photo_url: string | null
          purchase_price: number | null
          reg: string
          sale_proceeds: number | null
          security_notes: string | null
          spare_key_holder: string | null
          spare_key_notes: string | null
          status: string | null
          tax_due_date: string | null
          term_months: number | null
          updated_at: string
          warranty_end_date: string | null
          warranty_start_date: string | null
          weekly_rent: number | null
          year: number | null
        }
        Insert: {
          acquisition_date?: string | null
          acquisition_type?: string | null
          balloon?: number | null
          color?: string | null
          colour?: string | null
          created_at?: string | null
          daily_rent?: number | null
          description?: string | null
          disposal_buyer?: string | null
          disposal_date?: string | null
          disposal_notes?: string | null
          finance_start_date?: string | null
          has_logbook?: boolean
          has_remote_immobiliser?: boolean | null
          has_service_plan?: boolean | null
          has_spare_key?: boolean | null
          has_tracker?: boolean | null
          id?: string
          initial_payment?: number | null
          is_disposed?: boolean | null
          last_service_date?: string | null
          last_service_mileage?: number | null
          make?: string | null
          model?: string | null
          monthly_payment?: number | null
          monthly_rent?: number | null
          mot_due_date?: string | null
          photo_url?: string | null
          purchase_price?: number | null
          reg: string
          sale_proceeds?: number | null
          security_notes?: string | null
          spare_key_holder?: string | null
          spare_key_notes?: string | null
          status?: string | null
          tax_due_date?: string | null
          term_months?: number | null
          updated_at?: string
          warranty_end_date?: string | null
          warranty_start_date?: string | null
          weekly_rent?: number | null
          year?: number | null
        }
        Update: {
          acquisition_date?: string | null
          acquisition_type?: string | null
          balloon?: number | null
          color?: string | null
          colour?: string | null
          created_at?: string | null
          daily_rent?: number | null
          description?: string | null
          disposal_buyer?: string | null
          disposal_date?: string | null
          disposal_notes?: string | null
          finance_start_date?: string | null
          has_logbook?: boolean
          has_remote_immobiliser?: boolean | null
          has_service_plan?: boolean | null
          has_spare_key?: boolean | null
          has_tracker?: boolean | null
          id?: string
          initial_payment?: number | null
          is_disposed?: boolean | null
          last_service_date?: string | null
          last_service_mileage?: number | null
          make?: string | null
          model?: string | null
          monthly_payment?: number | null
          monthly_rent?: number | null
          mot_due_date?: string | null
          photo_url?: string | null
          purchase_price?: number | null
          reg?: string
          sale_proceeds?: number | null
          security_notes?: string | null
          spare_key_holder?: string | null
          spare_key_notes?: string | null
          status?: string | null
          tax_due_date?: string | null
          term_months?: number | null
          updated_at?: string
          warranty_end_date?: string | null
          warranty_start_date?: string | null
          weekly_rent?: number | null
          year?: number | null
        }
        Relationships: []
      }
    }
    Views: {
      v_customer_credit: {
        Row: {
          credit_available: number | null
          customer_id: string | null
        }
        Insert: {
          credit_available?: never
          customer_id?: string | null
        }
        Update: {
          credit_available?: never
          customer_id?: string | null
        }
        Relationships: []
      }
      v_payment_remaining: {
        Row: {
          customer_id: string | null
          payment_id: string | null
          remaining: number | null
          rental_id: string | null
        }
        Insert: {
          customer_id?: string | null
          payment_id?: string | null
          remaining?: never
          rental_id?: string | null
        }
        Update: {
          customer_id?: string | null
          payment_id?: string | null
          remaining?: never
          rental_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
        ]
      }
      v_rental_credit: {
        Row: {
          credit_available: number | null
          rental_id: string | null
        }
        Insert: {
          credit_available?: never
          rental_id?: string | null
        }
        Update: {
          credit_available?: never
          rental_id?: string | null
        }
        Relationships: []
      }
      vehicle_pnl_rollup: {
        Row: {
          cost_acquisition: number | null
          cost_finance: number | null
          cost_fines: number | null
          cost_other: number | null
          cost_service: number | null
          cost_total: number | null
          entry_date: string | null
          make: string | null
          model: string | null
          reg: string | null
          revenue_initial_fees: number | null
          revenue_other: number | null
          revenue_rental: number | null
          vehicle_id: string | null
        }
        Relationships: []
      }
      view_aging_receivables: {
        Row: {
          bucket_0_30: number | null
          bucket_31_60: number | null
          bucket_61_90: number | null
          bucket_90_plus: number | null
          customer_id: string | null
          customer_name: string | null
          total_due: number | null
        }
        Relationships: []
      }
      view_customer_statements: {
        Row: {
          amount: number | null
          category: string | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          due_date: string | null
          entry_date: string | null
          entry_id: string | null
          remaining_amount: number | null
          rental_id: string | null
          running_balance: number | null
          transaction_amount: number | null
          type: string | null
          vehicle_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_reg: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "ledger_entries_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "ledger_entries_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "ledger_entries_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "ledger_entries_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      view_fines_export: {
        Row: {
          amount: number | null
          appeal_status: string | null
          customer_email: string | null
          customer_name: string | null
          customer_phone: string | null
          due_date: string | null
          fine_id: string | null
          issue_date: string | null
          liability: string | null
          notes: string | null
          reference_no: string | null
          remaining_amount: number | null
          status: string | null
          type: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_reg: string | null
        }
        Relationships: []
      }
      view_payments_export: {
        Row: {
          allocations_json: Json | null
          amount: number | null
          applied_amount: number | null
          customer_email: string | null
          customer_id: string | null
          customer_name: string | null
          customer_phone: string | null
          method: string | null
          payment_date: string | null
          payment_id: string | null
          payment_type: string | null
          rental_id: string | null
          unapplied_amount: number | null
          vehicle_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_reg: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "payments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "payments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "payments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      view_pl_by_vehicle: {
        Row: {
          cost_acquisition: number | null
          cost_finance: number | null
          cost_fines: number | null
          cost_other: number | null
          cost_service: number | null
          make_model: string | null
          net_profit: number | null
          revenue_fees: number | null
          revenue_other: number | null
          revenue_rental: number | null
          total_costs: number | null
          total_revenue: number | null
          vehicle_id: string | null
          vehicle_reg: string | null
        }
        Relationships: []
      }
      view_pl_consolidated: {
        Row: {
          cost_acquisition: number | null
          cost_finance: number | null
          cost_fines: number | null
          cost_other: number | null
          cost_service: number | null
          net_profit: number | null
          revenue_fees: number | null
          revenue_other: number | null
          revenue_rental: number | null
          total_costs: number | null
          total_revenue: number | null
          view_type: string | null
        }
        Relationships: []
      }
      view_rentals_export: {
        Row: {
          balance: number | null
          customer_name: string | null
          end_date: string | null
          initial_fee_amount: number | null
          monthly_amount: number | null
          rental_id: string | null
          schedule: string | null
          start_date: string | null
          status: string | null
          vehicle_reg: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      app_login: {
        Args: { p_password: string; p_username: string }
        Returns: {
          id: string
          require_password_change: boolean
          role: string
          username: string
        }[]
      }
      apply_payment: { Args: { payment_id: string }; Returns: undefined }
      apply_payment_fully: {
        Args: { p_payment_id: string }
        Returns: undefined
      }
      apply_payments_to_charges: {
        Args: { p_rental_id?: string }
        Returns: undefined
      }
      attach_payments_to_rentals: { Args: never; Returns: undefined }
      backfill_payment_rental_ids: {
        Args: never
        Returns: {
          payments_skipped: number
          payments_updated: number
        }[]
      }
      backfill_rental_charges_first_month_only: {
        Args: never
        Returns: undefined
      }
      backfill_rental_charges_full: { Args: never; Returns: undefined }
      calculate_vehicle_book_cost: {
        Args: { p_vehicle_id: string }
        Returns: number
      }
      check_policy_overlap: {
        Args: {
          p_customer_id: string
          p_expiry_date: string
          p_policy_id?: string
          p_start_date: string
          p_vehicle_id: string
        }
        Returns: {
          overlapping_expiry_date: string
          overlapping_policy_id: string
          overlapping_policy_number: string
          overlapping_start_date: string
        }[]
      }
      dispose_vehicle: {
        Args: {
          p_buyer?: string
          p_disposal_date: string
          p_notes?: string
          p_sale_proceeds: number
          p_vehicle_id: string
        }
        Returns: Json
      }
      fine_void_charge: { Args: { f_id: string }; Returns: undefined }
      generate_daily_reminders: { Args: never; Returns: undefined }
      generate_first_charge_for_rental: {
        Args: { rental_id_param: string }
        Returns: undefined
      }
      generate_monthly_charges: {
        Args: { rental_id: string }
        Returns: undefined
      }
      generate_next_rental_charge: {
        Args: { r_id: string }
        Returns: undefined
      }
      generate_rental_charges: { Args: { r_id: string }; Returns: undefined }
      get_current_user_role: { Args: never; Returns: string }
      get_customer_balance_with_status: {
        Args: { customer_id_param: string }
        Returns: {
          balance: number
          status: string
          total_charges: number
          total_payments: number
        }[]
      }
      get_customer_credit: {
        Args: { customer_id_param: string }
        Returns: number
      }
      get_customer_net_position: {
        Args: { customer_id_param: string }
        Returns: number
      }
      get_customer_statement: {
        Args: { p_customer_id: string; p_from_date: string; p_to_date: string }
        Returns: {
          credit: number
          debit: number
          description: string
          rental_id: string
          running_balance: number
          transaction_date: string
          type: string
          vehicle_reg: string
        }[]
      }
      get_payment_remaining: {
        Args: { payment_id_param: string }
        Returns: number
      }
      get_pending_charges_for_reminders: {
        Args: never
        Returns: {
          amount: number
          charge_id: string
          charge_type: string
          customer_balance: number
          customer_email: string
          customer_id: string
          customer_name: string
          customer_phone: string
          days_overdue: number
          days_until_due: number
          due_date: string
          remaining_amount: number
          rental_id: string
          vehicle_id: string
          vehicle_reg: string
          whatsapp_opt_in: boolean
        }[]
      }
      get_rental_credit: { Args: { rental_id_param: string }; Returns: number }
      get_user_role: { Args: { user_id: string }; Returns: string }
      has_any_role: {
        Args: { _roles: string[]; _user_id: string }
        Returns: boolean
      }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      has_upfront_finance_entry: { Args: { v_id: string }; Returns: boolean }
      hash_password: { Args: { password: string }; Returns: string }
      is_current_user_admin: { Args: never; Returns: boolean }
      payment_apply_fifo: { Args: { p_id: string }; Returns: undefined }
      payment_apply_fifo_v2: { Args: { p_id: string }; Returns: undefined }
      payment_auto_apply_due_credit: { Args: never; Returns: undefined }
      pnl_post_acquisition: { Args: { v_id: string }; Returns: undefined }
      process_payment_transaction:
        | {
            Args: {
              p_amount: number
              p_customer_id: string
              p_payment_date: string
              p_payment_id: string
              p_payment_type: string
              p_rental_id: string
              p_vehicle_id: string
            }
            Returns: Json
          }
        | { Args: { p_payment_id: string }; Returns: Json }
      reapply_all_payments: { Args: never; Returns: undefined }
      reapply_all_payments_v2: {
        Args: never
        Returns: {
          customers_affected: number
          payments_processed: number
          total_credit_applied: number
        }[]
      }
      recalculate_insurance_status: {
        Args: never
        Returns: {
          expired_policies: number
          expiring_soon_policies: number
          updated_policies: number
        }[]
      }
      recalculate_vehicle_pl: {
        Args: { p_vehicle_id: string }
        Returns: undefined
      }
      record_payment: {
        Args: {
          p_amount: number
          p_customer: string
          p_method: string
          p_payment_date: string
          p_rental: string
          p_type: string
          p_vehicle: string
        }
        Returns: string
      }
      rental_create_charge: {
        Args: { amt: number; due: string; r_id: string }
        Returns: string
      }
      undo_vehicle_disposal: { Args: { p_vehicle_id: string }; Returns: Json }
      update_customer_balance: {
        Args: { customer_id: string }
        Returns: undefined
      }
      update_vehicle_last_service: {
        Args: { p_vehicle_id: string }
        Returns: undefined
      }
      upsert_plate_pnl_entry: {
        Args: {
          p_cost: number
          p_created_at: string
          p_order_date: string
          p_plate_id: string
          p_vehicle_id: string
        }
        Returns: undefined
      }
      upsert_service_pnl_entry: {
        Args: {
          p_cost: number
          p_service_date: string
          p_service_record_id: string
          p_vehicle_id: string
        }
        Returns: undefined
      }
      verify_password: {
        Args: { provided_password: string; stored_hash: string }
        Returns: boolean
      }
    }
    Enums: {
      acquisition_type: "purchase" | "finance" | "lease"
      customer_status: "active" | "inactive"
      customer_type: "individual" | "company"
      entry_type: "charge" | "payment" | "adjustment"
      expense_category:
        | "Repair"
        | "Service"
        | "Tyres"
        | "Valet"
        | "Accessory"
        | "Other"
      ledger_status: "pending" | "applied"
      payment_status: "paid" | "due" | "overdue" | "void"
      payment_type: "initial_fee" | "monthly" | "fine" | "service" | "other"
      rental_status: "active" | "completed" | "cancelled"
      vehicle_event_type:
        | "acquisition_created"
        | "acquisition_updated"
        | "rental_started"
        | "rental_ended"
        | "expense_added"
        | "expense_removed"
        | "fine_assigned"
        | "fine_closed"
        | "file_uploaded"
        | "file_deleted"
        | "disposal"
        | "service_added"
        | "service_updated"
        | "service_removed"
      vehicle_status: "available" | "rented" | "sold"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      acquisition_type: ["purchase", "finance", "lease"],
      customer_status: ["active", "inactive"],
      customer_type: ["individual", "company"],
      entry_type: ["charge", "payment", "adjustment"],
      expense_category: [
        "Repair",
        "Service",
        "Tyres",
        "Valet",
        "Accessory",
        "Other",
      ],
      ledger_status: ["pending", "applied"],
      payment_status: ["paid", "due", "overdue", "void"],
      payment_type: ["initial_fee", "monthly", "fine", "service", "other"],
      rental_status: ["active", "completed", "cancelled"],
      vehicle_event_type: [
        "acquisition_created",
        "acquisition_updated",
        "rental_started",
        "rental_ended",
        "expense_added",
        "expense_removed",
        "fine_assigned",
        "fine_closed",
        "file_uploaded",
        "file_deleted",
        "disposal",
        "service_added",
        "service_updated",
        "service_removed",
      ],
      vehicle_status: ["available", "rented", "sold"],
    },
  },
} as const
