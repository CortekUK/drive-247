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
      _orphaned_data_audit: {
        Row: {
          cleaned_at: string | null
          id: number
          orphan_type: string
          record_id: string
          table_name: string
        }
        Insert: {
          cleaned_at?: string | null
          id?: number
          orphan_type: string
          record_id: string
          table_name: string
        }
        Update: {
          cleaned_at?: string | null
          id?: number
          orphan_type?: string
          record_id?: string
          table_name?: string
        }
        Relationships: []
      }
      admin_settings: {
        Row: {
          contact_form_enabled: boolean | null
          created_at: string | null
          id: string
          notification_emails: string[] | null
          updated_at: string | null
        }
        Insert: {
          contact_form_enabled?: boolean | null
          created_at?: string | null
          id?: string
          notification_emails?: string[] | null
          updated_at?: string | null
        }
        Update: {
          contact_form_enabled?: boolean | null
          created_at?: string | null
          id?: string
          notification_emails?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      agreement_templates: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          template_content: string
          template_name: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          template_content: string
          template_name: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          template_content?: string
          template_name?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agreement_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      app_users: {
        Row: {
          auth_user_id: string
          created_at: string
          email: string
          id: string
          is_active: boolean
          is_primary_super_admin: boolean | null
          is_super_admin: boolean | null
          must_change_password: boolean
          name: string | null
          role: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          email: string
          id?: string
          is_active?: boolean
          is_primary_super_admin?: boolean | null
          is_super_admin?: boolean | null
          must_change_password?: boolean
          name?: string | null
          role: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          email?: string
          id?: string
          is_active?: boolean
          is_primary_super_admin?: boolean | null
          is_super_admin?: boolean | null
          must_change_password?: boolean
          name?: string | null
          role?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_super_admin_action: boolean | null
          target_user_id: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_super_admin_action?: boolean | null
          target_user_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_super_admin_action?: boolean | null
          target_user_id?: string | null
          tenant_id?: string | null
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
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          tenant_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          fine_id: string
          id?: string
          notes?: string | null
          payment_date: string
          payment_method?: string | null
          tenant_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          fine_id?: string
          id?: string
          notes?: string | null
          payment_date?: string
          payment_method?: string | null
          tenant_id?: string | null
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
          {
            foreignKeyName: "authority_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
          tenant_id: string | null
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          end_date: string
          id?: string
          reason?: string | null
          start_date: string
          tenant_id?: string | null
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          end_date?: string
          id?: string
          reason?: string | null
          start_date?: string
          tenant_id?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocked_dates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_dates_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "blocked_dates_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_dates_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "blocked_dates_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      blocked_identities: {
        Row: {
          blocked_by: string | null
          created_at: string | null
          customer_name: string | null
          id: string
          identity_number: string
          identity_type: string
          is_active: boolean | null
          notes: string | null
          reason: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          blocked_by?: string | null
          created_at?: string | null
          customer_name?: string | null
          id?: string
          identity_number: string
          identity_type: string
          is_active?: boolean | null
          notes?: string | null
          reason: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          blocked_by?: string | null
          created_at?: string | null
          customer_name?: string | null
          id?: string
          identity_number?: string
          identity_type?: string
          is_active?: boolean | null
          notes?: string | null
          reason?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocked_identities_blocked_by_fkey"
            columns: ["blocked_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_identities_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      bonzah_insurance_policies: {
        Row: {
          coverage_types: Json
          created_at: string | null
          customer_id: string
          id: string
          payment_id: string | null
          pickup_state: string
          policy_id: string | null
          policy_issued_at: string | null
          policy_no: string | null
          premium_amount: number
          quote_id: string
          quote_no: string | null
          rental_id: string | null
          renter_details: Json
          status: string
          tenant_id: string | null
          trip_end_date: string
          trip_start_date: string
          updated_at: string | null
        }
        Insert: {
          coverage_types: Json
          created_at?: string | null
          customer_id: string
          id?: string
          payment_id?: string | null
          pickup_state: string
          policy_id?: string | null
          policy_issued_at?: string | null
          policy_no?: string | null
          premium_amount: number
          quote_id: string
          quote_no?: string | null
          rental_id?: string | null
          renter_details: Json
          status?: string
          tenant_id?: string | null
          trip_end_date: string
          trip_start_date: string
          updated_at?: string | null
        }
        Update: {
          coverage_types?: Json
          created_at?: string | null
          customer_id?: string
          id?: string
          payment_id?: string | null
          pickup_state?: string
          policy_id?: string | null
          policy_issued_at?: string | null
          policy_no?: string | null
          premium_amount?: number
          quote_id?: string
          quote_no?: string | null
          rental_id?: string | null
          renter_details?: Json
          status?: string
          tenant_id?: string | null
          trip_end_date?: string
          trip_start_date?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bonzah_insurance_policies_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonzah_insurance_policies_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "bonzah_insurance_policies_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "bonzah_insurance_policies_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "bonzah_insurance_policies_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bonzah_insurance_policies_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "bonzah_insurance_policies_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "bonzah_insurance_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channel_messages: {
        Row: {
          channel_id: string
          content: string
          created_at: string | null
          id: number
          is_read: boolean
          metadata: Json | null
          read_at: string | null
          sender_id: string
          sender_type: string
        }
        Insert: {
          channel_id: string
          content: string
          created_at?: string | null
          id?: number
          is_read?: boolean
          metadata?: Json | null
          read_at?: string | null
          sender_id: string
          sender_type: string
        }
        Update: {
          channel_id?: string
          content?: string
          created_at?: string | null
          id?: number
          is_read?: boolean
          metadata?: Json | null
          read_at?: string | null
          sender_id?: string
          sender_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_messages_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channel_participants: {
        Row: {
          channel_id: string
          created_at: string | null
          id: string
          is_muted: boolean
          is_online: boolean
          last_read_at: string | null
          last_seen_at: string | null
          participant_id: string
          participant_type: string
          unread_count: number
        }
        Insert: {
          channel_id: string
          created_at?: string | null
          id?: string
          is_muted?: boolean
          is_online?: boolean
          last_read_at?: string | null
          last_seen_at?: string | null
          participant_id: string
          participant_type: string
          unread_count?: number
        }
        Update: {
          channel_id?: string
          created_at?: string | null
          id?: string
          is_muted?: boolean
          is_online?: boolean
          last_read_at?: string | null
          last_seen_at?: string | null
          participant_id?: string
          participant_type?: string
          unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "chat_channel_participants_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "chat_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_channels: {
        Row: {
          created_at: string | null
          customer_id: string
          id: string
          last_message_at: string | null
          status: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id: string
          id?: string
          last_message_at?: string | null
          status?: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string
          id?: string
          last_message_at?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_channels_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_channels_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "chat_channels_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "chat_channels_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "chat_channels_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          chart_data: Json | null
          content: string
          conversation_id: string
          created_at: string | null
          id: number
          role: string
          sources: Json | null
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          chart_data?: Json | null
          content: string
          conversation_id?: string
          created_at?: string | null
          id?: number
          role: string
          sources?: Json | null
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          chart_data?: Json | null
          content?: string
          conversation_id?: string
          created_at?: string | null
          id?: number
          role?: string
          sources?: Json | null
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_media: {
        Row: {
          alt_text: string | null
          created_at: string | null
          file_name: string
          file_size: number | null
          file_url: string
          folder: string | null
          id: string
          mime_type: string | null
          tenant_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          alt_text?: string | null
          created_at?: string | null
          file_name: string
          file_size?: number | null
          file_url: string
          folder?: string | null
          id?: string
          mime_type?: string | null
          tenant_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          alt_text?: string | null
          created_at?: string | null
          file_name?: string
          file_size?: number | null
          file_url?: string
          folder?: string | null
          id?: string
          mime_type?: string | null
          tenant_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cms_media_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cms_media_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_page_sections: {
        Row: {
          content: Json
          created_at: string | null
          display_order: number | null
          id: string
          is_visible: boolean | null
          page_id: string | null
          section_key: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          content?: Json
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_visible?: boolean | null
          page_id?: string | null
          section_key: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          content?: Json
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_visible?: boolean | null
          page_id?: string | null
          section_key?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cms_page_sections_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "cms_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cms_page_sections_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_page_versions: {
        Row: {
          content: Json
          created_at: string | null
          created_by: string | null
          id: string
          notes: string | null
          page_id: string | null
          tenant_id: string | null
          version_number: number
        }
        Insert: {
          content: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          page_id?: string | null
          tenant_id?: string | null
          version_number: number
        }
        Update: {
          content?: Json
          created_at?: string | null
          created_by?: string | null
          id?: string
          notes?: string | null
          page_id?: string | null
          tenant_id?: string | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "cms_page_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cms_page_versions_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "cms_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cms_page_versions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cms_pages: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          published_at: string | null
          published_by: string | null
          slug: string
          status: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          published_at?: string | null
          published_by?: string | null
          slug: string
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          published_at?: string | null
          published_by?: string | null
          slug?: string
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cms_pages_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cms_pages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_requests: {
        Row: {
          company_name: string
          contact_name: string
          created_at: string | null
          email: string
          id: string
          message: string | null
          notes: string | null
          phone: string | null
          status: string | null
          tenant_id: string | null
        }
        Insert: {
          company_name: string
          contact_name: string
          created_at?: string | null
          email: string
          id?: string
          message?: string | null
          notes?: string | null
          phone?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Update: {
          company_name?: string
          contact_name?: string
          created_at?: string | null
          email?: string
          id?: string
          message?: string | null
          notes?: string | null
          phone?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contact_requests_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_documents: {
        Row: {
          ai_confidence_score: number | null
          ai_extracted_data: Json | null
          ai_scan_errors: string[] | null
          ai_scan_status: string | null
          ai_validation_score: number | null
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
          rental_id: string | null
          scanned_at: string | null
          start_date: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string
          uploaded_at: string | null
          vehicle_id: string | null
          verified: boolean
        }
        Insert: {
          ai_confidence_score?: number | null
          ai_extracted_data?: Json | null
          ai_scan_errors?: string[] | null
          ai_scan_status?: string | null
          ai_validation_score?: number | null
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
          rental_id?: string | null
          scanned_at?: string | null
          start_date?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string
          uploaded_at?: string | null
          vehicle_id?: string | null
          verified?: boolean
        }
        Update: {
          ai_confidence_score?: number | null
          ai_extracted_data?: Json | null
          ai_scan_errors?: string[] | null
          ai_scan_status?: string | null
          ai_validation_score?: number | null
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
          rental_id?: string | null
          scanned_at?: string | null
          start_date?: string | null
          status?: string | null
          tenant_id?: string | null
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
            foreignKeyName: "customer_documents_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_documents_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_documents_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "customer_documents_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "customer_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
      customer_notifications: {
        Row: {
          created_at: string | null
          customer_user_id: string
          id: string
          is_read: boolean | null
          link: string | null
          message: string
          metadata: Json | null
          tenant_id: string | null
          title: string
          type: string | null
        }
        Insert: {
          created_at?: string | null
          customer_user_id: string
          id?: string
          is_read?: boolean | null
          link?: string | null
          message: string
          metadata?: Json | null
          tenant_id?: string | null
          title: string
          type?: string | null
        }
        Update: {
          created_at?: string | null
          customer_user_id?: string
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string
          metadata?: Json | null
          tenant_id?: string | null
          title?: string
          type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_notifications_customer_user_id_fkey"
            columns: ["customer_user_id"]
            isOneToOne: false
            referencedRelation: "customer_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_registration_invites: {
        Row: {
          completed_at: string | null
          created_at: string
          created_by: string
          customer_id: string | null
          expires_at: string
          id: string
          status: string
          tenant_id: string
          token: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          created_by: string
          customer_id?: string | null
          expires_at: string
          id?: string
          status?: string
          tenant_id: string
          token?: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          created_by?: string
          customer_id?: string | null
          expires_at?: string
          id?: string
          status?: string
          tenant_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_registration_invites_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_registration_invites_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_registration_invites_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_registration_invites_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_registration_invites_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_registration_invites_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_users: {
        Row: {
          auth_user_id: string
          created_at: string | null
          customer_id: string
          email_verified: boolean | null
          email_verified_at: string | null
          id: string
          pending_email: string | null
          pending_email_expires_at: string | null
          pending_email_token: string | null
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          auth_user_id: string
          created_at?: string | null
          customer_id: string
          email_verified?: boolean | null
          email_verified_at?: string | null
          id?: string
          pending_email?: string | null
          pending_email_expires_at?: string | null
          pending_email_token?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          auth_user_id?: string
          created_at?: string | null
          customer_id?: string
          email_verified?: boolean | null
          email_verified_at?: string | null
          id?: string
          pending_email?: string | null
          pending_email_expires_at?: string | null
          pending_email_token?: string | null
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_users_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_users_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_users_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_users_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "customer_users_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          blocked_at: string | null
          blocked_reason: string | null
          created_at: string | null
          customer_type: string | null
          date_of_birth: string | null
          email: string | null
          high_switcher: boolean | null
          id: string
          id_number: string | null
          identity_verification_status: string | null
          is_blocked: boolean | null
          license_number: string | null
          name: string
          nok_address: string | null
          nok_email: string | null
          nok_full_name: string | null
          nok_phone: string | null
          nok_relationship: string | null
          phone: string | null
          profile_photo_url: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          status: string | null
          stripe_customer_id: string | null
          tenant_id: string | null
          timezone: string | null
          type: string
          updated_at: string
          whatsapp_opt_in: boolean | null
        }
        Insert: {
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string | null
          customer_type?: string | null
          date_of_birth?: string | null
          email?: string | null
          high_switcher?: boolean | null
          id?: string
          id_number?: string | null
          identity_verification_status?: string | null
          is_blocked?: boolean | null
          license_number?: string | null
          name: string
          nok_address?: string | null
          nok_email?: string | null
          nok_full_name?: string | null
          nok_phone?: string | null
          nok_relationship?: string | null
          phone?: string | null
          profile_photo_url?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          tenant_id?: string | null
          timezone?: string | null
          type: string
          updated_at?: string
          whatsapp_opt_in?: boolean | null
        }
        Update: {
          blocked_at?: string | null
          blocked_reason?: string | null
          created_at?: string | null
          customer_type?: string | null
          date_of_birth?: string | null
          email?: string | null
          high_switcher?: boolean | null
          id?: string
          id_number?: string | null
          identity_verification_status?: string | null
          is_blocked?: boolean | null
          license_number?: string | null
          name?: string
          nok_address?: string | null
          nok_email?: string | null
          nok_full_name?: string | null
          nok_phone?: string | null
          nok_relationship?: string | null
          phone?: string | null
          profile_photo_url?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          tenant_id?: string | null
          timezone?: string | null
          type?: string
          updated_at?: string
          whatsapp_opt_in?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      delivery_locations: {
        Row: {
          address: string
          collection_fee: number
          created_at: string
          delivery_fee: number
          id: string
          is_active: boolean
          is_collection_enabled: boolean
          is_delivery_enabled: boolean
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address: string
          collection_fee?: number
          created_at?: string
          delivery_fee?: number
          id?: string
          is_active?: boolean
          is_collection_enabled?: boolean
          is_delivery_enabled?: boolean
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string
          collection_fee?: number
          created_at?: string
          delivery_fee?: number
          id?: string
          is_active?: boolean
          is_collection_enabled?: boolean
          is_delivery_enabled?: boolean
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delivery_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          metadata: Json | null
          recipient_email: string
          recipient_name: string | null
          sent_at: string | null
          status: string | null
          subject: string
          template: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          recipient_email: string
          recipient_name?: string | null
          sent_at?: string | null
          status?: string | null
          subject: string
          template: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          metadata?: Json | null
          recipient_email?: string
          recipient_name?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string
          template?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body: string | null
          category: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          name: string | null
          subject: string
          template_content: string
          template_key: string
          template_name: string
          tenant_id: string | null
          updated_at: string | null
          variables: Json | null
        }
        Insert: {
          body?: string | null
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          subject: string
          template_content: string
          template_key: string
          template_name: string
          tenant_id?: string | null
          updated_at?: string | null
          variables?: Json | null
        }
        Update: {
          body?: string | null
          category?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          name?: string | null
          subject?: string
          template_content?: string
          template_key?: string
          template_name?: string
          tenant_id?: string | null
          updated_at?: string | null
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      faqs: {
        Row: {
          answer: string
          created_at: string | null
          display_order: number | null
          id: string
          is_active: boolean | null
          question: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          answer: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          question: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          answer?: string
          created_at?: string | null
          display_order?: number | null
          id?: string
          is_active?: boolean | null
          question?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "faqs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fine_files: {
        Row: {
          file_name: string | null
          file_url: string
          fine_id: string | null
          id: string
          tenant_id: string | null
          uploaded_at: string | null
        }
        Insert: {
          file_name?: string | null
          file_url: string
          fine_id?: string | null
          id?: string
          tenant_id?: string | null
          uploaded_at?: string | null
        }
        Update: {
          file_name?: string | null
          file_url?: string
          fine_id?: string | null
          id?: string
          tenant_id?: string | null
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
          {
            foreignKeyName: "fine_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
            foreignKeyName: "fines_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "fines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
      global_admin_config: {
        Row: {
          created_at: string | null
          id: string
          master_email: string
          master_password_hash: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          master_email?: string
          master_password_hash: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          master_email?: string
          master_password_hash?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      global_blacklist: {
        Row: {
          blocked_tenant_count: number
          created_at: string | null
          email: string
          first_blocked_at: string | null
          id: string
          last_blocked_at: string | null
          updated_at: string | null
        }
        Insert: {
          blocked_tenant_count?: number
          created_at?: string | null
          email: string
          first_blocked_at?: string | null
          id?: string
          last_blocked_at?: string | null
          updated_at?: string | null
        }
        Update: {
          blocked_tenant_count?: number
          created_at?: string | null
          email?: string
          first_blocked_at?: string | null
          id?: string
          last_blocked_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      identity_verifications: {
        Row: {
          address: string | null
          ai_face_match_result: string | null
          ai_face_match_score: number | null
          ai_ocr_data: Json | null
          client_comment: string | null
          created_at: string | null
          customer_email: string | null
          customer_id: string | null
          date_of_birth: string | null
          document_back_url: string | null
          document_country: string | null
          document_expiry_date: string | null
          document_front_url: string | null
          document_issuing_date: string | null
          document_number: string | null
          document_type: string | null
          external_user_id: string | null
          face_image_url: string | null
          first_name: string | null
          id: string
          last_name: string | null
          media_fetched_at: string | null
          moderator_comment: string | null
          provider: string
          qr_session_expires_at: string | null
          qr_session_token: string | null
          rejection_labels: string[] | null
          rejection_reason: string | null
          review_result: string | null
          review_status: string | null
          selfie_image_url: string | null
          session_id: string | null
          status: string
          tenant_id: string | null
          updated_at: string | null
          upload_progress: Json | null
          verification_completed_at: string | null
          verification_provider: string | null
          verification_step: string | null
          verification_token: string | null
          verification_url: string | null
          verified_by: string | null
        }
        Insert: {
          address?: string | null
          ai_face_match_result?: string | null
          ai_face_match_score?: number | null
          ai_ocr_data?: Json | null
          client_comment?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_id?: string | null
          date_of_birth?: string | null
          document_back_url?: string | null
          document_country?: string | null
          document_expiry_date?: string | null
          document_front_url?: string | null
          document_issuing_date?: string | null
          document_number?: string | null
          document_type?: string | null
          external_user_id?: string | null
          face_image_url?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          media_fetched_at?: string | null
          moderator_comment?: string | null
          provider?: string
          qr_session_expires_at?: string | null
          qr_session_token?: string | null
          rejection_labels?: string[] | null
          rejection_reason?: string | null
          review_result?: string | null
          review_status?: string | null
          selfie_image_url?: string | null
          session_id?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string | null
          upload_progress?: Json | null
          verification_completed_at?: string | null
          verification_provider?: string | null
          verification_step?: string | null
          verification_token?: string | null
          verification_url?: string | null
          verified_by?: string | null
        }
        Update: {
          address?: string | null
          ai_face_match_result?: string | null
          ai_face_match_score?: number | null
          ai_ocr_data?: Json | null
          client_comment?: string | null
          created_at?: string | null
          customer_email?: string | null
          customer_id?: string | null
          date_of_birth?: string | null
          document_back_url?: string | null
          document_country?: string | null
          document_expiry_date?: string | null
          document_front_url?: string | null
          document_issuing_date?: string | null
          document_number?: string | null
          document_type?: string | null
          external_user_id?: string | null
          face_image_url?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          media_fetched_at?: string | null
          moderator_comment?: string | null
          provider?: string
          qr_session_expires_at?: string | null
          qr_session_token?: string | null
          rejection_labels?: string[] | null
          rejection_reason?: string | null
          review_result?: string | null
          review_status?: string | null
          selfie_image_url?: string | null
          session_id?: string | null
          status?: string
          tenant_id?: string | null
          updated_at?: string | null
          upload_progress?: Json | null
          verification_completed_at?: string | null
          verification_provider?: string | null
          verification_step?: string | null
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
          {
            foreignKeyName: "identity_verifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "identity_verifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_notifications: {
        Row: {
          created_at: string
          id: string
          installment_id: string
          notification_type: string
          sent_at: string
          tenant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          installment_id: string
          notification_type: string
          sent_at?: string
          tenant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          installment_id?: string
          notification_type?: string
          sent_at?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installment_notifications_installment_id_fkey"
            columns: ["installment_id"]
            isOneToOne: false
            referencedRelation: "scheduled_installments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      installment_plans: {
        Row: {
          config: Json | null
          created_at: string | null
          customer_id: string
          id: string
          installment_amount: number
          next_due_date: string | null
          number_of_installments: number
          paid_installments: number | null
          plan_type: string
          rental_id: string
          status: string
          stripe_customer_id: string | null
          stripe_payment_method_id: string | null
          stripe_setup_intent_id: string | null
          tenant_id: string
          total_installable_amount: number
          total_paid: number | null
          updated_at: string | null
          upfront_amount: number
          upfront_paid: boolean | null
          upfront_payment_id: string | null
        }
        Insert: {
          config?: Json | null
          created_at?: string | null
          customer_id: string
          id?: string
          installment_amount: number
          next_due_date?: string | null
          number_of_installments: number
          paid_installments?: number | null
          plan_type: string
          rental_id: string
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_setup_intent_id?: string | null
          tenant_id: string
          total_installable_amount: number
          total_paid?: number | null
          updated_at?: string | null
          upfront_amount?: number
          upfront_paid?: boolean | null
          upfront_payment_id?: string | null
        }
        Update: {
          config?: Json | null
          created_at?: string | null
          customer_id?: string
          id?: string
          installment_amount?: number
          next_due_date?: string | null
          number_of_installments?: number
          paid_installments?: number | null
          plan_type?: string
          rental_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_payment_method_id?: string | null
          stripe_setup_intent_id?: string | null
          tenant_id?: string
          total_installable_amount?: number
          total_paid?: number | null
          updated_at?: string | null
          upfront_amount?: number
          upfront_paid?: boolean | null
          upfront_payment_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installment_plans_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "installment_plans_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "installment_plans_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "installment_plans_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "installment_plans_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "installment_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_upfront_payment_id_fkey"
            columns: ["upfront_payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installment_plans_upfront_payment_id_fkey"
            columns: ["upfront_payment_id"]
            isOneToOne: false
            referencedRelation: "v_payment_remaining"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "installment_plans_upfront_payment_id_fkey"
            columns: ["upfront_payment_id"]
            isOneToOne: false
            referencedRelation: "view_payments_export"
            referencedColumns: ["payment_id"]
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
          tenant_id: string | null
          uploaded_at: string | null
        }
        Insert: {
          doc_type: string
          file_name?: string | null
          file_url: string
          id?: string
          policy_id: string
          tenant_id?: string | null
          uploaded_at?: string | null
        }
        Update: {
          doc_type?: string
          file_name?: string | null
          file_url?: string
          id?: string
          policy_id?: string
          tenant_id?: string | null
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
          {
            foreignKeyName: "insurance_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
            foreignKeyName: "insurance_policies_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "insurance_policies_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          delivery_fee: number | null
          due_date: string | null
          extras_total: number | null
          id: string
          insurance_premium: number | null
          invoice_date: string
          invoice_number: string
          notes: string | null
          protection_fee: number | null
          rental_fee: number | null
          rental_id: string
          security_deposit: number | null
          service_fee: number | null
          status: string | null
          subtotal: number
          tax_amount: number | null
          tenant_id: string | null
          total_amount: number
          updated_at: string | null
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string | null
          customer_id?: string | null
          delivery_fee?: number | null
          due_date?: string | null
          extras_total?: number | null
          id?: string
          insurance_premium?: number | null
          invoice_date: string
          invoice_number: string
          notes?: string | null
          protection_fee?: number | null
          rental_fee?: number | null
          rental_id: string
          security_deposit?: number | null
          service_fee?: number | null
          status?: string | null
          subtotal: number
          tax_amount?: number | null
          tenant_id?: string | null
          total_amount: number
          updated_at?: string | null
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string | null
          customer_id?: string | null
          delivery_fee?: number | null
          due_date?: string | null
          extras_total?: number | null
          id?: string
          insurance_premium?: number | null
          invoice_date?: string
          invoice_number?: string
          notes?: string | null
          protection_fee?: number | null
          rental_fee?: number | null
          rental_id?: string
          security_deposit?: number | null
          service_fee?: number | null
          status?: string | null
          subtotal?: number
          tax_amount?: number | null
          tenant_id?: string | null
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
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
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
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
          {
            foreignKeyName: "leads_converted_to_customer_id_fkey"
            columns: ["converted_to_customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "leads_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
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
            foreignKeyName: "ledger_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          tenant_id: string | null
          username: string
        }
        Insert: {
          attempted_at?: string | null
          id?: string
          ip_address?: string | null
          success?: boolean
          tenant_id?: string | null
          username: string
        }
        Update: {
          attempted_at?: string | null
          id?: string
          ip_address?: string | null
          success?: boolean
          tenant_id?: string | null
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "login_attempts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_runs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          id: string
          is_read: boolean | null
          link: string | null
          message: string
          metadata: Json | null
          tenant_id: string | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message: string
          metadata?: Json | null
          tenant_id?: string | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_read?: boolean | null
          link?: string | null
          message?: string
          metadata?: Json | null
          tenant_id?: string | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          accent_color: string | null
          app_name: string | null
          booking_payment_mode: string | null
          company_name: string
          created_at: string
          currency_code: string
          dark_accent_color: string | null
          dark_background_color: string | null
          dark_header_footer_color: string | null
          dark_primary_color: string | null
          dark_secondary_color: string | null
          date_format: string
          distance_unit: string
          email_from_address: string | null
          email_from_name: string | null
          email_reply_to: string | null
          favicon_url: string | null
          id: string
          light_accent_color: string | null
          light_background_color: string | null
          light_header_footer_color: string | null
          light_primary_color: string | null
          light_secondary_color: string | null
          logo_url: string | null
          meta_description: string | null
          meta_title: string | null
          og_image_url: string | null
          org_id: string
          payment_mode: string | null
          primary_color: string | null
          reminder_due_soon_2d: boolean
          reminder_due_today: boolean
          reminder_overdue_1d: boolean
          reminder_overdue_multi: boolean
          secondary_color: string | null
          sms_sender_name: string | null
          tenant_id: string | null
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
          accent_color?: string | null
          app_name?: string | null
          booking_payment_mode?: string | null
          company_name?: string
          created_at?: string
          currency_code?: string
          dark_accent_color?: string | null
          dark_background_color?: string | null
          dark_header_footer_color?: string | null
          dark_primary_color?: string | null
          dark_secondary_color?: string | null
          date_format?: string
          distance_unit?: string
          email_from_address?: string | null
          email_from_name?: string | null
          email_reply_to?: string | null
          favicon_url?: string | null
          id?: string
          light_accent_color?: string | null
          light_background_color?: string | null
          light_header_footer_color?: string | null
          light_primary_color?: string | null
          light_secondary_color?: string | null
          logo_url?: string | null
          meta_description?: string | null
          meta_title?: string | null
          og_image_url?: string | null
          org_id?: string
          payment_mode?: string | null
          primary_color?: string | null
          reminder_due_soon_2d?: boolean
          reminder_due_today?: boolean
          reminder_overdue_1d?: boolean
          reminder_overdue_multi?: boolean
          secondary_color?: string | null
          sms_sender_name?: string | null
          tenant_id?: string | null
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
          accent_color?: string | null
          app_name?: string | null
          booking_payment_mode?: string | null
          company_name?: string
          created_at?: string
          currency_code?: string
          dark_accent_color?: string | null
          dark_background_color?: string | null
          dark_header_footer_color?: string | null
          dark_primary_color?: string | null
          dark_secondary_color?: string | null
          date_format?: string
          distance_unit?: string
          email_from_address?: string | null
          email_from_name?: string | null
          email_reply_to?: string | null
          favicon_url?: string | null
          id?: string
          light_accent_color?: string | null
          light_background_color?: string | null
          light_header_footer_color?: string | null
          light_primary_color?: string | null
          light_secondary_color?: string | null
          logo_url?: string | null
          meta_description?: string | null
          meta_title?: string | null
          og_image_url?: string | null
          org_id?: string
          payment_mode?: string | null
          primary_color?: string | null
          reminder_due_soon_2d?: boolean
          reminder_due_today?: boolean
          reminder_overdue_1d?: boolean
          reminder_overdue_multi?: boolean
          secondary_color?: string | null
          sms_sender_name?: string | null
          tenant_id?: string | null
          tests_last_result_dashboard?: Json | null
          tests_last_result_finance?: Json | null
          tests_last_result_rental?: Json | null
          tests_last_run_dashboard?: string | null
          tests_last_run_finance?: string | null
          tests_last_run_rental?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_applications: {
        Row: {
          amount_applied: number
          charge_entry_id: string | null
          id: string
          payment_id: string | null
          tenant_id: string | null
        }
        Insert: {
          amount_applied: number
          charge_entry_id?: string | null
          id?: string
          payment_id?: string | null
          tenant_id?: string | null
        }
        Update: {
          amount_applied?: number
          charge_entry_id?: string | null
          id?: string
          payment_id?: string | null
          tenant_id?: string | null
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
          {
            foreignKeyName: "payment_applications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          apply_from_date: string | null
          booking_source: string | null
          capture_status: string | null
          created_at: string
          customer_id: string
          id: string
          is_early: boolean
          is_manual_mode: boolean | null
          method: string | null
          payment_date: string
          payment_type: string
          preauth_expires_at: string | null
          refund_amount: number | null
          refund_processed_at: string | null
          refund_reason: string | null
          refund_scheduled_by: string | null
          refund_scheduled_date: string | null
          refund_status: string | null
          rejection_reason: string | null
          remaining_amount: number | null
          rental_id: string | null
          status: string | null
          stripe_checkout_session_id: string | null
          stripe_payment_intent_id: string | null
          stripe_refund_id: string | null
          tenant_id: string | null
          updated_at: string
          vehicle_id: string | null
          verification_status: string | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          amount: number
          apply_from_date?: string | null
          booking_source?: string | null
          capture_status?: string | null
          created_at?: string
          customer_id: string
          id?: string
          is_early?: boolean
          is_manual_mode?: boolean | null
          method?: string | null
          payment_date?: string
          payment_type?: string
          preauth_expires_at?: string | null
          refund_amount?: number | null
          refund_processed_at?: string | null
          refund_reason?: string | null
          refund_scheduled_by?: string | null
          refund_scheduled_date?: string | null
          refund_status?: string | null
          rejection_reason?: string | null
          remaining_amount?: number | null
          rental_id?: string | null
          status?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          amount?: number
          apply_from_date?: string | null
          booking_source?: string | null
          capture_status?: string | null
          created_at?: string
          customer_id?: string
          id?: string
          is_early?: boolean
          is_manual_mode?: boolean | null
          method?: string | null
          payment_date?: string
          payment_type?: string
          preauth_expires_at?: string | null
          refund_amount?: number | null
          refund_processed_at?: string | null
          refund_reason?: string | null
          refund_scheduled_by?: string | null
          refund_scheduled_date?: string | null
          refund_status?: string | null
          rejection_reason?: string | null
          remaining_amount?: number | null
          rental_id?: string | null
          status?: string | null
          stripe_checkout_session_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_refund_id?: string | null
          tenant_id?: string | null
          updated_at?: string
          vehicle_id?: string | null
          verification_status?: string | null
          verified_at?: string | null
          verified_by?: string | null
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
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "payments_refund_scheduled_by_fkey"
            columns: ["refund_scheduled_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
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
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "payments_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "payments_verified_by_fkey"
            columns: ["verified_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      pickup_locations: {
        Row: {
          address: string
          created_at: string
          delivery_fee: number
          id: string
          is_active: boolean
          is_pickup_enabled: boolean
          is_return_enabled: boolean
          name: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          address: string
          created_at?: string
          delivery_fee?: number
          id?: string
          is_active?: boolean
          is_pickup_enabled?: boolean
          is_return_enabled?: boolean
          name: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          address?: string
          created_at?: string
          delivery_fee?: number
          id?: string
          is_active?: boolean
          is_pickup_enabled?: boolean
          is_return_enabled?: boolean
          name?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pickup_locations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "plates_assigned_vehicle_id_fkey"
            columns: ["assigned_vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "plates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pnl_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
      promocodes: {
        Row: {
          code: string
          created_at: string
          created_by: string | null
          expires_at: string
          id: string
          max_users: number
          name: string
          promo_id: number | null
          tenant_id: string | null
          type: string
          value: number
        }
        Insert: {
          code: string
          created_at?: string
          created_by?: string | null
          expires_at: string
          id?: string
          max_users?: number
          name: string
          promo_id?: number | null
          tenant_id?: string | null
          type: string
          value: number
        }
        Update: {
          code?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string
          id?: string
          max_users?: number
          name?: string
          promo_id?: number | null
          tenant_id?: string | null
          type?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "promocodes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          created_at: string | null
          description: string
          discount_type: string
          discount_value: number
          end_date: string
          id: string
          image_url: string | null
          is_active: boolean | null
          minimum_spend: number | null
          promo_code: string | null
          start_date: string
          tenant_id: string | null
          title: string
        }
        Insert: {
          created_at?: string | null
          description: string
          discount_type: string
          discount_value: number
          end_date: string
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          minimum_spend?: number | null
          promo_code?: string | null
          start_date: string
          tenant_id?: string | null
          title: string
        }
        Update: {
          created_at?: string | null
          description?: string
          discount_type?: string
          discount_value?: number
          end_date?: string
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          minimum_spend?: number | null
          promo_code?: string | null
          start_date?: string
          tenant_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "promotions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rag_documents: {
        Row: {
          content: string
          created_at: string | null
          embedding: string | null
          id: number
          metadata: Json | null
          source_id: string
          source_table: string
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          embedding?: string | null
          id?: number
          metadata?: Json | null
          source_id: string
          source_table: string
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          embedding?: string | null
          id?: number
          metadata?: Json | null
          source_id?: string
          source_table?: string
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rag_documents_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rag_sync_queue: {
        Row: {
          action: string
          created_at: string | null
          error_message: string | null
          id: number
          processed_at: string | null
          source_id: string
          source_table: string
          tenant_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          error_message?: string | null
          id?: number
          processed_at?: string | null
          source_id: string
          source_table: string
          tenant_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          error_message?: string | null
          id?: number
          processed_at?: string | null
          source_id?: string
          source_table?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rag_sync_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_actions: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          id: string
          note: string | null
          reminder_id: string
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          reminder_id: string
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          reminder_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_actions_reminder_id_fkey"
            columns: ["reminder_id"]
            isOneToOne: false
            referencedRelation: "reminders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminder_actions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_config: {
        Row: {
          config_key: string
          config_value: Json
          id: string
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          config_key: string
          config_value: Json
          id?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          config_key?: string
          config_value?: Json
          id?: string
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_config_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_emails: {
        Row: {
          body_html: string | null
          body_text: string | null
          id: string
          meta: Json | null
          sent_at: string
          subject: string
          tenant_id: string | null
          to_address: string
        }
        Insert: {
          body_html?: string | null
          body_text?: string | null
          id?: string
          meta?: Json | null
          sent_at?: string
          subject: string
          tenant_id?: string | null
          to_address: string
        }
        Update: {
          body_html?: string | null
          body_text?: string | null
          id?: string
          meta?: Json | null
          sent_at?: string
          subject?: string
          tenant_id?: string | null
          to_address?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_emails_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
            foreignKeyName: "reminder_events_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
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
            foreignKeyName: "reminder_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reminder_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_settings: {
        Row: {
          id: string
          setting_key: string
          setting_value: Json
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          id?: string
          setting_key: string
          setting_value: Json
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          id?: string
          setting_key?: string
          setting_value?: Json
          tenant_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_agreement_templates: {
        Row: {
          created_at: string | null
          created_by: string | null
          html_content: string
          id: string
          is_active: boolean | null
          is_default: boolean | null
          name: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          html_content: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          html_content?: string
          id?: string
          is_active?: boolean | null
          is_default?: boolean | null
          name?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_agreement_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_agreement_templates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_extras: {
        Row: {
          created_at: string
          description: string | null
          id: string
          image_urls: string[] | null
          is_active: boolean
          max_quantity: number | null
          name: string
          price: number
          pricing_type: string
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          image_urls?: string[] | null
          is_active?: boolean
          max_quantity?: number | null
          name: string
          price: number
          pricing_type?: string
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          image_urls?: string[] | null
          is_active?: boolean
          max_quantity?: number | null
          name?: string
          price?: number
          pricing_type?: string
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_extras_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_extras_selections: {
        Row: {
          created_at: string
          extra_id: string
          id: string
          price_at_booking: number
          quantity: number
          rental_id: string
        }
        Insert: {
          created_at?: string
          extra_id: string
          id?: string
          price_at_booking: number
          quantity?: number
          rental_id: string
        }
        Update: {
          created_at?: string
          extra_id?: string
          id?: string
          price_at_booking?: number
          quantity?: number
          rental_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_extras_selections_extra_id_fkey"
            columns: ["extra_id"]
            isOneToOne: false
            referencedRelation: "rental_extras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_extras_selections_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_extras_selections_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "rental_extras_selections_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
        ]
      }
      rental_extras_vehicle_pricing: {
        Row: {
          created_at: string
          extra_id: string
          id: string
          price: number
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          extra_id: string
          id?: string
          price: number
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          extra_id?: string
          id?: string
          price?: number
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_extras_vehicle_pricing_extra_id_fkey"
            columns: ["extra_id"]
            isOneToOne: false
            referencedRelation: "rental_extras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_extras_vehicle_pricing_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicle_pnl_rollup"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "rental_extras_vehicle_pricing_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_extras_vehicle_pricing_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
          },
          {
            foreignKeyName: "rental_extras_vehicle_pricing_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "view_pl_by_vehicle"
            referencedColumns: ["vehicle_id"]
          },
        ]
      }
      rental_handover_photos: {
        Row: {
          caption: string | null
          file_name: string
          file_path: string
          file_url: string
          handover_id: string
          id: string
          tenant_id: string | null
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          file_name: string
          file_path: string
          file_url: string
          handover_id: string
          id?: string
          tenant_id?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          file_name?: string
          file_path?: string
          file_url?: string
          handover_id?: string
          id?: string
          tenant_id?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_handover_photos_handover_id_fkey"
            columns: ["handover_id"]
            isOneToOne: false
            referencedRelation: "rental_key_handovers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_handover_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_handover_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_insurance_verifications: {
        Row: {
          axle_account_id: string | null
          axle_policy_id: string | null
          carrier_name: string | null
          coverage_verified: boolean | null
          created_at: string | null
          customer_id: string | null
          id: string
          policy_details: Json | null
          policy_number: string | null
          rental_id: string | null
          tenant_id: string | null
          updated_at: string | null
          verification_status: string
          verification_type: string
        }
        Insert: {
          axle_account_id?: string | null
          axle_policy_id?: string | null
          carrier_name?: string | null
          coverage_verified?: boolean | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          policy_details?: Json | null
          policy_number?: string | null
          rental_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          verification_status?: string
          verification_type?: string
        }
        Update: {
          axle_account_id?: string | null
          axle_policy_id?: string | null
          carrier_name?: string | null
          coverage_verified?: boolean | null
          created_at?: string | null
          customer_id?: string | null
          id?: string
          policy_details?: Json | null
          policy_number?: string | null
          rental_id?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          verification_status?: string
          verification_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "rental_insurance_verifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_insurance_verifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "rental_insurance_verifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "rental_insurance_verifications_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "rental_insurance_verifications_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_insurance_verifications_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "rental_insurance_verifications_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "rental_insurance_verifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rental_key_handovers: {
        Row: {
          created_at: string | null
          handed_at: string | null
          handed_by: string | null
          handover_type: Database["public"]["Enums"]["key_handover_type"]
          id: string
          mileage: number | null
          notes: string | null
          rental_id: string
          tenant_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          handed_at?: string | null
          handed_by?: string | null
          handover_type: Database["public"]["Enums"]["key_handover_type"]
          id?: string
          mileage?: number | null
          notes?: string | null
          rental_id: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          handed_at?: string | null
          handed_by?: string | null
          handover_type?: Database["public"]["Enums"]["key_handover_type"]
          id?: string
          mileage?: number | null
          notes?: string | null
          rental_id?: string
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rental_key_handovers_handed_by_fkey"
            columns: ["handed_by"]
            isOneToOne: false
            referencedRelation: "app_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_key_handovers_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rental_key_handovers_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "rental_key_handovers_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "rental_key_handovers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      rentals: {
        Row: {
          approval_status: string | null
          bonzah_policy_id: string | null
          cancellation_reason: string | null
          cancellation_requested: boolean | null
          collection_address: string | null
          collection_fee: number | null
          collection_location_id: string | null
          created_at: string | null
          customer_id: string | null
          delivery_address: string | null
          delivery_fee: number | null
          delivery_location_id: string | null
          delivery_option: string | null
          discount_applied: number | null
          document_status: string | null
          docusign_envelope_id: string | null
          driver_age_range: string | null
          end_date: string | null
          envelope_completed_at: string | null
          envelope_created_at: string | null
          envelope_sent_at: string | null
          extension_checkout_url: string | null
          has_installment_plan: boolean | null
          id: string
          installment_plan_id: string | null
          insurance_premium: number | null
          insurance_status: string | null
          is_extended: boolean | null
          monthly_amount: number
          payment_mode: string | null
          payment_status: string | null
          pickup_location: string | null
          pickup_location_id: string | null
          pickup_time: string | null
          previous_end_date: string | null
          promo_code: string | null
          renewed_from_rental_id: string | null
          rental_number: string | null
          rental_period_type: string | null
          return_location: string | null
          return_location_id: string | null
          return_time: string | null
          schedule: string | null
          signed_document_id: string | null
          source: string | null
          start_date: string
          status: string | null
          tenant_id: string | null
          updated_at: string
          uses_delivery_service: boolean | null
          vehicle_id: string | null
        }
        Insert: {
          approval_status?: string | null
          bonzah_policy_id?: string | null
          cancellation_reason?: string | null
          cancellation_requested?: boolean | null
          collection_address?: string | null
          collection_fee?: number | null
          collection_location_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          delivery_address?: string | null
          delivery_fee?: number | null
          delivery_location_id?: string | null
          delivery_option?: string | null
          discount_applied?: number | null
          document_status?: string | null
          docusign_envelope_id?: string | null
          driver_age_range?: string | null
          end_date?: string | null
          envelope_completed_at?: string | null
          envelope_created_at?: string | null
          envelope_sent_at?: string | null
          extension_checkout_url?: string | null
          has_installment_plan?: boolean | null
          id?: string
          installment_plan_id?: string | null
          insurance_premium?: number | null
          insurance_status?: string | null
          is_extended?: boolean | null
          monthly_amount: number
          payment_mode?: string | null
          payment_status?: string | null
          pickup_location?: string | null
          pickup_location_id?: string | null
          pickup_time?: string | null
          previous_end_date?: string | null
          promo_code?: string | null
          renewed_from_rental_id?: string | null
          rental_number?: string | null
          rental_period_type?: string | null
          return_location?: string | null
          return_location_id?: string | null
          return_time?: string | null
          schedule?: string | null
          signed_document_id?: string | null
          source?: string | null
          start_date: string
          status?: string | null
          tenant_id?: string | null
          updated_at?: string
          uses_delivery_service?: boolean | null
          vehicle_id?: string | null
        }
        Update: {
          approval_status?: string | null
          bonzah_policy_id?: string | null
          cancellation_reason?: string | null
          cancellation_requested?: boolean | null
          collection_address?: string | null
          collection_fee?: number | null
          collection_location_id?: string | null
          created_at?: string | null
          customer_id?: string | null
          delivery_address?: string | null
          delivery_fee?: number | null
          delivery_location_id?: string | null
          delivery_option?: string | null
          discount_applied?: number | null
          document_status?: string | null
          docusign_envelope_id?: string | null
          driver_age_range?: string | null
          end_date?: string | null
          envelope_completed_at?: string | null
          envelope_created_at?: string | null
          envelope_sent_at?: string | null
          extension_checkout_url?: string | null
          has_installment_plan?: boolean | null
          id?: string
          installment_plan_id?: string | null
          insurance_premium?: number | null
          insurance_status?: string | null
          is_extended?: boolean | null
          monthly_amount?: number
          payment_mode?: string | null
          payment_status?: string | null
          pickup_location?: string | null
          pickup_location_id?: string | null
          pickup_time?: string | null
          previous_end_date?: string | null
          promo_code?: string | null
          renewed_from_rental_id?: string | null
          rental_number?: string | null
          rental_period_type?: string | null
          return_location?: string | null
          return_location_id?: string | null
          return_time?: string | null
          schedule?: string | null
          signed_document_id?: string | null
          source?: string | null
          start_date?: string
          status?: string | null
          tenant_id?: string | null
          updated_at?: string
          uses_delivery_service?: boolean | null
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rentals_bonzah_policy_id_fkey"
            columns: ["bonzah_policy_id"]
            isOneToOne: false
            referencedRelation: "bonzah_insurance_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_collection_location_id_fkey"
            columns: ["collection_location_id"]
            isOneToOne: false
            referencedRelation: "delivery_locations"
            referencedColumns: ["id"]
          },
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
            foreignKeyName: "rentals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "rentals_delivery_location_id_fkey"
            columns: ["delivery_location_id"]
            isOneToOne: false
            referencedRelation: "delivery_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_installment_plan_id_fkey"
            columns: ["installment_plan_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_pickup_location_id_fkey"
            columns: ["pickup_location_id"]
            isOneToOne: false
            referencedRelation: "pickup_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_renewed_from_rental_id_fkey"
            columns: ["renewed_from_rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_renewed_from_rental_id_fkey"
            columns: ["renewed_from_rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "rentals_renewed_from_rental_id_fkey"
            columns: ["renewed_from_rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "rentals_return_location_id_fkey"
            columns: ["return_location_id"]
            isOneToOne: false
            referencedRelation: "pickup_locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_signed_document_id_fkey"
            columns: ["signed_document_id"]
            isOneToOne: false
            referencedRelation: "customer_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rentals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
      scheduled_installments: {
        Row: {
          amount: number
          created_at: string | null
          customer_id: string
          due_date: string
          failure_count: number | null
          id: string
          installment_number: number
          installment_plan_id: string
          last_attempted_at: string | null
          last_failure_reason: string | null
          ledger_entry_id: string | null
          paid_at: string | null
          payment_id: string | null
          rental_id: string
          status: string
          stripe_charge_id: string | null
          stripe_payment_intent_id: string | null
          tenant_id: string
          updated_at: string | null
        }
        Insert: {
          amount: number
          created_at?: string | null
          customer_id: string
          due_date: string
          failure_count?: number | null
          id?: string
          installment_number: number
          installment_plan_id: string
          last_attempted_at?: string | null
          last_failure_reason?: string | null
          ledger_entry_id?: string | null
          paid_at?: string | null
          payment_id?: string | null
          rental_id: string
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id: string
          updated_at?: string | null
        }
        Update: {
          amount?: number
          created_at?: string | null
          customer_id?: string
          due_date?: string
          failure_count?: number | null
          id?: string
          installment_number?: number
          installment_plan_id?: string
          last_attempted_at?: string | null
          last_failure_reason?: string | null
          ledger_entry_id?: string | null
          paid_at?: string | null
          payment_id?: string | null
          rental_id?: string
          status?: string
          stripe_charge_id?: string | null
          stripe_payment_intent_id?: string | null
          tenant_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_installments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_installments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "v_customer_credit"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "scheduled_installments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_aging_receivables"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "scheduled_installments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "scheduled_installments_installment_plan_id_fkey"
            columns: ["installment_plan_id"]
            isOneToOne: false
            referencedRelation: "installment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_installments_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_installments_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: false
            referencedRelation: "view_customer_statements"
            referencedColumns: ["entry_id"]
          },
          {
            foreignKeyName: "scheduled_installments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_installments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "v_payment_remaining"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "scheduled_installments_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "view_payments_export"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "scheduled_installments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "rentals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_installments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "v_rental_credit"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "scheduled_installments_rental_id_fkey"
            columns: ["rental_id"]
            isOneToOne: false
            referencedRelation: "view_rentals_export"
            referencedColumns: ["rental_id"]
          },
          {
            foreignKeyName: "scheduled_installments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
          service_type: string | null
          tenant_id: string | null
          vehicle_id: string
        }
        Insert: {
          cost?: number
          created_at?: string | null
          description?: string | null
          id?: string
          mileage?: number | null
          service_date: string
          service_type?: string | null
          tenant_id?: string | null
          vehicle_id: string
        }
        Update: {
          cost?: number
          created_at?: string | null
          description?: string | null
          id?: string
          mileage?: number | null
          service_date?: string
          service_type?: string | null
          tenant_id?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "service_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "settings_audit_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          amount: number
          created_at: string
          currency: string
          description: string | null
          features: Json
          id: string
          interval: string
          is_active: boolean
          name: string
          sort_order: number
          stripe_price_id: string | null
          stripe_product_id: string | null
          tenant_id: string
          trial_days: number
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          name: string
          sort_order?: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          tenant_id: string
          trial_days?: number
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          description?: string | null
          features?: Json
          id?: string
          interval?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          stripe_price_id?: string | null
          stripe_product_id?: string | null
          tenant_id?: string
          trial_days?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_plans_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_subscription_invoices: {
        Row: {
          amount_due: number
          amount_paid: number
          created_at: string
          currency: string
          due_date: string | null
          id: string
          invoice_number: string | null
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          status: string
          stripe_hosted_invoice_url: string | null
          stripe_invoice_id: string
          stripe_invoice_pdf: string | null
          subscription_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount_due?: number
          amount_paid?: number
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id: string
          stripe_invoice_pdf?: string | null
          subscription_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string
          stripe_hosted_invoice_url?: string | null
          stripe_invoice_id?: string
          stripe_invoice_pdf?: string | null
          subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_subscription_invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "tenant_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_subscription_invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_subscriptions: {
        Row: {
          amount: number
          cancel_at: string | null
          canceled_at: string | null
          card_brand: string | null
          card_exp_month: number | null
          card_exp_year: number | null
          card_last4: string | null
          created_at: string
          currency: string
          current_period_end: string | null
          current_period_start: string | null
          ended_at: string | null
          id: string
          interval: string
          plan_id: string | null
          plan_name: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string
          tenant_id: string
          trial_end: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          cancel_at?: string | null
          canceled_at?: string | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          ended_at?: string | null
          id?: string
          interval?: string
          plan_id?: string | null
          plan_name?: string
          status?: string
          stripe_customer_id: string
          stripe_subscription_id: string
          tenant_id: string
          trial_end?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          cancel_at?: string | null
          canceled_at?: string | null
          card_brand?: string | null
          card_exp_month?: number | null
          card_exp_year?: number | null
          card_last4?: string | null
          created_at?: string
          currency?: string
          current_period_end?: string | null
          current_period_start?: string | null
          ended_at?: string | null
          id?: string
          interval?: string
          plan_id?: string | null
          plan_name?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string
          tenant_id?: string
          trial_end?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          accent_color: string | null
          address: string | null
          admin_email: string | null
          admin_name: string | null
          app_name: string | null
          area_around_enabled: boolean | null
          area_center_lat: number | null
          area_center_lon: number | null
          area_delivery_fee: number | null
          bonzah_mode: string
          bonzah_password: string | null
          bonzah_username: string | null
          booking_lead_time_hours: number | null
          business_hours: string | null
          collection_enabled: boolean | null
          company_name: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string | null
          currency_code: string | null
          dark_accent_color: string | null
          dark_background_color: string | null
          dark_header_footer_color: string | null
          dark_primary_color: string | null
          dark_secondary_color: string | null
          date_format: string | null
          delivery_enabled: boolean | null
          deposit_mode: string | null
          distance_unit: string | null
          facebook_url: string | null
          favicon_url: string | null
          fixed_address_enabled: boolean | null
          fixed_pickup_address: string | null
          fixed_return_address: string | null
          friday_close: string | null
          friday_enabled: boolean | null
          friday_open: string | null
          global_deposit_amount: number | null
          google_maps_url: string | null
          hero_background_url: string | null
          id: string
          instagram_url: string | null
          installment_config: Json | null
          installments_enabled: boolean | null
          integration_bonzah: boolean | null
          integration_canopy: boolean | null
          integration_veriff: boolean | null
          light_accent_color: string | null
          light_background_color: string | null
          light_header_footer_color: string | null
          light_primary_color: string | null
          light_secondary_color: string | null
          linkedin_url: string | null
          logo_url: string | null
          master_password_hash: string | null
          max_rental_days: number | null
          meta_description: string | null
          meta_title: string | null
          min_rental_days: number | null
          minimum_rental_age: number | null
          monday_close: string | null
          monday_enabled: boolean | null
          monday_open: string | null
          multiple_locations_enabled: boolean | null
          og_image_url: string | null
          payment_mode: string | null
          phone: string | null
          pickup_area_enabled: boolean | null
          pickup_area_radius_km: number | null
          pickup_fixed_enabled: boolean | null
          pickup_location_mode: string | null
          pickup_multiple_locations_enabled: boolean | null
          primary_color: string | null
          require_identity_verification: boolean | null
          require_insurance_upload: boolean | null
          return_area_enabled: boolean | null
          return_area_radius_km: number | null
          return_fixed_enabled: boolean | null
          return_location_mode: string | null
          return_multiple_locations_enabled: boolean | null
          saturday_close: string | null
          saturday_enabled: boolean | null
          saturday_open: string | null
          secondary_color: string | null
          service_fee_amount: number | null
          service_fee_enabled: boolean | null
          service_fee_type: string | null
          service_fee_value: number | null
          slug: string
          status: string
          stripe_account_id: string | null
          stripe_account_status: string | null
          stripe_mode: string
          stripe_onboarding_complete: boolean | null
          stripe_subscription_customer_id: string | null
          subscription_plan: string | null
          sunday_close: string | null
          sunday_enabled: boolean | null
          sunday_open: string | null
          tax_enabled: boolean | null
          tax_percentage: number | null
          tenant_type: string | null
          thursday_close: string | null
          thursday_enabled: boolean | null
          thursday_open: string | null
          timezone: string | null
          trial_ends_at: string | null
          tuesday_close: string | null
          tuesday_enabled: boolean | null
          tuesday_open: string | null
          twitter_url: string | null
          updated_at: string | null
          wednesday_close: string | null
          wednesday_enabled: boolean | null
          wednesday_open: string | null
          working_hours_always_open: boolean | null
          working_hours_close: string | null
          working_hours_enabled: boolean | null
          working_hours_open: string | null
        }
        Insert: {
          accent_color?: string | null
          address?: string | null
          admin_email?: string | null
          admin_name?: string | null
          app_name?: string | null
          area_around_enabled?: boolean | null
          area_center_lat?: number | null
          area_center_lon?: number | null
          area_delivery_fee?: number | null
          bonzah_mode?: string
          bonzah_password?: string | null
          bonzah_username?: string | null
          booking_lead_time_hours?: number | null
          business_hours?: string | null
          collection_enabled?: boolean | null
          company_name: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          currency_code?: string | null
          dark_accent_color?: string | null
          dark_background_color?: string | null
          dark_header_footer_color?: string | null
          dark_primary_color?: string | null
          dark_secondary_color?: string | null
          date_format?: string | null
          delivery_enabled?: boolean | null
          deposit_mode?: string | null
          distance_unit?: string | null
          facebook_url?: string | null
          favicon_url?: string | null
          fixed_address_enabled?: boolean | null
          fixed_pickup_address?: string | null
          fixed_return_address?: string | null
          friday_close?: string | null
          friday_enabled?: boolean | null
          friday_open?: string | null
          global_deposit_amount?: number | null
          google_maps_url?: string | null
          hero_background_url?: string | null
          id?: string
          instagram_url?: string | null
          installment_config?: Json | null
          installments_enabled?: boolean | null
          integration_bonzah?: boolean | null
          integration_canopy?: boolean | null
          integration_veriff?: boolean | null
          light_accent_color?: string | null
          light_background_color?: string | null
          light_header_footer_color?: string | null
          light_primary_color?: string | null
          light_secondary_color?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          master_password_hash?: string | null
          max_rental_days?: number | null
          meta_description?: string | null
          meta_title?: string | null
          min_rental_days?: number | null
          minimum_rental_age?: number | null
          monday_close?: string | null
          monday_enabled?: boolean | null
          monday_open?: string | null
          multiple_locations_enabled?: boolean | null
          og_image_url?: string | null
          payment_mode?: string | null
          phone?: string | null
          pickup_area_enabled?: boolean | null
          pickup_area_radius_km?: number | null
          pickup_fixed_enabled?: boolean | null
          pickup_location_mode?: string | null
          pickup_multiple_locations_enabled?: boolean | null
          primary_color?: string | null
          require_identity_verification?: boolean | null
          require_insurance_upload?: boolean | null
          return_area_enabled?: boolean | null
          return_area_radius_km?: number | null
          return_fixed_enabled?: boolean | null
          return_location_mode?: string | null
          return_multiple_locations_enabled?: boolean | null
          saturday_close?: string | null
          saturday_enabled?: boolean | null
          saturday_open?: string | null
          secondary_color?: string | null
          service_fee_amount?: number | null
          service_fee_enabled?: boolean | null
          service_fee_type?: string | null
          service_fee_value?: number | null
          slug: string
          status?: string
          stripe_account_id?: string | null
          stripe_account_status?: string | null
          stripe_mode?: string
          stripe_onboarding_complete?: boolean | null
          stripe_subscription_customer_id?: string | null
          subscription_plan?: string | null
          sunday_close?: string | null
          sunday_enabled?: boolean | null
          sunday_open?: string | null
          tax_enabled?: boolean | null
          tax_percentage?: number | null
          tenant_type?: string | null
          thursday_close?: string | null
          thursday_enabled?: boolean | null
          thursday_open?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          tuesday_close?: string | null
          tuesday_enabled?: boolean | null
          tuesday_open?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          wednesday_close?: string | null
          wednesday_enabled?: boolean | null
          wednesday_open?: string | null
          working_hours_always_open?: boolean | null
          working_hours_close?: string | null
          working_hours_enabled?: boolean | null
          working_hours_open?: string | null
        }
        Update: {
          accent_color?: string | null
          address?: string | null
          admin_email?: string | null
          admin_name?: string | null
          app_name?: string | null
          area_around_enabled?: boolean | null
          area_center_lat?: number | null
          area_center_lon?: number | null
          area_delivery_fee?: number | null
          bonzah_mode?: string
          bonzah_password?: string | null
          bonzah_username?: string | null
          booking_lead_time_hours?: number | null
          business_hours?: string | null
          collection_enabled?: boolean | null
          company_name?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          currency_code?: string | null
          dark_accent_color?: string | null
          dark_background_color?: string | null
          dark_header_footer_color?: string | null
          dark_primary_color?: string | null
          dark_secondary_color?: string | null
          date_format?: string | null
          delivery_enabled?: boolean | null
          deposit_mode?: string | null
          distance_unit?: string | null
          facebook_url?: string | null
          favicon_url?: string | null
          fixed_address_enabled?: boolean | null
          fixed_pickup_address?: string | null
          fixed_return_address?: string | null
          friday_close?: string | null
          friday_enabled?: boolean | null
          friday_open?: string | null
          global_deposit_amount?: number | null
          google_maps_url?: string | null
          hero_background_url?: string | null
          id?: string
          instagram_url?: string | null
          installment_config?: Json | null
          installments_enabled?: boolean | null
          integration_bonzah?: boolean | null
          integration_canopy?: boolean | null
          integration_veriff?: boolean | null
          light_accent_color?: string | null
          light_background_color?: string | null
          light_header_footer_color?: string | null
          light_primary_color?: string | null
          light_secondary_color?: string | null
          linkedin_url?: string | null
          logo_url?: string | null
          master_password_hash?: string | null
          max_rental_days?: number | null
          meta_description?: string | null
          meta_title?: string | null
          min_rental_days?: number | null
          minimum_rental_age?: number | null
          monday_close?: string | null
          monday_enabled?: boolean | null
          monday_open?: string | null
          multiple_locations_enabled?: boolean | null
          og_image_url?: string | null
          payment_mode?: string | null
          phone?: string | null
          pickup_area_enabled?: boolean | null
          pickup_area_radius_km?: number | null
          pickup_fixed_enabled?: boolean | null
          pickup_location_mode?: string | null
          pickup_multiple_locations_enabled?: boolean | null
          primary_color?: string | null
          require_identity_verification?: boolean | null
          require_insurance_upload?: boolean | null
          return_area_enabled?: boolean | null
          return_area_radius_km?: number | null
          return_fixed_enabled?: boolean | null
          return_location_mode?: string | null
          return_multiple_locations_enabled?: boolean | null
          saturday_close?: string | null
          saturday_enabled?: boolean | null
          saturday_open?: string | null
          secondary_color?: string | null
          service_fee_amount?: number | null
          service_fee_enabled?: boolean | null
          service_fee_type?: string | null
          service_fee_value?: number | null
          slug?: string
          status?: string
          stripe_account_id?: string | null
          stripe_account_status?: string | null
          stripe_mode?: string
          stripe_onboarding_complete?: boolean | null
          stripe_subscription_customer_id?: string | null
          subscription_plan?: string | null
          sunday_close?: string | null
          sunday_enabled?: boolean | null
          sunday_open?: string | null
          tax_enabled?: boolean | null
          tax_percentage?: number | null
          tenant_type?: string | null
          thursday_close?: string | null
          thursday_enabled?: boolean | null
          thursday_open?: string | null
          timezone?: string | null
          trial_ends_at?: string | null
          tuesday_close?: string | null
          tuesday_enabled?: boolean | null
          tuesday_open?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          wednesday_close?: string | null
          wednesday_enabled?: boolean | null
          wednesday_open?: string | null
          working_hours_always_open?: boolean | null
          working_hours_close?: string | null
          working_hours_enabled?: boolean | null
          working_hours_open?: string | null
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "testimonials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          updated_at?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_files_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          tenant_id: string | null
          updated_at: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number | null
          id?: string
          photo_url: string
          tenant_id?: string | null
          updated_at?: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          display_order?: number | null
          id?: string
          photo_url?: string
          tenant_id?: string | null
          updated_at?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicle_photos_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          allowed_mileage: number | null
          balloon: number | null
          color: string | null
          colour: string | null
          created_at: string | null
          current_mileage: number | null
          daily_rent: number | null
          description: string | null
          disposal_buyer: string | null
          disposal_date: string | null
          disposal_notes: string | null
          finance_start_date: string | null
          fuel_type: string | null
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
          security_deposit: number | null
          security_notes: string | null
          spare_key_holder: string | null
          spare_key_notes: string | null
          status: string | null
          tax_due_date: string | null
          tenant_id: string | null
          term_months: number | null
          updated_at: string
          vin: string | null
          warranty_end_date: string | null
          warranty_start_date: string | null
          weekly_rent: number | null
          year: number | null
        }
        Insert: {
          acquisition_date?: string | null
          acquisition_type?: string | null
          allowed_mileage?: number | null
          balloon?: number | null
          color?: string | null
          colour?: string | null
          created_at?: string | null
          current_mileage?: number | null
          daily_rent?: number | null
          description?: string | null
          disposal_buyer?: string | null
          disposal_date?: string | null
          disposal_notes?: string | null
          finance_start_date?: string | null
          fuel_type?: string | null
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
          security_deposit?: number | null
          security_notes?: string | null
          spare_key_holder?: string | null
          spare_key_notes?: string | null
          status?: string | null
          tax_due_date?: string | null
          tenant_id?: string | null
          term_months?: number | null
          updated_at?: string
          vin?: string | null
          warranty_end_date?: string | null
          warranty_start_date?: string | null
          weekly_rent?: number | null
          year?: number | null
        }
        Update: {
          acquisition_date?: string | null
          acquisition_type?: string | null
          allowed_mileage?: number | null
          balloon?: number | null
          color?: string | null
          colour?: string | null
          created_at?: string | null
          current_mileage?: number | null
          daily_rent?: number | null
          description?: string | null
          disposal_buyer?: string | null
          disposal_date?: string | null
          disposal_notes?: string | null
          finance_start_date?: string | null
          fuel_type?: string | null
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
          security_deposit?: number | null
          security_notes?: string | null
          spare_key_holder?: string | null
          spare_key_notes?: string | null
          status?: string | null
          tax_due_date?: string | null
          tenant_id?: string | null
          term_months?: number | null
          updated_at?: string
          vin?: string | null
          warranty_end_date?: string | null
          warranty_start_date?: string | null
          weekly_rent?: number | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
      v_global_blacklist_details: {
        Row: {
          blocked_tenant_count: number | null
          blocking_tenants: Json | null
          created_at: string | null
          email: string | null
          first_blocked_at: string | null
          id: string | null
          last_blocked_at: string | null
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
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
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
          tenant_id: string | null
          total_due: number | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
            foreignKeyName: "ledger_entries_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          customer_id: string | null
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
          tenant_id: string | null
          type: string | null
          vehicle_id: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_reg: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fines_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string | null
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
            foreignKeyName: "payments_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
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
            foreignKeyName: "payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
          tenant_id: string | null
          total_costs: number | null
          total_revenue: number | null
          vehicle_id: string | null
          vehicle_reg: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
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
          tenant_id: string | null
          total_costs: number | null
          total_revenue: number | null
          view_type: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pnl_entries_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      view_rentals_export: {
        Row: {
          balance: number | null
          customer_id: string | null
          customer_name: string | null
          end_date: string | null
          initial_fee_amount: number | null
          monthly_amount: number | null
          rental_id: string | null
          schedule: string | null
          start_date: string | null
          status: string | null
          tenant_id: string | null
          vehicle_id: string | null
          vehicle_reg: string | null
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
            foreignKeyName: "rentals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "view_fines_export"
            referencedColumns: ["customer_id"]
          },
          {
            foreignKeyName: "rentals_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
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
            referencedRelation: "view_fines_export"
            referencedColumns: ["vehicle_id"]
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
      approve_booking_payment: {
        Args: { p_approved_by: string; p_payment_id: string }
        Returns: Json
      }
      approve_payment: {
        Args: { p_approved_by: string; p_payment_id: string }
        Returns: Json
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
      block_customer: {
        Args: { p_blocked_by?: string; p_customer_id: string; p_reason: string }
        Returns: Json
      }
      calculate_vehicle_book_cost: {
        Args: { p_vehicle_id: string }
        Returns: number
      }
      cancel_installment_plan: {
        Args: { p_plan_id: string; p_reason?: string }
        Returns: boolean
      }
      check_and_update_global_blacklist: {
        Args: { p_email: string }
        Returns: boolean
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
      create_installment_plan:
        | {
            Args: {
              p_customer_id: string
              p_number_of_installments: number
              p_plan_type: string
              p_rental_id: string
              p_start_date?: string
              p_stripe_customer_id?: string
              p_tenant_id: string
              p_total_installable_amount: number
              p_upfront_amount?: number
            }
            Returns: string
          }
        | {
            Args: {
              p_customer_id: string
              p_number_of_installments: number
              p_plan_type: string
              p_rental_id: string
              p_start_date: string
              p_stripe_customer_id?: string
              p_stripe_payment_method_id?: string
              p_tenant_id: string
              p_total_installable_amount: number
              p_upfront_amount: number
            }
            Returns: string
          }
      delete_rental_cascade: {
        Args: { rental_uuid: string }
        Returns: undefined
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
      get_chat_history: {
        Args: {
          p_conversation_id: string
          p_limit?: number
          p_tenant_id: string
        }
        Returns: {
          chart_data: Json
          content: string
          created_at: string
          id: number
          role: string
          sources: Json
        }[]
      }
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
      get_customer_rag_context:
        | { Args: { p_customer_id: string }; Returns: Json }
        | {
            Args: { p_customer_id: string; p_tenant_id: string }
            Returns: Json
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
      get_due_installments: {
        Args: { p_process_date?: string }
        Returns: {
          amount: number
          customer_id: string
          due_date: string
          id: string
          installment_number: number
          installment_plan_id: string
          rental_id: string
          stripe_customer_id: string
          stripe_payment_method_id: string
          tenant_id: string
        }[]
      }
      get_effective_tenant_id: { Args: never; Returns: string }
      get_expiring_bookings: {
        Args: never
        Returns: {
          amount: number
          customer_name: string
          days_remaining: number
          payment_id: string
          rental_id: string
          vehicle_reg: string
        }[]
      }
      get_installment_plan_summary: {
        Args: { p_rental_id: string }
        Returns: Json
      }
      get_installments_for_reminder: {
        Args: never
        Returns: {
          amount: number
          customer_email: string
          customer_id: string
          customer_name: string
          customer_phone: string
          due_date: string
          installment_id: string
          installment_number: number
          plan_id: string
          rental_id: string
          rental_number: string
          tenant_id: string
          vehicle_make: string
          vehicle_model: string
          vehicle_reg: string
        }[]
      }
      get_installments_for_retry: {
        Args: { p_process_date?: string }
        Returns: {
          amount: number
          customer_id: string
          due_date: string
          failure_count: number
          id: string
          installment_number: number
          installment_plan_id: string
          last_attempted_at: string
          max_retry_attempts: number
          rental_id: string
          retry_interval_days: number
          stripe_customer_id: string
          stripe_payment_method_id: string
          tenant_id: string
        }[]
      }
      get_payment_remaining: {
        Args: { payment_id_param: string }
        Returns: number
      }
      get_pending_bookings_count: { Args: never; Returns: number }
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
      get_pending_payments_count: { Args: never; Returns: number }
      get_rag_metrics: { Args: { p_tenant_id: string }; Returns: Json }
      get_refunds_due_today: {
        Args: never
        Returns: {
          customer_email: string
          customer_id: string
          customer_name: string
          payment_amount: number
          payment_id: string
          refund_amount: number
          refund_reason: string
          rental_id: string
          stripe_payment_intent_id: string
        }[]
      }
      get_rental_credit: { Args: { rental_id_param: string }; Returns: number }
      get_rental_insurance_documents: {
        Args: { p_rental_id: string }
        Returns: {
          ai_confidence_score: number
          ai_extracted_data: Json
          ai_scan_status: string
          ai_validation_score: number
          document_name: string
          file_url: string
          id: string
          uploaded_at: string
        }[]
      }
      get_user_role: { Args: { user_id: string }; Returns: string }
      get_user_tenant_id: { Args: never; Returns: string }
      has_any_role: {
        Args: { _roles: string[]; _user_id: string }
        Returns: boolean
      }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      has_upfront_finance_entry: { Args: { v_id: string }; Returns: boolean }
      hash_password: { Args: { password: string }; Returns: string }
      is_current_user_admin: { Args: never; Returns: boolean }
      is_global_master_admin: { Args: never; Returns: boolean }
      is_globally_blacklisted: { Args: { p_email: string }; Returns: boolean }
      is_identity_blocked: {
        Args: { p_identity_number: string }
        Returns: {
          block_reason: string
          identity_type: string
          is_blocked: boolean
        }[]
      }
      is_identity_blocked_for_tenant: {
        Args: { p_identity_number: string; p_tenant_id: string }
        Returns: {
          block_reason: string
          identity_type: string
          is_blocked: boolean
        }[]
      }
      is_primary_super_admin: { Args: never; Returns: boolean }
      is_super_admin: { Args: never; Returns: boolean }
      mark_installment_failed: {
        Args: {
          p_failure_reason: string
          p_installment_id: string
          p_stripe_payment_intent_id?: string
        }
        Returns: boolean
      }
      mark_installment_paid: {
        Args: {
          p_installment_id: string
          p_ledger_entry_id?: string
          p_payment_id?: string
          p_stripe_charge_id?: string
          p_stripe_payment_intent_id?: string
        }
        Returns: boolean
      }
      mark_overdue_installments: { Args: never; Returns: undefined }
      match_documents: {
        Args: {
          filter_tables?: string[]
          match_count?: number
          match_threshold?: number
          p_tenant_id: string
          query_embedding: string
        }
        Returns: {
          content: string
          id: number
          metadata: Json
          similarity: number
          source_id: string
          source_table: string
        }[]
      }
      payment_apply_fifo: { Args: { p_id: string }; Returns: undefined }
      payment_apply_fifo_v2: { Args: { p_id: string }; Returns: undefined }
      payment_auto_apply_due_credit: { Args: never; Returns: undefined }
      pnl_post_acquisition: { Args: { v_id: string }; Returns: undefined }
      process_payment_transaction:
        | { Args: { p_payment_id: string }; Returns: Json }
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
      record_installment_notification: {
        Args: {
          p_installment_id: string
          p_notification_type: string
          p_sent_at?: string
        }
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
      reject_booking_payment: {
        Args: { p_payment_id: string; p_reason: string; p_rejected_by: string }
        Returns: Json
      }
      reject_payment: {
        Args: { p_payment_id: string; p_reason: string; p_rejected_by: string }
        Returns: Json
      }
      rental_create_charge: {
        Args: { amt: number; due: string; r_id: string }
        Returns: string
      }
      unblock_customer: { Args: { p_customer_id: string }; Returns: Json }
      undo_vehicle_disposal: { Args: { p_vehicle_id: string }; Returns: Json }
      update_customer_balance: {
        Args: { customer_id: string }
        Returns: undefined
      }
      update_refund_status: {
        Args: {
          p_error_message?: string
          p_new_status: string
          p_payment_id: string
          p_stripe_refund_id?: string
        }
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
      user_can_access_rental: {
        Args: { p_rental_id: string }
        Returns: boolean
      }
      verify_global_master_password: {
        Args: { p_email: string; p_password: string }
        Returns: boolean
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
      key_handover_type: "giving" | "receiving"
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
      key_handover_type: ["giving", "receiving"],
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
